"""Routing engine and manual-review fallback (LS-16, LS-17; US-11, RC-02, RC-03,
RC-04, RC-05, RC-10, DD-04, DD-05, DD-08, SDD §5.5 step 6).

Sends a report to a team using the administrator-configured rules in
`routing_rules`. No team, category, or location is named in this code: change
the rules and routing changes, with no code or app change (RC-04).

A report is **routed** when it is waiting for routing, its newest AI analysis
succeeded with a confident result (a category, not uncertain), and an active
rule matches its category at an active team. A rule for the report's own
location wins over a category-wide rule. It is assigned to the rule's **team**,
never to a person (RC-05).

Otherwise it goes to **manual review** (LS-17), with the reason recorded in
`reports.review_reason` (staff-facing only):

* `ai_failed`: the newest AI analysis failed;
* `ai_unavailable`: there is no AI analysis (turned off, or never ran);
* `uncertain`: the AI result was uncertain;
* `no_category`: the AI suggested no category;
* `no_matching_rule`: no active rule for the category.

A report in review is assigned to the configured manual-review team (the one
team with `is_manual_review`), if there is an active one; otherwise it stays
unassigned and only administrators see it. A report is "waiting for routing"
while it is newly submitted, or while it sits in review untouched by a person,
so a successful AI retry can still route it automatically. Once a reviewer
routes it (`route_manually`), automatic routing never moves it again.

Status: routing or review moves a report from `submitted` to `assigned`
(assigned to a team), with a system status-history entry that has no note, so
the student is never told which team, or that it is in review.
"""

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from app.analysis import latest_validated_analysis
from app.db import Connection

ReviewReason = Literal[
    "ai_failed", "ai_unavailable", "uncertain", "no_category", "no_matching_rule"
]
SkipReason = Literal["not_found", "already_routed", "analysis_pending"]


@dataclass(frozen=True)
class Routed:
    team_id: UUID
    rule_id: UUID


@dataclass(frozen=True)
class InReview:
    """Sent to manual review. `team_id` is None when no review team is configured."""

    reason: ReviewReason
    team_id: UUID | None


@dataclass(frozen=True)
class NotRouted:
    """Nothing was changed, and why."""

    reason: SkipReason


RoutingOutcome = Routed | InReview | NotRouted


