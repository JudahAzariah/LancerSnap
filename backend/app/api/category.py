"""Staff category correction (LS-19; US-08, RC-03, RISK-01, RC-01).

`PUT /reports/{id}/category` sets the report's category as a staff decision.
It is stored on the report with who confirmed it and when; the AI's own
suggestion stays unchanged in `ai_analyses`, so the two are always kept apart.

Only staff who can handle the report (its team, or administrators) may do
this; anyone else gets the same 404 as for a report that does not exist. The
correction does not change the report's team or status: reassignment is a
separate staff action.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.reports import ReportCategory
from app.authz import StaffProfile, can_manage_report
from app.db import Db

router = APIRouter(prefix="/reports", tags=["category"])


class CategoryDecision(BaseModel):
    category_id: UUID


@router.put("/{report_id}/category")
def set_category(
    report_id: UUID, decision: CategoryDecision, profile: StaffProfile, db: Db
) -> ReportCategory:
    report = db.execute(
        "select assigned_team_id from public.reports where id = %s for update", (report_id,)
    ).fetchone()
    if report is None or not can_manage_report(
        profile, assigned_team_id=report["assigned_team_id"]
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    category = db.execute(
        "select name from public.categories where id = %s and is_active", (decision.category_id,)
    ).fetchone()
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose an active category."
        )

    db.execute(
        """
        update public.reports
        set category_id = %s, category_confirmed_by = %s, category_confirmed_at = now()
        where id = %s
        """,
        (decision.category_id, profile.id, report_id),
    )
    return ReportCategory(name=category["name"], source="staff", uncertain=False)
