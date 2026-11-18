"""Teams and routing rules, for administrators only (LS-16; US-11, RC-04, RC-05).

* `/admin/teams`: list, create, and update teams (rename, describe, activate
  or deactivate). Teams are never deleted, so history keeps its meaning.
* `/admin/routing-rules`: list, create, and update rules. A rule sends a
  category (optionally only at one location) to a team. Rules are never
  deleted; they are deactivated.

Every rule points at a team, never a person (RC-05). Changing a rule changes
how new reports are routed, with no code or app change (RC-04). The seeded
example teams and rules are unverified (OQ-01) and say so in their names.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, StringConstraints

from app.authz import AdminProfile
from app.db import Connection, Db

router = APIRouter(prefix="/admin", tags=["administration"])

TeamName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


# --- Teams ---------------------------------------------------------------------


class Team(BaseModel):
    id: UUID
    name: str
    description: str | None
    is_active: bool
    is_manual_review: bool
    member_count: int


class TeamCreate(BaseModel):
    name: TeamName
    description: Description | None = None


class TeamUpdate(BaseModel):
    name: TeamName | None = None
    description: Description | None = None
    is_active: bool | None = None
    # True: this team receives reports for manual review (LS-17). Only one
    # team can be the review team; marking one unmarks the others.
    is_manual_review: bool | None = None


_TEAM_SELECT = """
    select t.id, t.name, t.description, t.is_active, t.is_manual_review,
           (select count(*)::int from public.team_members m where m.team_id = t.id)
               as member_count
    from public.teams t
"""


def _team(db: Connection, team_id: UUID) -> Team:
    row = db.execute(f"{_TEAM_SELECT} where t.id = %s", (team_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return Team(**row)


def _team_name_conflict() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail="A team with that name already exists"
    )


@router.get("/teams")
def list_teams(admin: AdminProfile, db: Db) -> list[Team]:
    return [Team(**row) for row in db.execute(f"{_TEAM_SELECT} order by t.name").fetchall()]


@router.post("/teams", status_code=status.HTTP_201_CREATED)
def create_team(body: TeamCreate, admin: AdminProfile, db: Db) -> Team:
    try:
        row = db.execute(
            "insert into public.teams (name, description) values (%s, %s) returning id",
            (body.name, body.description or None),
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _team_name_conflict() from None
    assert row is not None
    return _team(db, row["id"])


@router.patch("/teams/{team_id}")
def update_team(team_id: UUID, body: TeamUpdate, admin: AdminProfile, db: Db) -> Team:
    changes = body.model_dump(exclude_none=True)
    if changes.get("is_manual_review"):
        # Only one review team: unmark the current one first.
        db.execute(
            "update public.teams set is_manual_review = false where is_manual_review and id <> %s",
            (team_id,),
        )
    try:
        row = db.execute(
            """
            update public.teams
            set name = coalesce(%(name)s, name),
                description = coalesce(%(description)s, description),
                is_active = coalesce(%(is_active)s, is_active),
                is_manual_review = coalesce(%(is_manual_review)s, is_manual_review)
            where id = %(id)s
            returning id
            """,
            {"id": team_id, **{key: changes.get(key) for key in TeamUpdate.model_fields}},
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _team_name_conflict() from None
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return _team(db, team_id)


# --- Routing rules ---------------------------------------------------------------


class NamedRef(BaseModel):
    id: UUID
    name: str


class RoutingRule(BaseModel):
    id: UUID
    category: NamedRef
    # Null: applies at every location.
    location: NamedRef | None
    team: NamedRef
    is_active: bool
    updated_at: datetime


class RuleCreate(BaseModel):
    category_id: UUID
    location_id: UUID | None = None
    team_id: UUID


class RuleUpdate(BaseModel):
    team_id: UUID | None = None
    is_active: bool | None = None


_RULE_SELECT = """
    select r.id, r.is_active, r.updated_at,
           c.id as category_id, c.name as category_name,
           l.id as location_id, l.name as location_name,
           t.id as team_id, t.name as team_name
    from public.routing_rules r
    join public.categories c on c.id = r.category_id
    left join public.locations l on l.id = r.location_id
    join public.teams t on t.id = r.team_id
"""


def _rule_from_row(row: dict[str, object]) -> RoutingRule:
    return RoutingRule(
        id=row["id"],
        category=NamedRef(id=row["category_id"], name=row["category_name"]),
        location=(
            NamedRef(id=row["location_id"], name=row["location_name"])
            if row["location_id"] is not None
            else None
        ),
        team=NamedRef(id=row["team_id"], name=row["team_name"]),
        is_active=row["is_active"],
        updated_at=row["updated_at"],
    )


def _rule(db: Connection, rule_id: UUID) -> RoutingRule:
    row = db.execute(f"{_RULE_SELECT} where r.id = %s", (rule_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routing rule not found")
    return _rule_from_row(row)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _rule_conflict() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="An active rule already exists for this category and location. "
        "Change or deactivate that rule instead.",
    )


def _require_active(db: Connection, table: str, row_id: UUID, detail: str) -> None:
    row = db.execute(
        f"select 1 from public.{table} where id = %s and is_active", (row_id,)
    ).fetchone()
    if row is None:
        raise _invalid(detail)


@router.get("/routing-rules")
def list_rules(admin: AdminProfile, db: Db) -> list[RoutingRule]:
    rows = db.execute(
        f"{_RULE_SELECT} order by c.name, l.name nulls first, r.created_at"
    ).fetchall()
    return [_rule_from_row(row) for row in rows]


@router.post("/routing-rules", status_code=status.HTTP_201_CREATED)
def create_rule(body: RuleCreate, admin: AdminProfile, db: Db) -> RoutingRule:
    _require_active(db, "categories", body.category_id, "Choose an active category.")
    if body.location_id is not None:
        _require_active(db, "locations", body.location_id, "Choose an active location.")
    _require_active(db, "teams", body.team_id, "Choose an active team.")
    try:
        row = db.execute(
            """
            insert into public.routing_rules (category_id, location_id, team_id, updated_by)
            values (%s, %s, %s, %s) returning id
            """,
            (body.category_id, body.location_id, body.team_id, admin.id),
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _rule_conflict() from None
    assert row is not None
    return _rule(db, row["id"])


@router.patch("/routing-rules/{rule_id}")
def update_rule(rule_id: UUID, body: RuleUpdate, admin: AdminProfile, db: Db) -> RoutingRule:
    """Point a rule at another team, or turn it on or off."""
    if body.team_id is not None:
        _require_active(db, "teams", body.team_id, "Choose an active team.")
    try:
        row = db.execute(
            """
            update public.routing_rules
            set team_id = coalesce(%s, team_id),
                is_active = coalesce(%s, is_active),
                updated_by = %s
            where id = %s
            returning id
            """,
            (body.team_id, body.is_active, admin.id, rule_id),
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _rule_conflict() from None
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routing rule not found")
    return _rule(db, rule_id)
