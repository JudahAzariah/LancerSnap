"""Staff report queue (LS-18; US-07, RC-01, RC-07)."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.conftest import add_member, auth_as, create_location, create_team, create_user
from tests.test_analysis_schema import add_category
from tests.test_duplicates import make_report

Db = psycopg.Connection[Any]


def assign(db: Db, report: UUID, team: UUID, status: str = "assigned") -> None:
    db.execute(
        "update public.reports set assigned_team_id = %s, status = %s where id = %s",
        (team, status, report),
    )


def set_ai(
    db: Db, report: UUID, *, priority: str, hazard: bool = False, uncertain: bool = False
) -> None:
    db.execute(
        "update public.ai_analyses set suggested_priority = %s, is_potential_safety_hazard = %s,"
        " is_uncertain = %s, uncertainty_reason = case when %s then 'Unclear' end"
        " where report_id = %s",
        (priority, hazard, uncertain, uncertain, report),
    )


@pytest.fixture
def world(db: Db) -> dict[str, Any]:
    location = create_location(db, "Library")
    lighting = add_category(db, "Lighting")
    team_a, team_b = create_team(db, "Team A"), create_team(db, "Team B")
    a_low = make_report(db, location, hours_ago=3, category=lighting, note="Dim light")
    a_hazard = make_report(db, location, hours_ago=1, category=lighting, note="Sparks")
    a_high = make_report(db, location, hours_ago=2, category=lighting, note="Out")
    b_report = make_report(db, location, hours_ago=1, category=lighting)
    unassigned = make_report(db, location, category=lighting)
    for report in (a_low, a_hazard, a_high):
        assign(db, report, team_a)
    assign(db, b_report, team_b, status="in_progress")
    set_ai(db, a_low, priority="low")
    set_ai(db, a_hazard, priority="high", hazard=True)
    set_ai(db, a_high, priority="high", uncertain=True)
    staff_a, staff_b = create_user(db, "staff"), create_user(db, "staff")
    add_member(db, team_a, staff_a)
    add_member(db, team_b, staff_b)
    return {
        "a_low": a_low,
        "a_hazard": a_hazard,
        "a_high": a_high,
        "b_report": b_report,
        "unassigned": unassigned,
        "staff_a": staff_a,
        "staff_b": staff_b,
        "admin": create_user(db, "administrator"),
        "lighting": lighting,
    }


def queue(client: TestClient, user: UUID, **params: Any) -> list[dict[str, Any]]:
    response = client.get("/staff/queue", headers=auth_as(user), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def ids(items: list[dict[str, Any]]) -> list[str]:
    return [item["id"] for item in items]


def test_staff_see_only_their_teams_reports(client: TestClient, world: dict[str, Any]) -> None:
    a_items = queue(client, world["staff_a"])
    assert set(ids(a_items)) == {str(world[k]) for k in ("a_low", "a_hazard", "a_high")}
    assert ids(queue(client, world["staff_b"])) == [str(world["b_report"])]


def test_administrators_see_every_report(client: TestClient, world: dict[str, Any]) -> None:
    assert len(queue(client, world["admin"])) == 5


def test_students_and_staff_without_a_team_get_nothing(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    student = create_user(db)
    assert client.get("/staff/queue", headers=auth_as(student)).status_code == 403
    assert queue(client, create_user(db, "staff")) == []
    # A former staff member keeps no scope, even with a leftover membership row.
    db.execute("update public.profiles set role = 'student' where id = %s", (world["staff_a"],))
    assert client.get("/staff/queue", headers=auth_as(world["staff_a"])).status_code == 403


def test_each_item_carries_what_staff_triage_on(client: TestClient, world: dict[str, Any]) -> None:
    items = {item["id"]: item for item in queue(client, world["staff_a"])}
    hazard = items[str(world["a_hazard"])]
    assert hazard["reference_code"].startswith("RPT-")
    assert hazard["status"] == "assigned"
    assert hazard["location_name"] == "Library"
    assert hazard["team_name"] == "Team A"
    assert hazard["category"] == {"name": "Lighting", "source": "ai_suggestion"}
    assert hazard["priority"] == "high"
    assert hazard["potential_safety_hazard"] is True
    assert hazard["ai_uncertain"] is False and hazard["in_manual_review"] is False
    assert hazard["created_at"] and hazard["updated_at"]
    assert items[str(world["a_high"])]["ai_uncertain"] is True


def test_default_order_puts_safety_hazards_then_priority_first(
    client: TestClient, world: dict[str, Any]
) -> None:
    assert ids(queue(client, world["staff_a"])) == [
        str(world["a_hazard"]),
        str(world["a_high"]),
        str(world["a_low"]),
    ]
    assert ids(queue(client, world["staff_a"], sort="newest"))[0] == str(world["a_hazard"])
    assert ids(queue(client, world["staff_a"], sort="oldest"))[0] == str(world["a_low"])


def test_filters_by_status_priority_and_hazard(client: TestClient, world: dict[str, Any]) -> None:
    admin = world["admin"]
    assert ids(queue(client, admin, status="in_progress")) == [str(world["b_report"])]
    both = queue(client, admin, status=["in_progress", "submitted"])
    assert set(ids(both)) == {str(world["b_report"]), str(world["unassigned"])}
    assert set(ids(queue(client, world["staff_a"], priority="high"))) == {
        str(world["a_hazard"]),
        str(world["a_high"]),
    }
    assert ids(queue(client, world["staff_a"], hazards_only=True)) == [str(world["a_hazard"])]
    bad = client.get("/staff/queue", headers=auth_as(admin), params={"status": "merged"})
    assert bad.status_code == 422


def test_queue_reflects_current_persisted_data(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    db.execute(
        "update public.reports set status = 'in_progress', category_id = %s,"
        " category_confirmed_by = %s, category_confirmed_at = now(), review_reason = 'uncertain'"
        " where id = %s",
        (world["lighting"], world["staff_a"], world["a_low"]),
    )
    item = next(i for i in queue(client, world["staff_a"]) if i["id"] == str(world["a_low"]))
    assert item["status"] == "in_progress"
    assert item["category"] == {"name": "Lighting", "source": "staff"}
    assert item["in_manual_review"] is True
