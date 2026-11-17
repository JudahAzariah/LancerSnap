"""Protected report image storage (LS-08; RC-01, RC-09, RC-10)."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.storage import MAX_UPLOAD_BYTES, SupabaseStorage, get_storage
from tests.conftest import (
    FakeStorage,
    add_member,
    auth_as,
    create_report,
    create_team,
    create_user,
)

Db = psycopg.Connection[Any]

JPEG = {"content_type": "image/jpeg", "size_bytes": 250_000}


def _start_upload(client: TestClient, user: UUID, body: dict[str, Any] | None = None) -> Any:
    return client.post("/media/uploads", headers=auth_as(user), json=body or JPEG)


def _attach(db: Db, media_id: str, report_id: UUID) -> None:
    db.execute("update public.report_media set report_id = %s where id = %s", (report_id, media_id))


def _media_count(db: Db) -> int:
    row = db.execute("select count(*) as n from public.report_media").fetchone()
    assert row is not None
    return int(row["n"])


# --- Uploading ----------------------------------------------------------------


def test_student_gets_an_upload_ticket_and_the_upload_is_recorded(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    response = _start_upload(client, student)
    assert response.status_code == 201
    ticket = response.json()
    assert ticket["bucket"] == "report-media"
    assert ticket["max_bytes"] == MAX_UPLOAD_BYTES
    assert ticket["upload_token"] == "test-token"
    # The backend chooses the path: the uploader's folder and a random name.
    folder, filename = ticket["object_path"].split("/")
    assert folder == str(student)
    assert filename.endswith(".jpg")
    assert storage.upload_paths == [ticket["object_path"]]

    row = db.execute(
        "select * from public.report_media where id = %s", (ticket["media_id"],)
    ).fetchone()
    assert row is not None
    assert row["uploader_id"] == student
    assert row["report_id"] is None
    assert row["content_type"] == "image/jpeg"
    assert row["size_bytes"] == 250_000


def test_each_upload_gets_a_different_path(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    first = _start_upload(client, student).json()["object_path"]
    second = _start_upload(client, student).json()["object_path"]
    assert first != second


def test_client_cannot_choose_the_storage_path(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    victim = uuid4()
    body = {**JPEG, "object_path": f"{victim}/overwrite.jpg", "bucket": "other"}
    ticket = _start_upload(client, student, body).json()
    assert ticket["object_path"].startswith(f"{student}/")
    assert ticket["bucket"] == "report-media"


@pytest.mark.parametrize(
    "content_type",
    ["application/pdf", "image/svg+xml", "text/html", "video/mp4", "image/gif", ""],
)
def test_unsupported_file_types_are_rejected(
    client: TestClient, db: Db, storage: FakeStorage, content_type: str
) -> None:
    response = _start_upload(
        client, create_user(db), {"content_type": content_type, "size_bytes": 1000}
    )
    assert response.status_code == 415
    assert storage.upload_paths == []
    assert _media_count(db) == 0


@pytest.mark.parametrize("content_type", ["image/png", "image/webp", "image/heic", "IMAGE/JPEG"])
def test_supported_photo_types_are_accepted(
    client: TestClient, db: Db, storage: FakeStorage, content_type: str
) -> None:
    response = _start_upload(
        client, create_user(db), {"content_type": content_type, "size_bytes": 1000}
    )
    assert response.status_code == 201


def test_oversized_and_empty_files_are_rejected(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    too_big = {"content_type": "image/jpeg", "size_bytes": MAX_UPLOAD_BYTES + 1}
    assert _start_upload(client, student, too_big).status_code == 413
    at_limit = {"content_type": "image/jpeg", "size_bytes": MAX_UPLOAD_BYTES}
    assert _start_upload(client, student, at_limit).status_code == 201
    for size in (0, -5):
        empty = {"content_type": "image/jpeg", "size_bytes": size}
        assert _start_upload(client, student, empty).status_code == 422
    assert _media_count(db) == 1


def test_upload_requires_sign_in(client: TestClient, db: Db, storage: FakeStorage) -> None:
    assert client.post("/media/uploads", json=JPEG).status_code == 401


@pytest.mark.parametrize("role", ["staff", "administrator"])
def test_only_students_start_uploads(
    client: TestClient, db: Db, storage: FakeStorage, role: str
) -> None:
    assert _start_upload(client, create_user(db, role)).status_code == 403
    assert _media_count(db) == 0


def test_storage_failure_on_upload_is_reported_and_records_nothing(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    storage.fail = True
    response = _start_upload(client, create_user(db))
    assert response.status_code == 502
    assert "upload_url" not in response.json()
    assert _media_count(db) == 0


# --- Viewing ------------------------------------------------------------------


def _url(client: TestClient, media_id: str, user: UUID) -> Any:
    return client.get(f"/media/{media_id}/url", headers=auth_as(user))


def test_uploader_can_view_their_unattached_upload_but_nobody_else_can(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    ticket = _start_upload(client, student).json()

    response = _url(client, ticket["media_id"], student)
    assert response.status_code == 200
    assert response.json() == {
        "url": f"https://storage.test/download/{ticket['object_path']}?token=signed",
        "expires_in": 300,
    }
    assert storage.download_requests == [(ticket["object_path"], 300)]

    for other in (create_user(db), create_user(db, "staff")):
        assert _url(client, ticket["media_id"], other).status_code == 404


def test_student_cannot_view_another_students_report_photo(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    owner = create_user(db)
    ticket = _start_upload(client, owner).json()
    _attach(db, ticket["media_id"], create_report(db, owner))

    assert _url(client, ticket["media_id"], owner).status_code == 200
    assert _url(client, ticket["media_id"], create_user(db)).status_code == 404
    # Only the owner's request reached storage.
    assert len(storage.download_requests) == 1


def test_staff_can_view_photos_only_for_reports_in_their_team_scope(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    owner = create_user(db)
    team_a, team_b = create_team(db), create_team(db)
    staff_a, staff_b, staff_none = (create_user(db, "staff") for _ in range(3))
    add_member(db, team_a, staff_a)
    add_member(db, team_b, staff_b)

    ticket = _start_upload(client, owner).json()
    _attach(db, ticket["media_id"], create_report(db, owner, team_id=team_a))

    assert _url(client, ticket["media_id"], staff_a).status_code == 200
    assert _url(client, ticket["media_id"], staff_b).status_code == 404
    assert _url(client, ticket["media_id"], staff_none).status_code == 404


def test_staff_cannot_view_photos_of_reports_not_assigned_to_any_team(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    owner = create_user(db)
    staff = create_user(db, "staff")
    add_member(db, create_team(db), staff)
    ticket = _start_upload(client, owner).json()
    _attach(db, ticket["media_id"], create_report(db, owner))
    assert _url(client, ticket["media_id"], staff).status_code == 404


def test_administrator_can_view_any_report_photo(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    owner = create_user(db)
    ticket = _start_upload(client, owner).json()
    _attach(db, ticket["media_id"], create_report(db, owner))
    assert _url(client, ticket["media_id"], create_user(db, "administrator")).status_code == 200


def test_viewing_requires_sign_in_and_unknown_ids_are_not_found(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    assert client.get(f"/media/{uuid4()}/url").status_code == 401
    assert _url(client, str(uuid4()), create_user(db)).status_code == 404
    assert _url(client, "not-a-uuid", create_user(db)).status_code == 422


def test_storage_failure_on_view_is_reported_not_faked(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    ticket = _start_upload(client, student).json()
    storage.fail = True
    response = _url(client, ticket["media_id"], student)
    assert response.status_code == 502
    assert "url" not in response.json()


# --- Configuration --------------------------------------------------------------


def test_unconfigured_storage_reports_unavailable(client: TestClient, db: Db) -> None:
    from app.config import get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, supabase_url="https://example.supabase.co", supabase_secret_key=""
    )
    assert _start_upload(client, create_user(db)).status_code == 503
    assert _media_count(db) == 0


def test_storage_client_is_built_from_server_side_settings() -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co/",
        supabase_secret_key="test-secret",
    )
    storage = get_storage(settings)
    assert isinstance(storage, SupabaseStorage)
    assert storage._base == "https://example.supabase.co/storage/v1"
    assert storage._object("user id/photo 1.jpg") == "report-media/user%20id/photo%201.jpg"
