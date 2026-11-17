"""Report submission (LS-09; US-01, US-06, RC-10, RC-12, DD-08)."""

from typing import Any
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.storage import MAX_UPLOAD_BYTES, StorageError, SupabaseStorage
from tests.conftest import FakeStorage, auth_as, create_location, create_user

Db = psycopg.Connection[Any]


def _upload(client: TestClient, storage: FakeStorage, student: UUID, *, put: bool = True) -> str:
    """Start an upload as the student and, by default, complete it in storage."""
    ticket = client.post(
        "/media/uploads",
        headers=auth_as(student),
        json={"content_type": "image/jpeg", "size_bytes": 1000},
    ).json()
    if put:
        storage.put(ticket["object_path"], size_bytes=48_213)
    return str(ticket["media_id"])


def _submit(client: TestClient, student: UUID, **body: Any) -> httpx.Response:
    return client.post("/reports", headers=auth_as(student), json=body)


def _count(db: Db, table: str) -> int:
    row = db.execute(f"select count(*) as n from public.{table}").fetchone()
    assert row is not None
    return int(row["n"])


# --- The happy path -------------------------------------------------------------


def test_valid_submission_is_stored_and_returns_a_receipt(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    location = create_location(db, "Annie Gabriel Library")
    media_id = _upload(client, storage, student)

    response = _submit(
        client, student, media_id=media_id, location_id=str(location), note="  Leak by the stairs  "
    )
    assert response.status_code == 201
    receipt = response.json()
    assert receipt["reference_code"].startswith("RPT-")
    assert receipt["status"] == "submitted"
    assert receipt["location"]["name"] == "Annie Gabriel Library"
    assert receipt["note"] == "Leak by the stairs"
    assert receipt["media_id"] == media_id

    report = db.execute("select * from public.reports where id = %s", (receipt["id"],)).fetchone()
    assert report is not None
    assert report["submitter_id"] == student
    assert report["location_id"] == location
    assert report["status"] == "submitted"
    # Nothing the student could have chosen about who handles it.
    assert report["category_id"] is None
    assert report["assigned_team_id"] is None
    assert report["assigned_to"] is None


def test_submission_records_the_initial_status_history_entry(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    receipt = _submit(
        client,
        student,
        media_id=_upload(client, storage, student),
        location_id=str(create_location(db)),
    ).json()
    rows = db.execute(
        "select from_status, to_status::text, actor_id from public.status_history"
        " where report_id = %s",
        (receipt["id"],),
    ).fetchall()
    assert rows == [{"from_status": None, "to_status": "submitted", "actor_id": student}]


def test_submission_attaches_the_photo_with_the_size_storage_really_holds(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    media_id = _upload(client, storage, student)
    receipt = _submit(
        client, student, media_id=media_id, location_id=str(create_location(db))
    ).json()
    media = db.execute(
        "select report_id, size_bytes from public.report_media where id = %s", (media_id,)
    ).fetchone()
    assert media == {"report_id": UUID(receipt["id"]), "size_bytes": 48_213}


@pytest.mark.parametrize("note", [None, "", "   "])
def test_note_is_optional(
    client: TestClient, db: Db, storage: FakeStorage, note: str | None
) -> None:
    student = create_user(db)
    body: dict[str, Any] = {
        "media_id": _upload(client, storage, student),
        "location_id": str(create_location(db)),
    }
    if note is not None:
        body["note"] = note
    response = _submit(client, student, **body)
    assert response.status_code == 201
    assert response.json()["note"] is None


def test_each_report_gets_a_unique_reference_code(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    location = str(create_location(db))
    codes = {
        _submit(
            client, student, media_id=_upload(client, storage, student), location_id=location
        ).json()["reference_code"]
        for _ in range(5)
    }
    assert len(codes) == 5


def test_submission_works_with_no_ai_service_at_all(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    """DD-08: nothing about submission waits on or records AI analysis."""
    student = create_user(db)
    _submit(
        client,
        student,
        media_id=_upload(client, storage, student),
        location_id=str(create_location(db)),
    )
    assert _count(db, "reports") == 1
    assert _count(db, "ai_analyses") == 0


# --- Invalid input is rejected with a clear message, and nothing is stored ------


def test_missing_photo_or_location_is_rejected(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    location = str(create_location(db))
    media_id = _upload(client, storage, student)
    assert _submit(client, student, location_id=location).status_code == 422
    assert _submit(client, student, media_id=media_id).status_code == 422
    assert _count(db, "reports") == 0


def test_inactive_or_unknown_location_is_rejected(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    media_id = _upload(client, storage, student)
    inactive = create_location(db)
    db.execute("update public.locations set is_active = false where id = %s", (inactive,))
    for location in (inactive, uuid4()):
        response = _submit(client, student, media_id=media_id, location_id=str(location))
        assert response.status_code == 422
        assert response.json()["detail"] == "Choose a supported campus location."
    assert _count(db, "reports") == 0


def test_another_students_photo_cannot_be_used(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    owner, other = create_user(db), create_user(db)
    media_id = _upload(client, storage, owner)
    response = _submit(client, other, media_id=media_id, location_id=str(create_location(db)))
    assert response.status_code == 422
    assert "cannot be used" in response.json()["detail"]
    assert _count(db, "reports") == 0


def test_unknown_photo_gets_the_same_answer_as_someone_elses(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    response = _submit(client, student, media_id=str(uuid4()), location_id=str(create_location(db)))
    assert response.status_code == 422
    assert "cannot be used" in response.json()["detail"]


def test_a_photo_cannot_be_used_for_two_reports(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    location = str(create_location(db))
    media_id = _upload(client, storage, student)
    assert _submit(client, student, media_id=media_id, location_id=location).status_code == 201
    second = _submit(client, student, media_id=media_id, location_id=location)
    assert second.status_code == 422
    assert _count(db, "reports") == 1


def test_photo_that_never_reached_storage_is_rejected(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    media_id = _upload(client, storage, student, put=False)
    response = _submit(client, student, media_id=media_id, location_id=str(create_location(db)))
    assert response.status_code == 422
    assert "not finished uploading" in response.json()["detail"]
    assert _count(db, "reports") == 0


def test_photo_whose_stored_file_breaks_the_rules_is_rejected(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    location = str(create_location(db))
    for size, content_type in ((1000, "text/html"), (MAX_UPLOAD_BYTES + 1, "image/jpeg")):
        media_id = _upload(client, storage, student, put=False)
        path = db.execute(
            "select object_path from public.report_media where id = %s", (media_id,)
        ).fetchone()
        assert path is not None
        storage.put(path["object_path"], size_bytes=size, content_type=content_type)
        assert _submit(client, student, media_id=media_id, location_id=location).status_code == 422
    assert _count(db, "reports") == 0


def test_over_long_note_is_rejected(client: TestClient, db: Db, storage: FakeStorage) -> None:
    student = create_user(db)
    response = _submit(
        client,
        student,
        media_id=_upload(client, storage, student),
        location_id=str(create_location(db)),
        note="x" * 2001,
    )
    assert response.status_code == 422
    assert _count(db, "reports") == 0


# --- Failures are reported honestly ---------------------------------------------


def test_storage_outage_fails_the_submission_and_stores_nothing(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student = create_user(db)
    media_id = _upload(client, storage, student)
    storage.fail = True
    response = _submit(client, student, media_id=media_id, location_id=str(create_location(db)))
    assert response.status_code == 502
    assert "not submitted" in response.json()["detail"]
    assert "reference_code" not in response.json()
    assert _count(db, "reports") == 0
    assert _count(db, "status_history") == 0
    # The photo is still available for a retry.
    storage.fail = False
    retry = _submit(client, student, media_id=media_id, location_id=str(create_location(db)))
    assert retry.status_code == 201


# --- Who may submit -------------------------------------------------------------


def test_submission_requires_sign_in(client: TestClient, db: Db, storage: FakeStorage) -> None:
    response = client.post("/reports", json={"media_id": str(uuid4()), "location_id": str(uuid4())})
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["staff", "administrator"])
def test_only_students_submit_reports(
    client: TestClient, db: Db, storage: FakeStorage, role: str
) -> None:
    response = _submit(
        client,
        create_user(db, role),
        media_id=str(uuid4()),
        location_id=str(create_location(db)),
    )
    assert response.status_code == 403


def test_client_cannot_set_status_team_category_or_submitter(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    student, someone_else = create_user(db), create_user(db)
    receipt = _submit(
        client,
        student,
        media_id=_upload(client, storage, student),
        location_id=str(create_location(db)),
        status="resolved",
        assigned_team_id=str(uuid4()),
        category_id=str(uuid4()),
        submitter_id=str(someone_else),
    ).json()
    report = db.execute(
        "select status::text, assigned_team_id, category_id, submitter_id"
        " from public.reports where id = %s",
        (receipt["id"],),
    ).fetchone()
    assert report == {
        "status": "submitted",
        "assigned_team_id": None,
        "category_id": None,
        "submitter_id": student,
    }


# --- Storage client --------------------------------------------------------------


def test_storage_client_reads_object_info(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/storage/v1/object/info/report-media/u/p.jpg"
        return httpx.Response(200, json={"size": 70, "content_type": "IMAGE/PNG"})

    _patch_httpx_get(monkeypatch, handler)
    stored = SupabaseStorage(
        supabase_url="https://example.supabase.co", secret_key="test", bucket="report-media"
    ).get_object("u/p.jpg")
    assert stored is not None
    assert (stored.size_bytes, stored.content_type) == (70, "image/png")


def test_storage_client_treats_supabase_not_found_as_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = {"statusCode": "404", "error": "not_found", "code": "NoSuchKey"}
    _patch_httpx_get(monkeypatch, lambda request: httpx.Response(400, json=body))
    storage = SupabaseStorage(
        supabase_url="https://example.supabase.co", secret_key="test", bucket="report-media"
    )
    assert storage.get_object("u/missing.jpg") is None


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, json={"error": "internal"}),
        httpx.Response(400, json={"error": "invalid_jwt"}),
        httpx.Response(200, json={"unexpected": True}),
    ],
)
def test_storage_client_reports_other_failures_as_errors(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> None:
    _patch_httpx_get(monkeypatch, lambda request: response)
    storage = SupabaseStorage(
        supabase_url="https://example.supabase.co", secret_key="test", bucket="report-media"
    )
    with pytest.raises(StorageError):
        storage.get_object("u/p.jpg")


def _patch_httpx_get(monkeypatch: pytest.MonkeyPatch, handler: Any) -> None:
    transport = httpx.MockTransport(handler)

    def fake_get(url: str, **kwargs: Any) -> httpx.Response:
        kwargs.pop("timeout", None)
        with httpx.Client(transport=transport) as session:
            return session.get(url, **kwargs)

    monkeypatch.setattr("app.storage.httpx.get", fake_get)