class RoutingError(Exception):
    """A manual routing request was refused. `detail` is safe to show."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def find_rule(db: Connection, category_id: UUID, location_id: UUID) -> tuple[UUID, UUID] | None:
    """The (rule id, team id) of the best active rule, or None.

    A location-specific rule beats a category-wide one. Rules pointing at an
    inactive team or an inactive category never match.
    """
    row = db.execute(
        """
        select r.id as rule_id, r.team_id
        from public.routing_rules r
        join public.teams t on t.id = r.team_id and t.is_active
        join public.categories c on c.id = r.category_id and c.is_active
        where r.is_active and r.category_id = %s
          and (r.location_id = %s or r.location_id is null)
        order by (r.location_id is null), r.created_at
        limit 1
        """,
        (category_id, location_id),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row["rule_id"])), UUID(str(row["team_id"]))


def manual_review_team(db: Connection) -> UUID | None:
    """The active manual-review team, if one is configured."""
    row = db.execute(
        "select id from public.teams where is_manual_review and is_active limit 1"
    ).fetchone()
    return UUID(str(row["id"])) if row else None


def _lock_report(db: Connection, report_id: UUID) -> dict[str, object] | None:
    return db.execute(
        """
        select id, status::text as status, assigned_team_id, assigned_to, location_id,
               review_reason
        from public.reports where id = %s for update
        """,
        (report_id,),
    ).fetchone()


def _waiting_for_routing(report: dict[str, object]) -> bool:
    newly_submitted = report["status"] == "submitted" and report["assigned_team_id"] is None
    untouched_in_review = report["review_reason"] is not None and report["assigned_to"] is None
    return newly_submitted or untouched_in_review


def _assign(
    db: Connection,
    report: dict[str, object],
    *,
    team_id: UUID | None,
    review_reason: str | None,
    category_id: UUID | None = None,
    confirmed_by: UUID | None = None,
    actor_id: UUID | None = None,
) -> None:
    """Set the team, review reason, and category; record a status change if there is one."""
    new_status = "assigned" if team_id is not None else report["status"]
    db.execute(
        """
        update public.reports
        set assigned_team_id = %(team)s,
            review_reason = %(reason)s,
            status = %(status)s::public.report_status,
            category_id = coalesce(%(category)s, category_id),
            category_confirmed_by = case when %(confirmed_by)s::uuid is not null
                                         then %(confirmed_by)s::uuid
                                         else category_confirmed_by end,
            category_confirmed_at = case when %(confirmed_by)s::uuid is not null
                                         then now() else category_confirmed_at end
        where id = %(id)s
        """,
        {
            "id": report["id"],
            "team": team_id,
            "reason": review_reason,
            "status": new_status,
            "category": category_id,
            "confirmed_by": confirmed_by,
        },
    )
    if new_status != report["status"]:
        db.execute(
            """
            insert into public.status_history (report_id, from_status, to_status, actor_id)
            values (%s, %s::public.report_status, %s::public.report_status, %s)
            """,
            (report["id"], report["status"], new_status, actor_id),
        )


def route_report(db: Connection, report_id: UUID) -> RoutingOutcome:
    """Route a report by the active rules, or send it to manual review. Caller's transaction."""
    report = _lock_report(db, report_id)
    if report is None:
        return NotRouted("not_found")
    if not _waiting_for_routing(report):
        return NotRouted("already_routed")

    newest = db.execute(
        """
        select processing_status::text as status from public.ai_analyses
        where report_id = %s order by created_at desc, id desc limit 1
        """,
        (report_id,),
    ).fetchone()
    reason: ReviewReason
    if newest is None:
        reason = "ai_unavailable"
    elif newest["status"] == "pending":
        return NotRouted("analysis_pending")
    elif newest["status"] == "failed":
        reason = "ai_failed"
    else:
        analysis = latest_validated_analysis(db, report_id)
        if analysis is None:
            reason = "ai_failed"  # A succeeded row without a complete result.
        elif analysis.uncertain:
            reason = "uncertain"
        elif analysis.category_id is None:
            reason = "no_category"
        else:
            match = find_rule(db, analysis.category_id, report["location_id"])
            if match is not None:
                rule_id, team_id = match
                _assign(
                    db,
                    report,
                    team_id=team_id,
                    review_reason=None,
                    category_id=analysis.category_id,
                )
                return Routed(team_id=team_id, rule_id=rule_id)
            reason = "no_matching_rule"

    review_team = manual_review_team(db)
    _assign(db, report, team_id=review_team or report["assigned_team_id"], review_reason=reason)
    return InReview(reason=reason, team_id=review_team)


def route_manually(
    db: Connection, report_id: UUID, *, category_id: UUID, team_id: UUID, actor_id: UUID
) -> None:
    """A reviewer sets the category and sends a report in manual review to a team.

    The category becomes staff-confirmed. The caller checks that the reviewer
    may handle the report. Raises RoutingError with a reason that can be shown.
    """
    report = _lock_report(db, report_id)
    if report is None or report["review_reason"] is None:
        raise RoutingError("This report is not waiting for manual review.")
    category = db.execute(
        "select 1 from public.categories where id = %s and is_active", (category_id,)
    ).fetchone()
    if category is None:
        raise RoutingError("Choose an active category.")
    team = db.execute(
        "select is_manual_review from public.teams where id = %s and is_active", (team_id,)
    ).fetchone()
    if team is None:
        raise RoutingError("Choose an active team.")
    if team["is_manual_review"]:
        raise RoutingError("Choose the team that should handle the report, not manual review.")
    _assign(
        db,
        report,
        team_id=team_id,
        review_reason=None,
        category_id=category_id,
        confirmed_by=actor_id,
        actor_id=actor_id,
    )
