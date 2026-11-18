"""A report's AI analysis, for staff review (LS-11; US-08, RC-01, RC-03, DD-08).

* `GET  /reports/{id}/analysis` returns the current (newest) analysis attempt,
  including whether it is still pending or failed.
* `POST /reports/{id}/analysis` sends the report for analysis again, for
  example after a failure. Each request is a new attempt; earlier ones are kept.

Only staff on the report's assigned team and administrators can use these.
Anyone else gets the same 404 as for a report that does not exist. The result
is advisory: nothing here changes the report.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.analysis import Queue, queue_analysis
from app.authz import Profile, StaffProfile, can_manage_report
from app.db import Db

router = APIRouter(prefix="/reports", tags=["analysis"])


class Analysis(BaseModel):
    id: UUID
    processing_status: str  # pending | succeeded | failed
    summary: str | None
    # Short failure reason (for example "timeout"); null unless failed.
    error: str | None
    provider: str | None
    model: str | None
    created_at: datetime
    completed_at: datetime | None


_COLUMNS = """
    id, processing_status::text as processing_status, summary, error_message as error,
    provider, model, created_at, completed_at
"""


def _require_manageable_report(
    db: Db, report_id: UUID, profile: Profile, *, lock: bool = False
) -> None:
    # Locking the report serializes concurrent "analyze again" requests, so
    # only one pending analysis can be queued at a time.
    row = db.execute(
        "select assigned_team_id from public.reports where id = %s"
        + (" for update" if lock else ""),
        (report_id,),
    ).fetchone()
    if row is None or not can_manage_report(profile, assigned_team_id=row["assigned_team_id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")


@router.get("/{report_id}/analysis")
def get_analysis(report_id: UUID, profile: StaffProfile, db: Db) -> Analysis:
    _require_manageable_report(db, report_id, profile)
    row = db.execute(
        f"""
        select {_COLUMNS} from public.ai_analyses
        where report_id = %s order by created_at desc, id desc limit 1
        """,
        (report_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This report has not been analyzed"
        )
    return Analysis(**row)


@router.post("/{report_id}/analysis", status_code=status.HTTP_202_ACCEPTED)
def request_analysis(
    report_id: UUID,
    profile: StaffProfile,
    db: Db,
    analysis_queue: Queue,
) -> Analysis:
    _require_manageable_report(db, report_id, profile, lock=True)
    if not analysis_queue.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI analysis is not available. The report can still be reviewed by staff.",
        )
    pending = db.execute(
        """
        select 1 from public.ai_analyses
        where report_id = %s and processing_status = 'pending' limit 1
        """,
        (report_id,),
    ).fetchone()
    if pending is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This report is already waiting for analysis.",
        )
    analysis_id = queue_analysis(db, report_id)
    row = db.execute(
        f"select {_COLUMNS} from public.ai_analyses where id = %s", (analysis_id,)
    ).fetchone()
    assert row is not None
    # Commit before waking the worker, so it can see the new analysis.
    db.commit()
    analysis_queue.notify()
    return Analysis(**row)
