"""Report submission (LS-09; US-01, US-06, RC-10, RC-12, DD-08).

A student submits a photo they already uploaded (LS-08), a supported campus
location, and an optional note. The backend checks every reference, confirms
the photo really is in storage, and stores the report as `submitted` with its
first status-history entry, all in one transaction. It returns a receipt with
the report's reference code.

Submission never depends on AI analysis (DD-08): when analysis is turned on,
the report is queued for it in the same transaction and analyzed afterwards
by a background worker (LS-11). The AI service is never contacted here.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, StringConstraints

from app.analysis import (
    Queue,
    latest_validated_analysis,
    queue_analysis,
    safe_detect_duplicates,
    safe_route_report,
)
from app.api.reference import Location, require_active_location
from app.authz import CurrentProfile, Profile, Role, can_view_report, require_roles
from app.config import get_settings
from app.db import Db
from app.storage import ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES, Storage, StorageError

router = APIRouter(prefix="/reports", tags=["reports"])

StudentProfile = Annotated[Profile, Depends(require_roles(Role.STUDENT))]

MAX_NOTE_LENGTH = 2000
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_NOTE_LENGTH)]


class ReportSubmission(BaseModel):
    media_id: UUID
    location_id: UUID
    note: Note | None = None


class ReportReceipt(BaseModel):
    id: UUID
    reference_code: str
    status: str
    location: Location
    note: str | None
    media_id: UUID
    created_at: datetime


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


PHOTO_NOT_USABLE = "That photo cannot be used for this report. Add the photo again."


@router.post("", status_code=status.HTTP_201_CREATED)
def submit_report(
    body: ReportSubmission,
    profile: StudentProfile,
    db: Db,
    storage: Storage,
    analysis_queue: Queue,
) -> ReportReceipt:
    location = require_active_location(db, body.location_id)

    # The photo must be this student's own upload and not already part of a
    # report. A missing photo, someone else's photo, and an already-used photo
    # get the same answer, so the endpoint reveals nothing about other users.
    # FOR UPDATE stops two simultaneous submissions from both claiming it.
    media = db.execute(
        """
        select id, object_path
        from public.report_media
        where id = %s and uploader_id = %s and report_id is null
        for update
        """,
        (body.media_id, profile.id),
    ).fetchone()
    if media is None:
        raise _invalid(PHOTO_NOT_USABLE)

    # Trust what storage holds, not what the client declared at upload time.
    try:
        stored = storage.get_object(media["object_path"])
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Photo storage is unavailable, so the report was not submitted. Try again.",
        ) from None
    if stored is None:
        raise _invalid("The photo has not finished uploading. Try submitting again.")
    if stored.content_type not in ALLOWED_CONTENT_TYPES or stored.size_bytes > MAX_UPLOAD_BYTES:
        raise _invalid(PHOTO_NOT_USABLE)

    note = body.note or None  # An empty note is stored as no note.
    report = db.execute(
        """
        insert into public.reports (submitter_id, location_id, note)
        values (%s, %s, %s)
        returning id, reference_code, status::text as status, note, created_at
        """,
        (profile.id, location.id, note),
    ).fetchone()
    assert report is not None

    db.execute(
        """
        insert into public.status_history (report_id, from_status, to_status, actor_id)
        values (%s, null, 'submitted', %s)
        """,
        (report["id"], profile.id),
    )
    db.execute(
        """
        update public.report_media
        set report_id = %s, size_bytes = %s, content_type = %s
        where id = %s
        """,
        (report["id"], stored.size_bytes, stored.content_type, media["id"]),
    )

    if analysis_queue.enabled:
        queue_analysis(db, report["id"])
        # Commit before waking the worker, so it can see the new analysis.
        # (Background tasks can run before the request's own commit.)
        db.commit()
        analysis_queue.notify()
    else:
        # No AI analysis is coming, so look for duplicates now, on location,
        # time, and text only (LS-15). A failure here never blocks submission.
        settings = get_settings()
        safe_detect_duplicates(
            db,
            report["id"],
            window_hours=settings.duplicate_window_hours,
            text_threshold=settings.duplicate_text_threshold,
        )
        # Without AI it cannot be routed by rule: it goes to manual review (LS-17).
        safe_route_report(db, report["id"])
        current = db.execute(
            "select status::text as status from public.reports where id = %s", (report["id"],)
        ).fetchone()
        report = {**report, "status": current["status"]}

    return ReportReceipt(
        id=report["id"],
        reference_code=report["reference_code"],
        status=report["status"],
        location=location,
        note=report["note"],
        media_id=media["id"],
        created_at=report["created_at"],
    )


# --- Tracking (LS-10; US-03, RC-01, RC-12) -----------------------------------------


class ReportSummary(BaseModel):
    id: UUID
    reference_code: str
    status: str
    location: Location
    created_at: datetime
    updated_at: datetime


class StatusChange(BaseModel):
    from_status: str | None
    to_status: str
    note: str | None
    created_at: datetime


class ReportCategory(BaseModel):
    name: str
    # "staff": confirmed by campus staff. "ai_suggestion": suggested by AI only,
    # not confirmed; must be shown labelled as an AI suggestion (US-02).
    source: Literal["staff", "ai_suggestion"]
    # For an AI suggestion: the AI itself was not sure (RC-02). Always false for staff.
    uncertain: bool


class ReportDetails(ReportSummary):
    note: str | None
    # The report's photo, viewable through GET /media/{id}/url.
    media_id: UUID | None
    # Null until staff confirm a category or the AI suggests one.
    category: ReportCategory | None
    # Oldest first. Who made each change is not shown to the student.
    history: list[StatusChange]


_SUMMARY_COLUMNS = """
    r.id, r.reference_code, r.status::text as status, r.note, r.created_at, r.updated_at,
    r.submitter_id, r.assigned_team_id,
    l.id as location_id, l.name as location_name, l.location_type
