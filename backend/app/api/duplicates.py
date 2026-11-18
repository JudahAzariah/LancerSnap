"""Possible duplicate reports, for staff review (LS-15; RC-06, DD-06, RC-01).

* `GET   /reports/{id}/duplicates` lists the reports that may describe the same
  issue, with why they were paired and any staff decision.
* `PATCH /reports/{id}/duplicates/{candidate_id}` records a staff decision:
  `not_duplicate` (keep both reports separate), `confirmed_duplicate`, or back
  to `pending`.

Only staff who can handle the report (its team, or administrators) see its
candidates, and only candidates whose *other* report they can also handle, so
nothing about another team's reports is revealed. A decision is a record for
staff only: no report is ever merged, deleted, closed, or otherwise changed.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.authz import Profile, StaffProfile, can_manage_report
from app.db import Db

router = APIRouter(prefix="/reports", tags=["duplicates"])

ReviewState = Literal["pending", "confirmed_duplicate", "not_duplicate"]


class OtherReport(BaseModel):
    id: UUID
    reference_code: str
    status: str
    location_name: str
    created_at: datetime


class DuplicateCandidate(BaseModel):
    id: UUID
    other_report: OtherReport
    # Why they were paired: rule, same_location, same_category, hours_apart,
    # text_similarity. See docs/AI-Analysis-Schema.md.
    signals: dict[str, Any]
    review_state: ReviewState
    reviewed_at: datetime | None


class ReviewDecision(BaseModel):
    review_state: ReviewState


_SELECT = """
    select d.id, d.similarity_signals as signals, d.review_state::text as review_state,
           d.reviewed_at,
           o.id as other_id, o.reference_code as other_reference_code,
           o.status::text as other_status, o.created_at as other_created_at,
           o.assigned_team_id as other_team_id, l.name as other_location_name
    from public.duplicate_candidates d
    join public.reports o
      on o.id = case when d.report_id = %(report)s then d.candidate_report_id
                     else d.report_id end
    join public.locations l on l.id = o.location_id
    where (d.report_id = %(report)s or d.candidate_report_id = %(report)s)
"""


def _require_manageable_report(db: Db, report_id: UUID, profile: Profile) -> None:
    row = db.execute(
        "select assigned_team_id from public.reports where id = %s", (report_id,)
    ).fetchone()
    if row is None or not can_manage_report(profile, assigned_team_id=row["assigned_team_id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")


def _candidate(row: dict[str, Any]) -> DuplicateCandidate:
    return DuplicateCandidate(
        id=row["id"],
        other_report=OtherReport(
            id=row["other_id"],
            reference_code=row["other_reference_code"],
            status=row["other_status"],
            location_name=row["other_location_name"],
            created_at=row["other_created_at"],
        ),
        signals=row["signals"],
        review_state=row["review_state"],
        reviewed_at=row["reviewed_at"],
    )


@router.get("/{report_id}/duplicates")
def list_duplicates(report_id: UUID, profile: StaffProfile, db: Db) -> list[DuplicateCandidate]:
    _require_manageable_report(db, report_id, profile)
    rows = db.execute(f"{_SELECT} order by d.created_at, d.id", {"report": report_id}).fetchall()
    return [
        _candidate(row)
        for row in rows
        if can_manage_report(profile, assigned_team_id=row["other_team_id"])
    ]


@router.patch("/{report_id}/duplicates/{candidate_id}")
def review_duplicate(
    report_id: UUID,
    candidate_id: UUID,
    decision: ReviewDecision,
    profile: StaffProfile,
    db: Db,
) -> DuplicateCandidate:
    """Record a staff decision. Never changes either report (RC-06)."""
    _require_manageable_report(db, report_id, profile)
    row = db.execute(
        f"{_SELECT} and d.id = %(candidate)s for update of d",
        {"report": report_id, "candidate": candidate_id},
    ).fetchone()
    if row is None or not can_manage_report(profile, assigned_team_id=row["other_team_id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    reviewed = decision.review_state != "pending"
    updated = db.execute(
        """
        update public.duplicate_candidates
        set review_state = %s,
            reviewed_by = case when %s then %s::uuid end,
            reviewed_at = case when %s then now() end
        where id = %s
        returning review_state::text as review_state, reviewed_at
        """,
        (decision.review_state, reviewed, profile.id, reviewed, candidate_id),
    ).fetchone()
    assert updated is not None
    return _candidate(row | updated)
