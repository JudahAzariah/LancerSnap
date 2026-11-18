"""Configurable routing engine (LS-16; US-11, RC-04, RC-05, DD-04, DD-05, OQ-01).

No real AI service is called.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.ai.mock import MockProvider, mock_output
from app.routing import InReview, NotRouted, Routed, find_rule, route_report
from tests.conftest import FakeStorage, auth_as, create_location, create_team, create_user
from tests.test_analysis import run_once, submit
from tests.test_analysis_schema import add_category
from tests.test_duplicates import make_report

Db = psycopg.Connection[Any]


def add_rule(
    db: Db,
    category: UUID,
    team: UUID,
    *,
    location: UUID | None = None,
    active: bool = True,
) -> UUID:
    row = db.execute(
        """
        insert into public.routing_rules (category_id, location_id, team_id, is_active)
        values (%s, %s, %s, %s) returning id
        """,
        (category, location, team, active),
    ).fetchone()
    return UUID(str(row["id"]))


def route(report_id: UUID) -> Any:
    with app_db.connection() as conn:
        return route_report(conn, report_id)


def rule_for(category: UUID, location: UUID) -> Any:
    with app_db.connection() as conn:
        return find_rule(conn, category, location)


def report_row(db: Db, report_id: UUID | str) -> dict[str, Any]:
    return db.execute(
        "select status::text as status, assigned_team_id, assigned_to, category_id,"
        " category_confirmed_by from public.reports where id = %s",
        (report_id,),
    ).fetchone()


# --- Rule matching --------------------------------------------------------------------


def test_a_category_wide_rule_matches_at_any_location(db: Db) -> None:
    lighting, team = add_category(db, "Lighting"), create_team(db)
    rule = add_rule(db, lighting, team)
    assert rule_for(lighting, create_location(db)) == (rule, team)


def test_a_location_rule_beats_the_category_wide_rule(db: Db) -> None:
    lighting = add_category(db, "Lighting")
    library, gym = create_location(db), create_location(db)
    general, library_team = create_team(db), create_team(db)
    add_rule(db, lighting, general)
    specific = add_rule(db, lighting, library_team, location=library)
    assert rule_for(lighting, library) == (specific, library_team)
    assert rule_for(lighting, gym)[1] == general


def test_inactive_rules_teams_and_categories_never_match(db: Db) -> None:
    lighting, plumbing, retired = (
        add_category(db, "Lighting"),
        add_category(db, "Plumbing"),
        add_category(db, "Retired"),
    )
    location = create_location(db)
    add_rule(db, lighting, create_team(db), active=False)
    inactive_team = create_team(db)
    db.execute("update public.teams set is_active = false where id = %s", (inactive_team,))
    add_rule(db, plumbing, inactive_team)
    add_rule(db, retired, create_team(db))
    db.execute("update public.categories set is_active = false where id = %s", (retired,))

    for category in (lighting, plumbing, retired):
        assert rule_for(category, location) is None


def test_no_rule_for_the_category_means_no_match(db: Db) -> None:
    lighting, plumbing = add_category(db, "Lighting"), add_category(db, "Plumbing")
    add_rule(db, lighting, create_team(db))
    assert rule_for(plumbing, create_location(db)) is None


# --- Routing a report -------------------------------------------------------------------


def test_a_confident_matching_report_is_assigned_to_the_team(db: Db) -> None:
    lighting, team = add_category(db, "Lighting"), create_team(db)
    rule = add_rule(db, lighting, team)
    report = make_report(db, create_location(db), category=lighting)

    assert route(report) == Routed(team_id=team, rule_id=rule)
    row = report_row(db, report)
    assert row["status"] == "assigned"
    assert row["assigned_team_id"] == team
    assert row["assigned_to"] is None  # A team, never a person (RC-05).
    assert row["category_id"] == lighting
    assert row["category_confirmed_by"] is None  # Still only an AI suggestion.

    (history,) = db.execute(
        "select from_status::text, to_status::text, actor_id, note from public.status_history"
        " where report_id = %s",
        (report,),
    ).fetchall()
    assert history == {
        "from_status": "submitted",
        "to_status": "assigned",
        "actor_id": None,  # The system did it.
        "note": None,  # The student is not told which team.
    }


@pytest.mark.parametrize(
    ("setup", "reason"),
    [
        ("no_analysis", "ai_unavailable"),
        ("uncertain", "uncertain"),
        ("no_category", "uncertain"),
        ("no_rule", "no_matching_rule"),
    ],
)
def test_reports_that_cannot_be_routed_go_to_manual_review(db: Db, setup: str, reason: str) -> None:
    lighting, plumbing = add_category(db, "Lighting"), add_category(db, "Plumbing")
    add_rule(db, lighting, create_team(db))
    location = create_location(db)
    report = make_report(db, location, category=plumbing if setup == "no_rule" else lighting)
    if setup == "no_analysis":
        db.execute("delete from public.ai_analyses where report_id = %s", (report,))
    if setup in ("uncertain", "no_category"):
        db.execute(
            "update public.ai_analyses set is_uncertain = true, uncertainty_reason = 'Unclear',"
            " suggested_category_id = %s where report_id = %s",
            (None if setup == "no_category" else lighting, report),
        )

    # No review team is configured here: the report stays unassigned, with its reason
    # (LS-17; see test_manual_review.py for the review team).
    assert route(report) == InReview(reason=reason, team_id=None)
    row = report_row(db, report)
    assert (row["status"], row["assigned_team_id"]) == ("submitted", None)
    stored = db.execute(
        "select review_reason from public.reports where id = %s", (report,)
    ).fetchone()
    assert stored["review_reason"] == reason
    assert db.execute("select count(*) as n from public.status_history").fetchone()["n"] == 0


def test_a_report_already_being_handled_is_never_rerouted(db: Db) -> None:
    lighting = add_category(db, "Lighting")
    first, second = create_team(db), create_team(db)
    rule = add_rule(db, lighting, first)
    report = make_report(db, create_location(db), category=lighting)
    route(report)
    db.execute("update public.routing_rules set team_id = %s where id = %s", (second, rule))

    assert route(report) == NotRouted("already_routed")
    assert report_row(db, report)["assigned_team_id"] == first


# --- In the pipeline -------------------------------------------------------------------


CONFIDENT = MockProvider(
    lambda request: mock_output(
        request, category="Facilities", confidence=0.9, uncertain=False, uncertainty_reason=None
    )
)


def test_reports_are_routed_after_a_confident_analysis(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    facilities, team = add_category(db, "Facilities"), create_team(db)
    add_rule(db, facilities, team)
    receipt = submit(client, db, storage)
    run_once(CONFIDENT, storage)

    row = report_row(db, receipt["id"])
    assert (row["status"], row["assigned_team_id"]) == ("assigned", team)

    # The student sees "Assigned", not which team.
    view = client.get(f"/reports/{receipt['id']}", headers=auth_as(receipt["submitter_id"]))
    body = view.json()
    assert body["status"] == "assigned"
    assert "assigned_team_id" not in body and "team" not in body
    assert [h["note"] for h in body["history"]] == [None, None]


def test_changing_a_rule_changes_where_new_reports_go(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    facilities = add_category(db, "Facilities")
    first, second = create_team(db), create_team(db)
    rule = add_rule(db, facilities, first)
    before = submit(client, db, storage)
    run_once(CONFIDENT, storage)

    admin = create_user(db, "administrator")
    client.patch(
        f"/admin/routing-rules/{rule}",
        headers=auth_as(admin),
        json={"team_id": str(second)},
    )
    after = submit(client, db, storage, location_name="Library")
    run_once(CONFIDENT, storage)

    assert report_row(db, before["id"])["assigned_team_id"] == first  # Unchanged.
    assert report_row(db, after["id"])["assigned_team_id"] == second


def test_an_uncertain_analysis_is_not_routed(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    facilities = add_category(db, "Facilities")
    add_rule(db, facilities, create_team(db))
    receipt = submit(client, db, storage)
    run_once(MockProvider(lambda request: mock_output(request, category="Facilities")), storage)
    assert report_row(db, receipt["id"])["status"] == "submitted"


def test_a_routing_failure_never_breaks_the_analysis(
    client: TestClient,
    db: Db,
    storage: FakeStorage,
    queue: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.routing as routing_module

    def broken(*args: Any) -> Any:
        raise RuntimeError("routing bug")

    monkeypatch.setattr(routing_module, "route_report", broken)
    facilities = add_category(db, "Facilities")
    add_rule(db, facilities, create_team(db))
    receipt = submit(client, db, storage)
    run_once(CONFIDENT, storage)
    status = db.execute(
        "select processing_status::text as s from public.ai_analyses where report_id = %s",
        (receipt["id"],),
    ).fetchone()["s"]
    assert status == "succeeded"
    # The analysis is kept; the report just stays unrouted, for manual review.
    assert report_row(db, receipt["id"])["status"] == "submitted"


# --- Administrator configuration ---------------------------------------------------------


def test_only_administrators_can_see_or_change_routing(client: TestClient, db: Db) -> None:
    category, team = add_category(db, "Lighting"), create_team(db)
    for role in ("student", "staff"):
        headers = auth_as(create_user(db, role))
        assert client.get("/admin/teams", headers=headers).status_code == 403
        assert client.get("/admin/routing-rules", headers=headers).status_code == 403
        created = client.post(
            "/admin/routing-rules",
            headers=headers,
            json={"category_id": str(category), "team_id": str(team)},
        )
        assert created.status_code == 403
        assert client.post("/admin/teams", headers=headers, json={"name": "X"}).status_code == 403
    assert db.execute("select count(*) as n from public.routing_rules").fetchone()["n"] == 0


def test_administrator_manages_teams(client: TestClient, db: Db) -> None:
    headers = auth_as(create_user(db, "administrator"))
    created = client.post(
        "/admin/teams", headers=headers, json={"name": "  Grounds  ", "description": "Outdoors"}
    )
    assert created.status_code == 201
    team = created.json()
    assert (team["name"], team["is_active"], team["member_count"]) == ("Grounds", True, 0)
    assert client.post("/admin/teams", headers=headers, json={"name": "Grounds"}).status_code == 409

    updated = client.patch(
        f"/admin/teams/{team['id']}", headers=headers, json={"is_active": False}
    ).json()
    assert updated["is_active"] is False and updated["name"] == "Grounds"
    assert [t["name"] for t in client.get("/admin/teams", headers=headers).json()] == ["Grounds"]
    missing = client.patch(f"/admin/teams/{UUID(int=0)}", headers=headers, json={"name": "Y"})
    assert missing.status_code == 404


def test_administrator_saves_and_changes_routing_rules(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    headers = auth_as(admin)
    lighting, library = add_category(db, "Lighting"), create_location(db, "Library")
    team, other = create_team(db, "Electrical"), create_team(db, "Library Services")

    created = client.post(
        "/admin/routing-rules",
        headers=headers,
        json={"category_id": str(lighting), "team_id": str(team)},
    )
    assert created.status_code == 201
    rule = created.json()
    assert rule["category"]["name"] == "Lighting"
    assert rule["location"] is None and rule["team"]["name"] == "Electrical"
    stored = db.execute(
        "select updated_by from public.routing_rules where id = %s", (rule["id"],)
    ).fetchone()
    assert stored["updated_by"] == admin

    # A second active category-wide rule would make routing ambiguous.
    duplicate = client.post(
        "/admin/routing-rules",
        headers=headers,
        json={"category_id": str(lighting), "team_id": str(other)},
    )
    assert duplicate.status_code == 409
    # A location-specific rule alongside it is fine.
    specific = client.post(
        "/admin/routing-rules",
        headers=headers,
        json={
            "category_id": str(lighting),
            "location_id": str(library),
            "team_id": str(other),
        },
    )
    assert specific.status_code == 201
    assert specific.json()["location"]["name"] == "Library"

    moved = client.patch(
        f"/admin/routing-rules/{rule['id']}", headers=headers, json={"team_id": str(other)}
    ).json()
    assert moved["team"]["name"] == "Library Services"
    off = client.patch(
        f"/admin/routing-rules/{rule['id']}", headers=headers, json={"is_active": False}
    ).json()
    assert off["is_active"] is False
    assert len(client.get("/admin/routing-rules", headers=headers).json()) == 2


def test_rules_must_point_at_active_configuration(client: TestClient, db: Db) -> None:
    headers = auth_as(create_user(db, "administrator"))
    lighting, retired = add_category(db, "Lighting"), add_category(db, "Retired")
    db.execute("update public.categories set is_active = false where id = %s", (retired,))
    team, closed_team = create_team(db), create_team(db)
    db.execute("update public.teams set is_active = false where id = %s", (closed_team,))

    def post(**body: Any) -> int:
        return client.post(
            "/admin/routing-rules", headers=headers, json={k: str(v) for k, v in body.items()}
        ).status_code

    assert post(category_id=retired, team_id=team) == 422
    assert post(category_id=lighting, team_id=closed_team) == 422
    assert post(category_id=lighting, team_id=team, location_id=UUID(int=0)) == 422
    assert post(category_id=UUID(int=0), team_id=team) == 422
    # Rules only ever name a team: there is no field for a person.
    assert post(category_id=lighting, team_id=team, assigned_to=UUID(int=1)) == 201
    rule = db.execute("select * from public.routing_rules").fetchone()
    assert "assigned_to" not in rule