"""


def _location(row: dict[str, object]) -> Location:
    return Location(
        id=row["location_id"], name=row["location_name"], location_type=row["location_type"]
    )


@router.get("/mine")
def list_my_reports(profile: CurrentProfile, db: Db) -> list[ReportSummary]:
    """The caller's own submitted reports, newest first (US-03)."""
    rows = db.execute(
        f"""
        select {_SUMMARY_COLUMNS}
        from public.reports r join public.locations l on l.id = r.location_id
        where r.submitter_id = %s
        order by r.created_at desc, r.reference_code desc
        """,
        (profile.id,),
    ).fetchall()
    return [
        ReportSummary(
            id=row["id"],
            reference_code=row["reference_code"],
            status=row["status"],
            location=_location(row),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


@router.get("/{report_id}")
def get_report(report_id: UUID, profile: CurrentProfile, db: Db) -> ReportDetails:
    """One report with its current persisted status and status history.

    Readable by the report's submitter, staff on its assigned team, and
    administrators (RC-01). Anyone else gets the same answer as for a report
    that does not exist, so report ids cannot be probed.
    """
    row = db.execute(
        f"""
        select {_SUMMARY_COLUMNS}
        from public.reports r join public.locations l on l.id = r.location_id
        where r.id = %s
        """,
        (report_id,),
    ).fetchone()
    if row is None or not can_view_report(
        profile, submitter_id=row["submitter_id"], assigned_team_id=row["assigned_team_id"]
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    media = db.execute(
        "select id from public.report_media where report_id = %s order by created_at limit 1",
        (report_id,),
    ).fetchone()
    history = db.execute(
        """
        select from_status::text as from_status, to_status::text as to_status, note, created_at
        from public.status_history
        where report_id = %s
        order by created_at, id
        """,
        (report_id,),
    ).fetchall()
    return ReportDetails(
        id=row["id"],
        reference_code=row["reference_code"],
        status=row["status"],
        location=_location(row),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        note=row["note"],
        media_id=media["id"] if media else None,
        category=_report_category(db, report_id),
        history=[StatusChange(**change) for change in history],
    )


def _report_category(db: Db, report_id: UUID) -> ReportCategory | None:
    """The staff-confirmed category if there is one, otherwise the AI's suggestion."""
    confirmed = db.execute(
        """
        select c.name from public.reports r join public.categories c on c.id = r.category_id
        where r.id = %s and r.category_confirmed_by is not null
        """,
        (report_id,),
    ).fetchone()
    if confirmed is not None:
        return ReportCategory(name=confirmed["name"], source="staff", uncertain=False)

    # Only validated AI output is ever shown (LS-12).
    analysis = latest_validated_analysis(db, report_id)
    if analysis is None or analysis.category_id is None:
        return None
    suggested = db.execute(
        "select name from public.categories where id = %s", (analysis.category_id,)
    ).fetchone()
    if suggested is None:
        return None
    return ReportCategory(
        name=suggested["name"], source="ai_suggestion", uncertain=analysis.uncertain
    )
