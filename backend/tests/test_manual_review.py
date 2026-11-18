"""Manual-review fallback (LS-17; RC-02, RC-03, RC-10, DD-08, RISK-05, RC-01).

No real AI service is called.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.ai.mock import MockProvider, always_fail, mock_output
from tests.conftest import (
    FakeStorage,
    add_member,
    auth_as,
    create_team,
    create_user,
)
from tests.test_analysis import run_once, submit
from tests.test_analysis_schema import add_category
from tests.test_routing import CONFIDENT, add_rule, report_row

Db = psycopg.Connection[Any]

UNCERTAIN = MockProvider(lambda request: mock_output(request, category="Facilities"))
NO_CATEGORY = MockProvider(lambda request: mock_output(request, category=None))


@pytest.fixture
def setup(db: Db) -> dict[str, Any]:
    """Categories, a Facilities rule, a review team with a reviewer, and an admin."""
    facilities = add_category(db, "Facilities")
    it = add_category(db, "IT")
    facilities_team, it_team = create_team(db, "Facilities team"), create_team(db, "IT team")
    review_team = create_team(db, "Review team")
    db.execute("update public.teams set is_manual_review = true where id = %s", (review_team,))
    add_rule(db, facilities, facilities_team)
    reviewer = create_user(db, "staff")
    add_member(db, review_team, reviewer)
    outsider = create_user(db, "staff")
    add_member(db, it_team, outsider)
    return {
        "facilities": facilities,
        "it": it,
        "facilities_team": facilities_team,
        "it_team": it_team,
        "review_team": review_team,
        "reviewer": reviewer,
        "outsider": outsider,
        "admin": create_user(db, "administrator"),
    }


def review_state(db: Db, report_id: str) -> tuple[str, Any, str | None]:
    row = db.execute(
        "select status::text as status, assigned_team_id, review_reason from public.reports"
        " where id = %s",
        (report_id,),
    ).fetchone()
    return row["status"], row["assigned_team_id"], row["review_reason"]


# --- Reports that land in manual review ---------------------------------------------------


@pytest.mark.parametrize(
    ("provider", "reason"),
    [
        (MockProvider(always_fail("unavailable", retryable=False)), "ai_failed"),
        (UNCERTAIN, "uncertain"),
        (NO_CATEGORY, "uncertain"),  # No category is always marked uncertain (LS-12).
    ],
)
def test_failed_and_uncertain_reports_go_to_the_review_team(
    client: TestClient,
    db: Db,
    storage: FakeStorage,
    queue: Any,
    setup: dict[str, Any],
    provider: MockProvider,
    reason: str,
) -> None:
    receipt = submit(client, db, storage)
    run_once(provider, storage)
    assert review_state(db, receipt["id"]) == ("assigned", setup["review_team"], reason)


def test_a_report_with_no_matching_rule_goes_to_review(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(
        MockProvider(
            lambda request: mock_output(
                request, category="IT", confidence=0.9, uncertain=False, uncertainty_reason=None
            )
        ),
        storage,
    )
    assert review_state(db, receipt["id"]) == ("assigned", setup["review_team"], "no_matching_rule")


def test_a_confident_matching_report_skips_review(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(CONFIDENT, storage)
    assert review_state(db, receipt["id"]) == ("assigned", setup["facilities_team"], None)


def test_with_ai_off_a_report_goes_straight_to_review(
    client: TestClient, db: Db, storage: FakeStorage, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)  # Default queue: AI analysis is off.
    assert receipt["status"] == "assigned"
    assert review_state(db, receipt["id"]) == ("assigned", setup["review_team"], "ai_unavailable")


def test_the_student_is_not_told_it_is_in_review(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(UNCERTAIN, storage)
    body = client.get(f"/reports/{receipt['id']}", headers=auth_as(receipt["submitter_id"])).json()
    assert body["status"] == "assigned"
    assert "review_reason" not in body
    assert all(h["note"] is None for h in body["history"])


def test_without_a_review_team_reports_stay_unassigned_but_queued(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    db.execute("update public.teams set is_manual_review = false")
    receipt = submit(client, db, storage)
    run_once(UNCERTAIN, storage)
    assert review_state(db, receipt["id"]) == ("submitted", None, "uncertain")
    # Not lost: administrators see it.
    queue_items = client.get("/review-queue", headers=auth_as(setup["admin"])).json()
    assert [item["id"] for item in queue_items] == [receipt["id"]]


# --- The queue ----------------------------------------------------------------------------


def test_reviewers_and_admins_see_the_queue_with_reasons(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    failed = submit(client, db, storage, location_name="Library")
    run_once(MockProvider(always_fail("timeout", retryable=False)), storage)
    uncertain = submit(client, db, storage, location_name="Gym")
    run_once(UNCERTAIN, storage)
    routed = submit(client, db, storage, location_name="Hall")
    run_once(CONFIDENT, storage)

    for viewer in (setup["reviewer"], setup["admin"]):
        items = client.get("/review-queue", headers=auth_as(viewer)).json()
        by_id = {item["id"]: item for item in items}
        assert set(by_id) == {failed["id"], uncertain["id"]}
        assert routed["id"] not in by_id
        assert by_id[failed["id"]]["review_reason"] == "ai_failed"
        assert by_id[failed["id"]]["ai"]["error"] == "timeout"
        assert by_id[uncertain["id"]]["review_reason"] == "uncertain"
        assert by_id[uncertain["id"]]["ai"]["category"] == "Facilities"
        assert by_id[uncertain["id"]]["team_name"] == "Review team"


def test_only_reviewers_and_admins_can_see_the_queue(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(UNCERTAIN, storage)
    assert client.get("/review-queue", headers=auth_as(receipt["submitter_id"])).status_code == 403
    assert client.get("/review-queue", headers=auth_as(setup["outsider"])).json() == []


# --- Routing a report out of review -------------------------------------------------------


def test_a_reviewer_sets_the_category_and_routes_the_report(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(UNCERTAIN, storage)
    response = client.post(
        f"/reports/{receipt['id']}/route",
        headers=auth_as(setup["reviewer"]),
        json={"category_id": str(setup["it"]), "team_id": str(setup["it_team"])},
    )
    assert response.status_code == 200
    assert review_state(db, receipt["id"]) == ("assigned", setup["it_team"], None)
    row = report_row(db, receipt["id"])
    assert row["category_id"] == setup["it"]
    assert row["category_confirmed_by"] == setup["reviewer"]  # Now staff-confirmed.

    # The student now sees the staff-confirmed category.
    view = client.get(f"/reports/{receipt['id']}", headers=auth_as(receipt["submitter_id"])).json()
    assert view["category"] == {"name": "IT", "source": "staff", "uncertain": False}
    # Out of the queue, and never moved again by automatic routing.
    assert client.get("/review-queue", headers=auth_as(setup["admin"])).json() == []
    db.execute("insert into public.ai_analyses (report_id) values (%s)", (receipt["id"],))
    run_once(CONFIDENT, storage)
    assert review_state(db, receipt["id"])[1] == setup["it_team"]


def test_manual_routing_is_refused_outside_review_and_scope(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(UNCERTAIN, storage)
    url = f"/reports/{receipt['id']}/route"
    body = {"category_id": str(setup["it"]), "team_id": str(setup["it_team"])}

    assert client.post(url, headers=auth_as(receipt["submitter_id"]), json=body).status_code == 403
    assert client.post(url, headers=auth_as(setup["outsider"]), json=body).status_code == 404

    to_review = {**body, "team_id": str(setup["review_team"])}
    refused = client.post(url, headers=auth_as(setup["admin"]), json=to_review)
    assert refused.status_code == 422
    assert "not manual review" in refused.json()["detail"]
    db.execute("update public.teams set is_active = false where id = %s", (setup["it_team"],))
    assert client.post(url, headers=auth_as(setup["admin"]), json=body).status_code == 422

    # A report that was routed by rule is not in review.
    routed = submit(client, db, storage, location_name="Hall")
    run_once(CONFIDENT, storage)
    not_in_review = client.post(
        f"/reports/{routed['id']}/route",
        headers=auth_as(setup["admin"]),
        json={"category_id": str(setup["facilities"]), "team_id": str(setup["facilities_team"])},
    )
    assert not_in_review.status_code == 422


def test_a_failed_report_can_be_retried_and_routes_itself_out_of_review(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    receipt = submit(client, db, storage)
    run_once(MockProvider(always_fail("unavailable", retryable=False)), storage)
    assert review_state(db, receipt["id"])[2] == "ai_failed"

    # A reviewer on the review team can send it for analysis again (LS-11 endpoint).
    retry = client.post(f"/reports/{receipt['id']}/analysis", headers=auth_as(setup["reviewer"]))
    assert retry.status_code == 202
    run_once(CONFIDENT, storage)
    assert review_state(db, receipt["id"]) == ("assigned", setup["facilities_team"], None)
    history = db.execute(
        "select to_status::text from public.status_history where report_id = %s"
        " order by created_at",
        (receipt["id"],),
    ).fetchall()
    # Still one "assigned" entry: moving between teams is not a status change.
    assert [h["to_status"] for h in history] == ["submitted", "assigned"]


def test_reviewers_can_list_destination_teams(
    client: TestClient, db: Db, setup: dict[str, Any]
) -> None:
    names = [t["name"] for t in client.get("/teams", headers=auth_as(setup["reviewer"])).json()]
    assert names == ["Facilities team", "IT team"]  # Active, and not the review team.
    student = create_user(db)
    assert client.get("/teams", headers=auth_as(student)).status_code == 403


# --- Choosing the review team -------------------------------------------------------------


def test_an_administrator_moves_the_review_team(
    client: TestClient, db: Db, setup: dict[str, Any]
) -> None:
    headers = auth_as(setup["admin"])
    moved = client.patch(
        f"/admin/teams/{setup['it_team']}", headers=headers, json={"is_manual_review": True}
    )
    assert moved.status_code == 200 and moved.json()["is_manual_review"] is True
    marked = db.execute("select id from public.teams where is_manual_review").fetchall()
    assert [row["id"] for row in marked] == [setup["it_team"]]
    teams = {t["name"]: t for t in client.get("/admin/teams", headers=headers).json()}
    assert teams["Review team"]["is_manual_review"] is False
    staff = auth_as(setup["reviewer"])
    blocked = client.patch(
        f"/admin/teams/{setup['it_team']}", headers=staff, json={"is_manual_review": False}
    )
    assert blocked.status_code == 403


def test_review_team_with_no_reviewers_still_holds_reports(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, setup: dict[str, Any]
) -> None:
    db.execute("delete from public.team_members where team_id = %s", (setup["review_team"],))
    receipt = submit(client, db, storage)
    run_once(UNCERTAIN, storage)
    items = client.get("/review-queue", headers=auth_as(setup["admin"])).json()
    assert [item["id"] for item in items] == [receipt["id"]]
    assert UUID(items[0]["id"]) == UUID(receipt["id"])
