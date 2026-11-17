"""Campus locations and report categories (LS-05)."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.reference import require_active_location
from tests.conftest import auth_as, create_user

Db = psycopg.Connection[Any]


def _location(db: Db, name: str, location_type: str = "building", active: bool = True) -> str:
    row = db.execute(
        """
        insert into public.locations (name, location_type, is_active) values (%s, %s, %s)
        returning id
        """,
        (name, location_type, active),
    ).fetchone()
    assert row is not None
    return str(row["id"])


def _category(db: Db, name: str, active: bool = True) -> str:
    row = db.execute(
        "insert into public.categories (name, is_active) values (%s, %s) returning id",
        (name, active),
    ).fetchone()
    assert row is not None
    return str(row["id"])


# --- Reading ------------------------------------------------------------------


@pytest.mark.parametrize("role", ["student", "staff", "administrator"])
def test_any_signed_in_role_lists_active_locations_sorted(
    client: TestClient, db: Db, role: str
) -> None:
    _location(db, "Library")
    _location(db, "Quad", "outdoor_area")
    _location(db, "Closed Hall", active=False)
    response = client.get("/locations", headers=auth_as(create_user(db, role)))
    assert response.status_code == 200
    assert [(item["name"], item["location_type"]) for item in response.json()] == [
        ("Library", "building"),
        ("Quad", "outdoor_area"),
    ]
    assert "is_active" not in response.json()[0]


def test_any_signed_in_user_lists_active_categories(client: TestClient, db: Db) -> None:
    _category(db, "Facilities")
    _category(db, "Retired", active=False)
    response = client.get("/categories", headers=auth_as(create_user(db)))
    assert [item["name"] for item in response.json()] == ["Facilities"]


@pytest.mark.parametrize("path", ["/locations", "/categories"])
def test_reference_data_requires_sign_in(client: TestClient, db: Db, path: str) -> None:
    assert client.get(path).status_code == 401


def test_admin_lists_inactive_rows_too(client: TestClient, db: Db) -> None:
    _location(db, "Closed Hall", active=False)
    _category(db, "Retired", active=False)
    headers = auth_as(create_user(db, "administrator"))
    assert client.get("/admin/locations", headers=headers).json()[0]["is_active"] is False
    assert client.get("/admin/categories", headers=headers).json()[0]["is_active"] is False


# --- Administrator-only changes -----------------------------------------------

ADMIN_REQUESTS = [
    ("GET", "/admin/locations", None),
    ("POST", "/admin/locations", {"name": "X", "location_type": "building"}),
    ("PATCH", f"/admin/locations/{uuid4()}", {"is_active": False}),
    ("GET", "/admin/categories", None),
    ("POST", "/admin/categories", {"name": "X"}),
    ("PATCH", f"/admin/categories/{uuid4()}", {"is_active": False}),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_REQUESTS)
@pytest.mark.parametrize("role", ["student", "staff"])
def test_non_administrators_cannot_manage_reference_data(
    client: TestClient, db: Db, role: str, method: str, path: str, body: dict[str, Any] | None
) -> None:
    response = client.request(method, path, headers=auth_as(create_user(db, role)), json=body)
    assert response.status_code == 403
    counts = db.execute(
        "select (select count(*) from public.locations) + (select count(*) from public.categories)"
        " as n"
    ).fetchone()
    assert counts is not None and counts["n"] == 0


def test_admin_creates_updates_and_deactivates_a_category(client: TestClient, db: Db) -> None:
    admin = auth_as(create_user(db, "administrator"))
    student = auth_as(create_user(db))

    created = client.post(
        "/admin/categories", headers=admin, json={"name": "  Grounds  ", "description": "Outdoor"}
    )
    assert created.status_code == 201
    category = created.json()
    assert category["name"] == "Grounds"
    assert category["is_active"] is True
    assert [c["name"] for c in client.get("/categories", headers=student).json()] == ["Grounds"]

    renamed = client.patch(
        f"/admin/categories/{category['id']}", headers=admin, json={"name": "Grounds / landscaping"}
    )
    assert renamed.json()["name"] == "Grounds / landscaping"
    assert renamed.json()["description"] == "Outdoor"

    deactivated = client.patch(
        f"/admin/categories/{category['id']}", headers=admin, json={"is_active": False}
    )
    assert deactivated.json()["is_active"] is False
    # Gone from the list used for new reports, but still stored.
    assert client.get("/categories", headers=student).json() == []
    assert len(client.get("/admin/categories", headers=admin).json()) == 1


def test_admin_adds_a_location_with_a_new_type(client: TestClient, db: Db) -> None:
    admin = auth_as(create_user(db, "administrator"))
    created = client.post(
        "/admin/locations", headers=admin, json={"name": "North Field", "location_type": "field"}
    )
    assert created.status_code == 201
    location = created.json()
    assert location["location_type"] == "field"

    updated = client.patch(
        f"/admin/locations/{location['id']}",
        headers=admin,
        json={"location_type": "athletic_field", "is_active": False},
    )
    assert updated.json() == {
        "id": location["id"],
        "name": "North Field",
        "location_type": "athletic_field",
        "is_active": False,
    }
    assert client.get("/locations", headers=admin).json() == []


def test_duplicate_names_are_rejected(client: TestClient, db: Db) -> None:
    admin = auth_as(create_user(db, "administrator"))
    _location(db, "Library")
    other = _location(db, "Gym")
    _category(db, "Facilities")
    body = {"name": "Library", "location_type": "building"}
    assert client.post("/admin/locations", headers=admin, json=body).status_code == 409
    assert (
        client.patch(f"/admin/locations/{other}", headers=admin, json={"name": "Library"})
    ).status_code == 409
    assert (
        client.post("/admin/categories", headers=admin, json={"name": "Facilities"})
    ).status_code == 409


def test_invalid_input_is_rejected(client: TestClient, db: Db) -> None:
    admin = auth_as(create_user(db, "administrator"))
    for body in (
        {"name": "", "location_type": "building"},
        {"name": "   ", "location_type": "building"},
        {"name": "Hall", "location_type": "Has Spaces"},
        {"name": "Hall"},
    ):
        assert client.post("/admin/locations", headers=admin, json=body).status_code == 422
    assert client.post("/admin/categories", headers=admin, json={"name": ""}).status_code == 422


def test_unknown_ids_return_not_found(client: TestClient, db: Db) -> None:
    admin = auth_as(create_user(db, "administrator"))
    body = {"is_active": False}
    assert client.patch(f"/admin/locations/{uuid4()}", headers=admin, json=body).status_code == 404
    assert client.patch(f"/admin/categories/{uuid4()}", headers=admin, json=body).status_code == 404


# --- Location validation for submissions (LS-07, US-06) ---------------------------


def test_active_location_is_accepted(db: Db) -> None:
    location_id = _location(db, "Library", "building")
    location = require_active_location(db, UUID(location_id))
    assert (str(location.id), location.name, location.location_type) == (
        location_id,
        "Library",
        "building",
    )


def test_inactive_or_unknown_location_is_rejected_with_a_clear_message(db: Db) -> None:
    inactive = _location(db, "Closed Hall", active=False)
    for location_id in (UUID(inactive), uuid4()):
        with pytest.raises(HTTPException) as error:
            require_active_location(db, location_id)
        assert error.value.status_code == 422
        assert error.value.detail == "Choose a supported campus location."
