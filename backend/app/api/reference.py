"""Campus locations and report categories (LS-05; US-06, US-13).

Both lists are configuration data. Any signed-in user can read the ACTIVE
rows (the reporting flow needs them). Only administrators can see inactive
rows or change anything.

Rows are never deleted: a location or category that is no longer offered is
deactivated, so historical reports keep their original values.
"""

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, StringConstraints

from app.authz import AdminProfile, CurrentProfile
from app.db import Db

router = APIRouter(tags=["reference data"])
admin_router = APIRouter(prefix="/admin", tags=["administration"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
# Lower-case identifier such as "building" or "outdoor_area". New types can be
# introduced as data; there is no fixed list.
LocationType = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=40, pattern=r"^[a-z][a-z0-9_]*$"
    ),
]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


# --- Locations ----------------------------------------------------------------


class Location(BaseModel):
    id: UUID
    name: str
    location_type: str


class AdminLocation(Location):
    is_active: bool


class LocationCreate(BaseModel):
    name: Name
    location_type: LocationType


class LocationUpdate(BaseModel):
    name: Name | None = None
    location_type: LocationType | None = None
    is_active: bool | None = None


_LOCATION_COLUMNS = "id, name, location_type, is_active"


@router.get("/locations")
def list_active_locations(profile: CurrentProfile, db: Db) -> list[Location]:
    rows = db.execute(
        "select id, name, location_type from public.locations where is_active order by name"
    ).fetchall()
    return [Location(**row) for row in rows]


@admin_router.get("/locations")
def list_all_locations(admin: AdminProfile, db: Db) -> list[AdminLocation]:
    rows = db.execute(f"select {_LOCATION_COLUMNS} from public.locations order by name").fetchall()
    return [AdminLocation(**row) for row in rows]


@admin_router.post("/locations", status_code=status.HTTP_201_CREATED)
def create_location(body: LocationCreate, admin: AdminProfile, db: Db) -> AdminLocation:
    try:
        row = db.execute(
            f"""
            insert into public.locations (name, location_type) values (%s, %s)
            returning {_LOCATION_COLUMNS}
            """,
            (body.name, body.location_type),
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _name_conflict("location") from None
    assert row is not None
    return AdminLocation(**row)


@admin_router.patch("/locations/{location_id}")
def update_location(
    location_id: UUID, body: LocationUpdate, admin: AdminProfile, db: Db
) -> AdminLocation:
    changes = body.model_dump(exclude_none=True)
    try:
        row = db.execute(
            f"""
            update public.locations
            set name = coalesce(%(name)s, name),
                location_type = coalesce(%(location_type)s, location_type),
                is_active = coalesce(%(is_active)s, is_active)
            where id = %(id)s
            returning {_LOCATION_COLUMNS}
            """,
            {
                "id": location_id,
                "name": changes.get("name"),
                "location_type": changes.get("location_type"),
                "is_active": changes.get("is_active"),
            },
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _name_conflict("location") from None
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
    return AdminLocation(**row)


# --- Categories ---------------------------------------------------------------


class Category(BaseModel):
    id: UUID
    name: str
    description: str | None


class AdminCategory(Category):
    is_active: bool


class CategoryCreate(BaseModel):
    name: Name
    description: Description | None = None


class CategoryUpdate(BaseModel):
    name: Name | None = None
    description: Description | None = None
    is_active: bool | None = None


_CATEGORY_COLUMNS = "id, name, description, is_active"


@router.get("/categories")
def list_active_categories(profile: CurrentProfile, db: Db) -> list[Category]:
    rows = db.execute(
        "select id, name, description from public.categories where is_active order by name"
    ).fetchall()
    return [Category(**row) for row in rows]


@admin_router.get("/categories")
def list_all_categories(admin: AdminProfile, db: Db) -> list[AdminCategory]:
    rows = db.execute(f"select {_CATEGORY_COLUMNS} from public.categories order by name").fetchall()
    return [AdminCategory(**row) for row in rows]


@admin_router.post("/categories", status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, admin: AdminProfile, db: Db) -> AdminCategory:
    try:
        row = db.execute(
            f"""
            insert into public.categories (name, description) values (%s, %s)
            returning {_CATEGORY_COLUMNS}
            """,
            (body.name, body.description or None),
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _name_conflict("category") from None
    assert row is not None
    return AdminCategory(**row)


@admin_router.patch("/categories/{category_id}")
def update_category(
    category_id: UUID, body: CategoryUpdate, admin: AdminProfile, db: Db
) -> AdminCategory:
    changes = body.model_dump(exclude_none=True)
    try:
        row = db.execute(
            f"""
            update public.categories
            set name = coalesce(%(name)s, name),
                description = coalesce(%(description)s, description),
                is_active = coalesce(%(is_active)s, is_active)
            where id = %(id)s
            returning {_CATEGORY_COLUMNS}
            """,
            {
                "id": category_id,
                "name": changes.get("name"),
                "description": changes.get("description"),
                "is_active": changes.get("is_active"),
            },
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise _name_conflict("category") from None
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return AdminCategory(**row)


def _name_conflict(kind: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail=f"A {kind} with that name already exists"
    )
