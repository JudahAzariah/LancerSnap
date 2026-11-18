"""Staff report queue (LS-18; US-07, RC-01, RC-07, SDD §6.2).

`GET /staff/queue` lists the reports in the caller's authorized team queues:
staff see only reports assigned to a team they belong to; administrators see
every report. Students get 403. Each item carries what staff need to triage:
status, location, team, the category (staff-confirmed or AI-suggested, and
which), the AI's suggested priority and safety-hazard flag, whether the AI was
uncertain, whether the report is waiting in manual review, and when it was
submitted. All values are read from the database on every request, so the
queue always shows the current persisted state.

The dashboard is standalone: it does not replace or integrate with CBU
work-order systems (OQ-02, SDD §2.4).
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.authz import StaffProfile
from app.db import Db

router = APIRouter(prefix="/staff", tags=["staff"])

Status = Literal["submitted", "assigned", "in_progress", "resolved", "reopened", "closed"]
PriorityFilter = Literal["high", "medium", "low", "none"]
Sort = Literal["priority", "newest", "oldest"]


class QueueCategory(BaseModel):
    name: str
    # "staff": confirmed by staff. "ai_suggestion": suggested by AI, unconfirmed.
    source: Literal["staff", "ai_suggestion"]


class QueueItem(BaseModel):
    id: UUID
    reference_code: str
    status: str
    location_name: str
    team_name: str | None
    category: QueueCategory | None
    # The AI's suggestion (LS-14); null when there is no validated analysis.
    priority: Literal["low", "medium", "high"] | None
    potential_safety_hazard: bool
    ai_uncertain: bool
    in_manual_review: bool
    created_at: datetime
    updated_at: datetime


_QUEUE = """
    select r.id, r.reference_code, r.status::text as status, r.created_at, r.updated_at,
           r.review_reason, l.name as location_name, t.name as team_name,
           confirmed.name as confirmed_category, suggested.name as suggested_category,
           ai.suggested_priority::text as priority,
           coalesce(ai.is_potential_safety_hazard, false) as potential_safety_hazard,
           coalesce(ai.is_uncertain, false) as ai_uncertain
    from public.reports r
    join public.locations l on l.id = r.location_id
    left join public.teams t on t.id = r.assigned_team_id
    left join public.categories confirmed
      on confirmed.id = r.category_id and r.category_confirmed_by is not null
    left join lateral (
        -- Newest validated, complete analysis only (LS-12).
        select suggested_category_id, suggested_priority, is_potential_safety_hazard,
               is_uncertain
        from public.ai_analyses a
        where a.report_id = r.id and a.processing_status = 'succeeded'
          and a.suggested_priority is not null and a.confidence is not null
        order by a.created_at desc, a.id desc
        limit 1
    ) ai on true
    left join public.categories suggested on suggested.id = ai.suggested_category_id
    where (%(admin)s or r.assigned_team_id = any(%(teams)s::uuid[]))
      and (%(statuses)s::text[] is null or r.status::text = any(%(statuses)s))
      and (%(priorities)s::text[] is null
           or coalesce(ai.suggested_priority::text, 'none') = any(%(priorities)s))
      and (not %(hazards_only)s or coalesce(ai.is_potential_safety_hazard, false))
"""

_ORDER = {
    # Safety hazards first, then high, medium, low, none; oldest first within each.
    "priority": """
        order by coalesce(ai.is_potential_safety_hazard, false) desc,
                 case ai.suggested_priority when 'high' then 3 when 'medium' then 2
                                            when 'low' then 1 else 0 end desc,
                 r.created_at, r.id
    """,
    "newest": "order by r.created_at desc, r.id",
    "oldest": "order by r.created_at, r.id",
}


@router.get("/queue")
def staff_queue(
    profile: StaffProfile,
    db: Db,
    status: Annotated[list[Status] | None, Query()] = None,
    priority: Annotated[list[PriorityFilter] | None, Query()] = None,
    hazards_only: bool = False,
    sort: Sort = "priority",
) -> list[QueueItem]:
    """Reports in the caller's authorized team queues (US-07, RC-01)."""
    rows = db.execute(
        _QUEUE + _ORDER[sort],
        {
            "admin": profile.is_admin,
            "teams": list(profile.team_ids),
            "statuses": status or None,
            "priorities": priority or None,
            "hazards_only": hazards_only,
        },
    ).fetchall()
    return [_item(row) for row in rows]


def _item(row: dict[str, object]) -> QueueItem:
    if row["confirmed_category"] is not None:
        category = QueueCategory(name=row["confirmed_category"], source="staff")
    elif row["suggested_category"] is not None:
        category = QueueCategory(name=row["suggested_category"], source="ai_suggestion")
    else:
        category = None
    return QueueItem(
        id=row["id"],
        reference_code=row["reference_code"],
        status=row["status"],
        location_name=row["location_name"],
        team_name=row["team_name"],
        category=category,
        priority=row["priority"],
        potential_safety_hazard=row["potential_safety_hazard"],
        ai_uncertain=row["ai_uncertain"],
        in_manual_review=row["review_reason"] is not None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
