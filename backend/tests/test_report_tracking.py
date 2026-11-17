"""Tracking submitted reports (LS-10; US-03, RC-01, RC-12)."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.conftest import (
    FakeStorage,
    add_member,
    auth_as,
    create_location,
    create_team,
    create_user,
)

Db = psycopg.Connection[Any]


def _submit(client: TestClient, storage: FakeStorage, student: UUID, location: UUID) -> Any:
    ticket = client.post(
        "/media/uploads",
        headers=auth_as(student),
        json={"content_type": "image/jpeg", "size_bytes": 1000},
    ).json()
    storage.put(ticket["object_path"])
    response = client.post(
        "/reports",
        headers=auth_as(student),
        json={"media_id": ticket["media_id"], "location_id": str(location), "note": "Leak"},
    )
    assert response.status_code == 201
    return response.json()


# --- My reports -------------------------------------------------------------------


def test_student_sees_only_their_own_reports_newest_first(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    me, other = create_user(db), create_user(db)
    location = create_location(db, "Yeager Center")
    first = _submit(client, storage, me, location)
    second = _submit(client, storage, me, location)
    _submit(client, storage, other, location)

    response = client.get("/reports/mine", headers=auth_as(me))
    assert response.status_code == 200
    reports = response.json()
    assert [r["reference_code"] for r in reports] == [
        second["reference_code"],
        first["reference_code"],
    ]
    assert reports[0]["status"] == "submitted"
    assert reports[0]["location"]["name"] == "Yeager Center"
    assert set(reports[0]) == {
        "id",
        "reference_code",
        "status",
        "location",
        "created_at",
        "updated_at",
    }


def test_student_with_no_reports_gets_an_empty_list(client: TestClient, db: Db) -> None:
    response = client.get("/reports/mine", headers=auth_as(create_user(db)))
    assert response.status_code == 200
    assert response.json() == []


def test_my_reports_requires_sign_in(client: TestClient, db: Db) -> None:
    assert client.get("/reports/mine").status_code == 401


# --- Report details -------------------------------------------------------------------


def test_student_sees_details_with_current_status_and_history(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    receipt = _submit(client, storage, student, create_location(db, "Dining Commons"))

    response = client.get(f"/reports/{receipt['id']}", headers=auth_as(student))
    assert response.status_code == 200
    details = response.json()
    assert details["reference_code"] == receipt["reference_code"]
    assert details["status"] == "submitted"
    assert details["location"]["name"] == "Dining Commons"
    assert details["note"] == "Leak"
    assert details["media_id"] == receipt["media_id"]
    assert [(h["from_status"], h["to_status"]) for h in details["history"]] == [(None, "submitted")]
    # Staff identities are not exposed to the student.
    assert "actor_id" not in details["history"][0]


def test_details_show_the_latest_persisted_status(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    report_id = _submit(client, storage, student, create_location(db))["id"]
    # A later status change, as staff workflows (LS-20) will record it.
    db.execute("update public.reports set status = 'in_progress' where id = %s", (report_id,))
    db.execute(
        """
        insert into public.status_history (report_id, from_status, to_status, note)
        values (%s, 'submitted', 'in_progress', 'A technician is on the way.')
        """,
        (report_id,),
    )
    details = client.get(f"/reports/{report_id}", headers=auth_as(student)).json()
    assert details["status"] == "in_progress"
    assert [h["to_status"] for h in details["history"]] == ["submitted", "in_progress"]
    assert details["history"][-1]["note"] == "A technician is on the way."


def test_another_students_report_is_refused(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    owner, other = create_user(db), create_user(db)
    report_id = _submit(client, storage, owner, create_location(db))["id"]
    response = client.get(f"/reports/{report_id}", headers=auth_as(other))
    assert response.status_code == 404
    assert "reference_code" not in response.json()


def test_unknown_report_gets_the_same_answer_as_a_forbidden_one(client: TestClient, db: Db) -> None:
    response = client.get(f"/reports/{uuid4()}", headers=auth_as(create_user(db)))
    assert response.status_code == 404
    assert response.json() == {"detail": "Report not found"}


def test_details_require_sign_in_and_a_valid_id(client: TestClient, db: Db) -> None:
    assert client.get(f"/reports/{uuid4()}").status_code == 401
    assert client.get("/reports/not-a-uuid", headers=auth_as(create_user(db))).status_code == 422


@pytest.mark.parametrize("on_team", [True, False])
def test_staff_see_details_only_for_their_teams_reports(
    client: TestClient, db: Db, storage: FakeStorage, on_team: bool
) -> None:
    student, staff = create_user(db), create_user(db, "staff")
    team = create_team(db)
    if on_team:
        add_member(db, team, staff)
    report_id = _submit(client, storage, student, create_location(db))["id"]
    db.execute("update public.reports set assigned_team_id = %s where id = %s", (team, report_id))

    response = client.get(f"/reports/{report_id}", headers=auth_as(staff))
    assert response.status_code == (200 if on_team else 404)
    # Staff do not see it among their "own" reports.
    assert client.get("/reports/mine", headers=auth_as(staff)).json() == []


def test_administrator_can_read_any_report(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    report_id = _submit(client, storage, create_user(db), create_location(db))["id"]
    response = client.get(
        f"/reports/{report_id}", headers=auth_as(create_user(db, "administrator"))
    )
    assert response.status_code == 200
