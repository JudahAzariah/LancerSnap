"""Configurable routing engine (LS-16; US-11, RC-04, RC-05, DD-04, DD-05).

Sends a report to a team queue using the administrator-configured rules in
`routing_rules`. No team, category, or location is named in this code: change
the rules and routing changes, with no code or app change (RC-04).

A report is routed when all of these hold:

* it is still `submitted` and has no team (routing never moves a report that
  is already being handled);
* its newest validated AI analysis (LS-12) is **confident**: it has a category
  and is not marked uncertain (RC-02); and
* an active rule matches its category, at an active team. A rule for the
  report's own location wins over a category-wide rule (no location).

Routing assigns the report to the rule's **team**, never to a person (RC-05),
records the category used, and moves the report from `submitted` to
`assigned` with a system entry in its status history (no actor, no note, so
the student is not told which team handles it). Anything else leaves the
report unrouted for the manual-review fallback (LS-17), with the reason.
"""

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from app.analysis import latest_validated_analysis
from app.db import Connection

NotRoutedReason = Literal[
    "not_found",
    "already_routed",
    "no_analysis",
    "uncertain",
    "no_category",
    "no_matching_rule",
]


@dataclass(frozen=True)
class Routed:
    team_id: UUID
    rule_id: UUID


@dataclass(frozen=True)
class NotRouted:
    """Left for manual review (LS-17), and why."""

    reason: NotRoutedReason


RoutingOutcome = Routed | NotRouted


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


def route_report(db: Connection, report_id: UUID) -> RoutingOutcome:
    """Apply the active routing configuration to one report. Part of the caller's transaction."""
    report = db.execute(
        """
        select id, status::text as status, assigned_team_id, location_id
        from public.reports where id = %s for update
        """,
        (report_id,),
    ).fetchone()
    if report is None:
        return NotRouted("not_found")
    if report["status"] != "submitted" or report["assigned_team_id"] is not None:
        return NotRouted("already_routed")

    analysis = latest_validated_analysis(db, report_id)
    if analysis is None:
        return NotRouted("no_analysis")
    if analysis.uncertain:
        return NotRouted("uncertain")
    if analysis.category_id is None:
        return NotRouted("no_category")

    match = find_rule(db, analysis.category_id, report["location_id"])
    if match is None:
        return NotRouted("no_matching_rule")
    rule_id, team_id = match

    db.execute(
        """
        update public.reports
        set assigned_team_id = %s, category_id = %s, status = 'assigned'
        where id = %s
        """,
        (team_id, analysis.category_id, report_id),
    )
    db.execute(
        """
        insert into public.status_history (report_id, from_status, to_status, actor_id)
        values (%s, 'submitted', 'assigned', null)
        """,
        (report_id,),
    )
    return Routed(team_id=team_id, rule_id=rule_id)
