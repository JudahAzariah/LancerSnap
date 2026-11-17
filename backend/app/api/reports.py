"""Report submission (LS-09; US-01, US-06, RC-10, RC-12, DD-08).

A student submits a photo they already uploaded (LS-08), a supported campus
location, and an optional note. The backend checks every reference, confirms
the photo really is in storage, and stores the report as `submitted` with its
first status-history entry, all in one transaction. It returns a receipt with
the report's reference code.

Submission never depends on AI analysis: classification is added later
(Phase 3) and must not block or fail a valid report.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, StringConstraints

from app.api.reference import Location, require_active_location
from app.authz import Profile, Role, require_roles
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
    body: ReportSubmission, profile: StudentProfile, db: Db, storage: Storage
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

    return ReportReceipt(
        id=report["id"],
        reference_code=report["reference_code"],
        status=report["status"],
        location=location,
        note=report["note"],
        media_id=media["id"],
        created_at=report["created_at"],
    )
