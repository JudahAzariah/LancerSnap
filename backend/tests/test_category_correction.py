"""Staff report details and category correction (LS-19; US-08, RC-03, RISK-01, RC-01).

Photo access by team scope is covered in test_media.py.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.routing import NotRouted, route_report
from tests.conftest import add_member, auth_as, create_location, create_team, create_user
from tests.test_analysis_schema import add_category
from tests.test_duplicates import make_report

Db = psycopg.Connection[Any]


@pytest.fixture
def world(db: Db) -> dict[str, Any]:
    location = create_location(db, "Library")
    lighting, plumbing = add_category(db, "Lighting"), add_category(db, "Plumbing")
    team_a, team_b = create_team(db, "Team A"), create_team(db, "Team B")
    report = make_report(db, location, category=lighting, team=team_a)
    db.execute("update public.reports set status = 'assigned' where id = %s", (report,))
    staff_a, staff_b, staff_none = (create_user(db, "staff") for _ in range(3))
    add_member(db, team_a, staff_a)
    add_member(db, team_b, staff_b)
    return {
        "report": report,
        "lighting": lighting,
        "plumbing": plumbing,
        "team_a": team_a,
        "staff_a": staff_a,
        "staff_b": staff_b,
        "staff_none": staff_none,
        "admin": create_user(db, "administrator"),
    }


def correct(client: TestClient, report: UUID, user: UUID, category: Any) -> Any:
    return client.put(
        f"/reports/{report}/category", headers=auth_as(user), json={"category_id": str(category)}
    )


def report_row(db: Db, report: UUID) -> dict[str, Any]:
    row = db.execute(
        "select status::text as status, assigned_team_id, category_id, category_confirmed_by,"
        " category_confirmed_at from public.reports where id = %s",
        (report,),
    ).fetchone()
    assert row is not None
    return row


def test_staff_on_the_team_see_the_details_and_others_do_not(
    client: TestClient, world: dict[str, Any]
) -> None:
    path = f"/reports/{world['report']}"
    for user in ("staff_a", "admin"):
        response = client.get(path, headers=auth_as(world[user]))
        assert response.status_code == 200
        assert response.json()["category"] == {
            "name": "Lighting",
            "source": "ai_suggestion",
            "uncertain": False,
        }
    for user in ("staff_b", "staff_none"):
        assert client.get(path, headers=auth_as(world[user])).status_code == 404


def test_a_correction_is_stored_as_a_staff_decision_apart_from_the_ai_suggestion(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    response = correct(client, world["report"], world["staff_a"], world["plumbing"])
    assert response.status_code == 200, response.text
    assert response.json() == {"name": "Plumbing", "source": "staff", "uncertain": False}

    row = report_row(db, world["report"])
    assert row["category_id"] == world["plumbing"]
    assert row["category_confirmed_by"] == world["staff_a"]
    assert row["category_confirmed_at"] is not None
    # The AI's suggestion is untouched.
    ai = db.execute(
        "select suggested_category_id from public.ai_analyses where report_id = %s",
        (world["report"],),
    ).fetchone()
    assert ai["suggested_category_id"] == world["lighting"]

    details = client.get(f"/reports/{world['report']}", headers=auth_as(world["staff_a"])).json()
    assert details["category"] == {"name": "Plumbing", "source": "staff", "uncertain": False}
    analysis = client.get(
        f"/reports/{world['report']}/analysis", headers=auth_as(world["staff_a"])
    ).json()
    assert analysis["category"]["name"] == "Lighting"


def test_staff_can_confirm_the_ai_suggestion_as_it_is(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    assert correct(client, world["report"], world["admin"], world["lighting"]).status_code == 200
    assert report_row(db, world["report"])["category_confirmed_by"] == world["admin"]


def test_a_correction_does_not_change_team_or_status(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    correct(client, world["report"], world["staff_a"], world["plumbing"])
    row = report_row(db, world["report"])
    assert (row["status"], row["assigned_team_id"]) == ("assigned", world["team_a"])
    history = db.execute(
        "select count(*) as n from public.status_history where report_id = %s",
        (world["report"],),
    ).fetchone()
    assert history["n"] == 0


def test_only_staff_handling_the_report_can_correct_it(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    for user in ("staff_b", "staff_none"):
        assert correct(client, world["report"], world[user], world["plumbing"]).status_code == 404
    student = create_user(db)
    assert correct(client, world["report"], student, world["plumbing"]).status_code == 403
    assert (
        client.put(
            f"/reports/{world['report']}/category", json={"category_id": str(world["plumbing"])}
        ).status_code
        == 401
    )
    assert report_row(db, world["report"])["category_confirmed_by"] is None


def test_the_category_must_exist_and_be_active(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    db.execute("update public.categories set is_active = false where id = %s", (world["plumbing"],))
    assert correct(client, world["report"], world["staff_a"], world["plumbing"]).status_code == 422
    unknown = "00000000-0000-0000-0000-000000000000"
    assert correct(client, world["report"], world["staff_a"], unknown).status_code == 422
    assert correct(client, world["report"], world["staff_a"], "nope").status_code == 422
    missing = correct(client, UUID(unknown), world["admin"], world["lighting"])
    assert missing.status_code == 404


def test_a_later_ai_result_never_overrides_a_staff_correction(
    client: TestClient, db: Db, world: dict[str, Any]
) -> None:
    """A report waiting in manual review that staff have recategorized stays as staff set it."""
    db.execute(
        "update public.reports set review_reason = 'uncertain' where id = %s", (world["report"],)
    )
    correct(client, world["report"], world["staff_a"], world["plumbing"])
    with app_db.connection() as conn:
        assert route_report(conn, world["report"]) == NotRouted("already_routed")
    assert report_row(db, world["report"])["category_id"] == world["plumbing"]
