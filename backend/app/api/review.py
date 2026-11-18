"""Manual review (LS-17; RC-02, RC-03, RC-10, DD-08, RC-01).

* `GET  /review-queue` lists reports waiting for a person, with the reason
  each one is there and what the AI suggested (if anything).
* `POST /reports/{id}/route` lets a reviewer set the category and send the
  report to the team that should handle it. The category becomes
  staff-confirmed.

Reviewers are administrators and staff on the manual-review team (the team a
report in review is assigned to). Students get 403; staff outside the team see
nothing. Failed AI analyses can be retried with `POST /reports/{id}/analysis`;
a confident retry routes the report out of review by itself.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.authz import StaffProfile, can_manage_report
from app.db import Db
from app.routing import RoutingError, route_manually

router = APIRouter(tags=["manual review"])


class AiSummary(BaseModel):
    processing_status: str  # pending | succeeded | failed
    category: str | None
    uncertainty_reason: str | None
    error: str | None


class ReviewItem(BaseModel):
    id: UUID
    reference_code: str
    status: str
    location_name: str
    note: str | None
    created_at: datetime
    # ai_failed | ai_unavailable | uncertain | no_category | no_matching_rule
    review_reason: str
    team_name: str | None
    ai: AiSummary | None


class ManualRoute(BaseModel):
    category_id: UUID
    team_id: UUID


class TeamOption(BaseModel):
    id: UUID
    name: str


@router.get("/teams")
def destination_teams(profile: StaffProfile, db: Db) -> list[TeamOption]:
    """Active teams a reviewer can send a report to (not the review team itself)."""
    rows = db.execute(
        "select id, name from public.teams where is_active and not is_manual_review order by name"
    ).fetchall()
    return [TeamOption(**row) for row in rows]


_QUEUE_SELECT = """
    select r.id, r.reference_code, r.status::text as status, r.note, r.created_at,
           r.review_reason, r.assigned_team_id, l.name as location_name, t.name as team_name,
           a.processing_status::text as ai_status, c.name as ai_category,
           a.uncertainty_reason as ai_uncertainty_reason, a.error_message as ai_error
    from public.reports r
    join public.locations l on l.id = r.location_id
    left join public.teams t on t.id = r.assigned_team_id
    left join lateral (
        select processing_status, suggested_category_id, uncertainty_reason, error_message
        from public.ai_analyses where report_id = r.id
        order by created_at desc, id desc limit 1
    ) a on true
    left join public.categories c on c.id = a.suggested_category_id
    where r.review_reason is not null
"""


def _item(row: dict[str, object]) -> ReviewItem:
    ai = (
        AiSummary(
            processing_status=row["ai_status"],
            category=row["ai_category"],
            uncertainty_reason=row["ai_uncertainty_reason"],
            error=row["ai_error"],
        )
        if row["ai_status"] is not None
        else None
    )
    return ReviewItem(
        id=row["id"],
        reference_code=row["reference_code"],
        status=row["status"],
        location_name=row["location_name"],
        note=row["note"],
        created_at=row["created_at"],
        review_reason=row["review_reason"],
        team_name=row["team_name"],
        ai=ai,
    )


@router.get("/review-queue")
def review_queue(profile: StaffProfile, db: Db) -> list[ReviewItem]:
    """Reports waiting for manual review that the caller may handle, oldest first."""
    rows = db.execute(f"{_QUEUE_SELECT} order by r.created_at, r.id").fetchall()
    return [
        _item(row)
        for row in rows
        if can_manage_report(profile, assigned_team_id=row["assigned_team_id"])
    ]


@router.post("/reports/{report_id}/route")
def route_from_review(
    report_id: UUID, body: ManualRoute, profile: StaffProfile, db: Db
) -> dict[str, str]:
    row = db.execute(
        "select assigned_team_id from public.reports where id = %s", (report_id,)
    ).fetchone()
    if row is None or not can_manage_report(profile, assigned_team_id=row["assigned_team_id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    try:
        route_manually(
            db,
            report_id,
            category_id=body.category_id,
            team_id=body.team_id,
            actor_id=profile.id,
        )
    except RoutingError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=error.detail
        ) from None
    return {"status": "assigned"}
