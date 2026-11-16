"""Role-based access control tests (LS-04, RC-01)."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.authz import Profile, Role, can_manage_report, can_view_report
from tests.conftest import add_member, auth_as, create_team, create_user

Db = psycopg.Connection[Any]


# --- Who am I ---------------------------------------------------------------


def test_me_reports_student_role_by_default(client: TestClient, db: Db) -> None:
    student = create_user(db)
    body = client.get("/me", headers=auth_as(student)).json()
    assert body["role"] == "student"
    assert body["team_ids"] == []


def test_me_reports_staff_team_scope(client: TestClient, db: Db) -> None:
    staff = create_user(db, "staff")
    team = create_team(db)
    add_member(db, team, staff)
    body = client.get("/me", headers=auth_as(staff)).json()
    assert body["role"] == "staff"
    assert body["team_ids"] == [str(team)]


def test_stale_membership_gives_a_non_staff_user_no_team_scope(client: TestClient, db: Db) -> None:
    student = create_user(db)
    add_member(db, create_team(db), student)
    assert client.get("/me", headers=auth_as(student)).json()["team_ids"] == []


def test_authenticated_user_without_a_profile_is_forbidden(client: TestClient, db: Db) -> None:
    response = client.get("/me", headers=auth_as(uuid4()))
    assert response.status_code == 403


def test_role_change_takes_effect_on_the_next_request(client: TestClient, db: Db) -> None:
    user = create_user(db, "administrator")
    headers = auth_as(user)
    assert client.get("/admin/users", headers=headers).status_code == 200
    db.execute("update public.profiles set role = 'student' where id = %s", (user,))
    assert client.get("/admin/users", headers=headers).status_code == 403


# --- Administrator-only endpoints -------------------------------------------

ADMIN_REQUESTS = [
    ("GET", "/admin/users", None),
    ("PATCH", f"/admin/users/{uuid4()}", {"role": "administrator"}),
    ("PUT", f"/admin/users/{uuid4()}/teams/{uuid4()}", None),
    ("DELETE", f"/admin/users/{uuid4()}/teams/{uuid4()}", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_REQUESTS)
@pytest.mark.parametrize("role", ["student", "staff"])
def test_non_administrators_cannot_use_admin_endpoints(
    client: TestClient, db: Db, role: str, method: str, path: str, body: dict[str, str] | None
) -> None:
    caller = create_user(db, role)
    response = client.request(method, path, headers=auth_as(caller), json=body)
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_REQUESTS)
def test_admin_endpoints_require_authentication(
    client: TestClient, db: Db, method: str, path: str, body: dict[str, str] | None
) -> None:
    assert client.request(method, path, json=body).status_code == 401


def test_student_cannot_promote_themselves(client: TestClient, db: Db) -> None:
    student = create_user(db)
    response = client.patch(
        f"/admin/users/{student}", headers=auth_as(student), json={"role": "administrator"}
    )
    assert response.status_code == 403
    row = db.execute("select role::text from public.profiles where id = %s", (student,)).fetchone()
    assert row is not None and row["role"] == "student"


def test_admin_lists_users_with_roles_and_teams(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    staff = create_user(db, "staff")
    team = create_team(db)
    add_member(db, team, staff)
    response = client.get("/admin/users", headers=auth_as(admin))
    assert response.status_code == 200
    by_id = {user["id"]: user for user in response.json()}
    assert by_id[str(admin)]["role"] == "administrator"
    assert by_id[str(staff)] == {
        "id": str(staff),
        "email": f"{staff}@example.edu",
        "role": "staff",
        "team_ids": [str(team)],
    }


def test_admin_assigns_role_and_team_membership(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    user = create_user(db)
    team = create_team(db)
    headers = auth_as(admin)

    promoted = client.patch(f"/admin/users/{user}", headers=headers, json={"role": "staff"})
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "staff"

    joined = client.put(f"/admin/users/{user}/teams/{team}", headers=headers)
    assert joined.status_code == 200
    assert joined.json()["team_ids"] == [str(team)]
    # Adding the same membership again is harmless.
    assert client.put(f"/admin/users/{user}/teams/{team}", headers=headers).status_code == 200

    assert client.get("/me", headers=auth_as(user)).json()["team_ids"] == [str(team)]

    removed = client.delete(f"/admin/users/{user}/teams/{team}", headers=headers)
    assert removed.status_code == 204
    assert client.get("/me", headers=auth_as(user)).json()["team_ids"] == []


def test_only_staff_can_be_added_to_a_team(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    student = create_user(db)
    team = create_team(db)
    response = client.put(f"/admin/users/{student}/teams/{team}", headers=auth_as(admin))
    assert response.status_code == 409


def test_demoting_staff_removes_their_team_scope(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    staff = create_user(db, "staff")
    add_member(db, create_team(db), staff)
    response = client.patch(
        f"/admin/users/{staff}", headers=auth_as(admin), json={"role": "student"}
    )
    assert response.json() == {
        "id": str(staff),
        "email": f"{staff}@example.edu",
        "role": "student",
        "team_ids": [],
    }
    remaining = db.execute(
        "select count(*) as n from public.team_members where user_id = %s", (staff,)
    ).fetchone()
    assert remaining is not None and remaining["n"] == 0


def test_admin_cannot_change_their_own_role(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    response = client.patch(
        f"/admin/users/{admin}", headers=auth_as(admin), json={"role": "student"}
    )
    assert response.status_code == 409
    assert client.get("/admin/users", headers=auth_as(admin)).status_code == 200


def test_unknown_user_team_or_role_is_rejected(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    staff = create_user(db, "staff")
    headers = auth_as(admin)
    missing = uuid4()
    assert (
        client.patch(f"/admin/users/{missing}", headers=headers, json={"role": "staff"}).status_code
        == 404
    )
    assert client.put(f"/admin/users/{staff}/teams/{missing}", headers=headers).status_code == 404
    assert (
        client.patch(f"/admin/users/{staff}", headers=headers, json={"role": "owner"}).status_code
        == 422
    )


# --- Record-level rules -------------------------------------------------------

TEAM_A = UUID("aaaaaaaa-0000-0000-0000-000000000000")
TEAM_B = UUID("bbbbbbbb-0000-0000-0000-000000000000")


def _profile(role: Role, teams: tuple[UUID, ...] = ()) -> Profile:
    return Profile(id=uuid4(), email=None, role=role, team_ids=frozenset(teams))


def test_student_can_view_only_their_own_report() -> None:
    student = _profile(Role.STUDENT)
    assert can_view_report(student, submitter_id=student.id, assigned_team_id=TEAM_A)
    assert not can_view_report(student, submitter_id=uuid4(), assigned_team_id=TEAM_A)
    assert not can_manage_report(student, assigned_team_id=TEAM_A)


def test_staff_scope_is_limited_to_their_teams() -> None:
    staff = _profile(Role.STAFF, (TEAM_A,))
    other = uuid4()
    assert can_view_report(staff, submitter_id=other, assigned_team_id=TEAM_A)
    assert can_manage_report(staff, assigned_team_id=TEAM_A)
    assert not can_view_report(staff, submitter_id=other, assigned_team_id=TEAM_B)
    assert not can_manage_report(staff, assigned_team_id=TEAM_B)
    # A report not yet routed to any team is outside every staff queue.
    assert not can_view_report(staff, submitter_id=other, assigned_team_id=None)


def test_administrator_can_view_and_manage_any_report() -> None:
    admin = _profile(Role.ADMINISTRATOR)
    assert can_view_report(admin, submitter_id=uuid4(), assigned_team_id=None)
    assert can_manage_report(admin, assigned_team_id=TEAM_B)
