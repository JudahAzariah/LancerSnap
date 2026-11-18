"""AI service integration (LS-11; SDD §5.3, RC-10, DD-08, RISK-05).

No test here calls a real AI service: the provider is the mock adapter or a
stubbed SDK client.
"""

import base64
import io
import json
import time
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import anthropic
import httpx2
import psycopg
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import db as app_db
from app.ai import ProviderNotConfigured, get_provider
from app.ai.claude import ClaudeProvider
from app.ai.images import MAX_EDGE_PIXELS, prepare_image
from app.ai.mock import MockProvider, always_fail, mock_output
from app.ai.provider import AIProviderError, AnalysisOutput, AnalysisRequest, CategoryOption
from app.analysis import AnalysisWorker, process_next
from app.config import Settings
from tests.conftest import (
    FakeStorage,
    RecordingQueue,
    add_member,
    auth_as,
    create_location,
    create_team,
    create_user,
)

Db = psycopg.Connection[Any]


def jpeg(width: int = 64, height: int = 48, *, with_gps: bool = False) -> bytes:
    image = Image.new("RGB", (width, height), (200, 30, 30))
    output = io.BytesIO()
    if with_gps:
        exif = Image.Exif()
        exif[0x010F] = "TestCamera"  # Make
        exif[0x8825] = {2: (34.0, 0.0, 0.0)}  # GPS latitude
        image.save(output, format="JPEG", exif=exif)
    else:
        image.save(output, format="JPEG")
    return output.getvalue()


def submit(client: TestClient, db: Db, storage: FakeStorage, *, note: str | None = None) -> dict:
    student = create_user(db)
    ticket = client.post(
        "/media/uploads",
        headers=auth_as(student),
        json={"content_type": "image/jpeg", "size_bytes": 1000},
    ).json()
    storage.put(ticket["object_path"], data=jpeg(with_gps=True))
    response = client.post(
        "/reports",
        headers=auth_as(student),
        json={
            "media_id": ticket["media_id"],
            "location_id": str(create_location(db, "Engineering Building")),
            "note": note,
        },
    )
    assert response.status_code == 201, response.text
    return response.json() | {"submitter_id": student}


def run_once(provider: Any, storage: FakeStorage, *, attempts: int = 3) -> tuple[Any, list]:
    sleeps: list[float] = []
    with app_db.connection() as conn:
        done = process_next(
            conn, provider=provider, storage=storage, max_attempts=attempts, sleep=sleeps.append
        )
    return done, sleeps


def analyses(db: Db, report_id: str) -> list[dict[str, Any]]:
    return db.execute(
        "select * from public.ai_analyses where report_id = %s order by created_at, id",
        (report_id,),
    ).fetchall()


# --- Provider selection and credentials -----------------------------------------


def test_analysis_is_off_unless_configured() -> None:
    assert get_provider(Settings(_env_file=None)) is None
    assert get_provider(Settings(_env_file=None, ai_provider="disabled")) is None


def test_mock_provider_needs_no_credentials() -> None:
    provider = get_provider(Settings(_env_file=None, ai_provider="mock"))
    assert isinstance(provider, MockProvider)


def test_anthropic_provider_requires_a_server_side_key() -> None:
    with pytest.raises(ProviderNotConfigured):
        get_provider(Settings(_env_file=None, ai_provider="anthropic"))
    provider = get_provider(
        Settings(_env_file=None, ai_provider="anthropic", anthropic_api_key="test-key")
    )
    assert isinstance(provider, ClaudeProvider)
    assert provider.name == "anthropic"


def test_unknown_provider_is_a_configuration_error() -> None:
    with pytest.raises(ProviderNotConfigured):
        get_provider(Settings(_env_file=None, ai_provider="something-else"))


# Output validation is covered in test_analysis_schema.py (LS-12).


# --- Image preparation ------------------------------------------------------------


def test_prepared_image_has_no_metadata_and_is_downscaled() -> None:
    original = jpeg(4000, 3000, with_gps=True)
    assert Image.open(io.BytesIO(original)).getexif()  # The test photo really has EXIF.

    prepared, media_type = prepare_image(original)
    assert media_type == "image/jpeg"
    image = Image.open(io.BytesIO(prepared))
    assert max(image.size) == MAX_EDGE_PIXELS
    assert not image.getexif()


def test_unreadable_photo_is_not_retried() -> None:
    with pytest.raises(AIProviderError) as raised:
        prepare_image(b"not an image")
    assert raised.value.code == "unsupported_image"
    assert not raised.value.retryable


# --- Claude adapter (SDK stubbed, no network) -------------------------------------


REQUEST = AnalysisRequest(
    image=b"\xff\xd8jpeg",
    image_media_type="image/jpeg",
    note="Water on floor",
    location_name="Gym",
    categories=(
        CategoryOption(id=UUID(int=1), name="Spills", description="Liquid on floors"),
        CategoryOption(id=UUID(int=2), name="Lighting", description=None),
    ),
)
_HTTP_REQUEST = httpx2.Request("POST", "https://api.anthropic.test/v1/messages")


def _status_error(cls: type[anthropic.APIStatusError], code: int) -> anthropic.APIStatusError:
    return cls("error", response=httpx2.Response(code, request=_HTTP_REQUEST), body=None)


class StubMessages:
    def __init__(self, outcome: Any) -> None:
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []

    def create(self, **params: Any) -> Any:
        self.calls.append(params)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def claude_with(
    outcome: Any, model: str = "claude-opus-5-5"
) -> tuple[ClaudeProvider, StubMessages]:
    provider = ClaudeProvider(api_key="test-key", model=model, timeout_seconds=5)
    messages = StubMessages(outcome)
    provider._client = SimpleNamespace(  # type: ignore[assignment]
        messages=messages, beta=SimpleNamespace(messages=messages)
    )
    return provider, messages


def message(text: str, stop_reason: str = "end_turn") -> Any:
    return SimpleNamespace(
        stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)]
    )


VALID_REPLY = json.dumps(
    {
        "category": "Spills",
        "summary": "Water pooled on the gym floor.",
        "details": ["Puddle near the entrance"],
        "priority": "medium",
        "potential_safety_hazard": True,
        "confidence": 0.8,
        "uncertain": False,
        "uncertainty_reason": None,
    }
)


def test_claude_success_sends_only_approved_content() -> None:
    provider, messages = claude_with(message(VALID_REPLY))
    assert provider.analyze(REQUEST).summary == "Water pooled on the gym floor."

    (params,) = messages.calls
    assert params["model"] == "claude-opus-5-5"
    output_format = params["output_config"]["format"]
    assert output_format["type"] == "json_schema"
    # The category is constrained to the offered, active categories.
    category_schema = output_format["schema"]["properties"]["category"]["anyOf"][0]
    assert category_schema["enum"] == ["Spills", "Lighting"]
    image, text = params["messages"][0]["content"]
    assert image["source"]["data"] == base64.standard_b64encode(REQUEST.image).decode()
    assert '"Gym"' in text["text"] and '"Water on floor"' in text["text"]
    assert '"Spills": Liquid on floors' in text["text"]


@pytest.mark.parametrize(
    ("error", "code", "retryable"),
    [
        (anthropic.APITimeoutError(request=_HTTP_REQUEST), "timeout", True),
        (anthropic.APIConnectionError(request=_HTTP_REQUEST), "unavailable", True),
        (_status_error(anthropic.RateLimitError, 429), "rate_limited", True),
        (_status_error(anthropic.InternalServerError, 500), "unavailable", True),
        (_status_error(anthropic.AuthenticationError, 401), "not_authorized", False),
        (_status_error(anthropic.BadRequestError, 400), "rejected", False),
    ],
)
def test_claude_errors_become_recorded_failure_reasons(
    error: Exception, code: str, retryable: bool
) -> None:
    provider, _ = claude_with(error)
    with pytest.raises(AIProviderError) as raised:
        provider.analyze(REQUEST)
    assert (raised.value.code, raised.value.retryable) == (code, retryable)


def test_claude_refusal_is_a_failure_not_a_result() -> None:
    provider, _ = claude_with(message("", stop_reason="refusal"))
    with pytest.raises(AIProviderError) as raised:
        provider.analyze(REQUEST)
    assert raised.value.code == "declined"


# --- Submission is independent of the AI service ----------------------------------


def test_submission_queues_analysis_and_notifies_after_commit(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    (row,) = analyses(db, receipt["id"])
    assert row["processing_status"] == "pending"
    # By the time the worker is woken, the report and its pending analysis are committed.
    assert queue.pending_seen_at_notify == [1]


def test_no_analysis_is_queued_when_ai_is_off(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    receipt = submit(client, db, storage)  # Default queue: analysis disabled.
    assert receipt["status"] == "submitted"
    assert analyses(db, receipt["id"]) == []


def test_submission_succeeds_while_the_ai_service_is_down(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    assert receipt["reference_code"].startswith("RPT-")

    down = MockProvider(always_fail("unavailable", retryable=True))
    run_once(down, storage)
    (row,) = analyses(db, receipt["id"])
    assert row["processing_status"] == "failed"
    assert row["error_message"] == "unavailable"
    assert row["summary"] is None
    report = db.execute("select status from public.reports where id = %s", (receipt["id"],))
    assert report.fetchone()["status"] == "submitted"


# --- Processing outcomes ------------------------------------------------------------


def test_successful_analysis_is_stored_as_advisory_data(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage, note="Leak by the stairs")
    provider = MockProvider()

    done, _ = run_once(provider, storage)
    assert done is not None
    (row,) = analyses(db, receipt["id"])
    assert row["processing_status"] == "succeeded"
    assert row["summary"] == "[Mock analysis] Reported issue at Engineering Building."
    assert (row["provider"], row["model"]) == ("mock", "mock")
    assert row["completed_at"] is not None

    # What the provider received: the cleaned photo, the note, the location. No identity.
    (sent,) = provider.requests
    assert sent.note == "Leak by the stairs"
    assert sent.location_name == "Engineering Building"
    assert not Image.open(io.BytesIO(sent.image)).getexif()

    report = db.execute(
        "select status, category_id, assigned_team_id from public.reports where id = %s",
        (receipt["id"],),
    ).fetchone()
    assert report == {"status": "submitted", "category_id": None, "assigned_team_id": None}
    assert run_once(provider, storage)[0] is None  # Nothing left to do.


def test_timeouts_are_retried_a_bounded_number_of_times(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    provider = MockProvider(always_fail("timeout", retryable=True))

    _, sleeps = run_once(provider, storage, attempts=3)
    assert len(provider.requests) == 3
    assert sleeps == [2.0, 4.0]
    (row,) = analyses(db, receipt["id"])
    assert (row["processing_status"], row["error_message"]) == ("failed", "timeout")


def test_a_temporary_failure_then_success_is_a_success(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    outcomes = iter([AIProviderError("timeout", retryable=True), None])

    def flaky(request: AnalysisRequest) -> AnalysisOutput:
        outcome = next(outcomes)
        if outcome is not None:
            raise outcome
        return mock_output(request, summary="Recovered.")

    run_once(MockProvider(flaky), storage)
    (row,) = analyses(db, receipt["id"])
    assert (row["processing_status"], row["summary"]) == ("succeeded", "Recovered.")


def test_permanent_errors_are_not_retried(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    provider = MockProvider(always_fail("not_authorized", retryable=False))

    _, sleeps = run_once(provider, storage)
    assert len(provider.requests) == 1 and sleeps == []
    assert analyses(db, receipt["id"])[0]["error_message"] == "not_authorized"


def test_photo_storage_outage_is_recorded_as_a_failure(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    storage.fail = True
    provider = MockProvider()

    run_once(provider, storage, attempts=2)
    assert provider.requests == []
    (row,) = analyses(db, receipt["id"])
    assert (row["processing_status"], row["error_message"]) == ("failed", "photo_unavailable")


def test_background_worker_processes_queued_reports(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    worker = AnalysisWorker(
        provider=MockProvider(), storage=storage, connect=app_db.connection, max_attempts=1
    )
    worker.start()
    try:
        worker.notify()
        deadline = time.monotonic() + 10
        while analyses(db, receipt["id"])[0]["processing_status"] == "pending":
            assert time.monotonic() < deadline, "worker did not process the analysis"
            time.sleep(0.05)
    finally:
        worker.stop()
    assert analyses(db, receipt["id"])[0]["processing_status"] == "succeeded"


# --- Staff access to the analysis ----------------------------------------------------


def test_only_staff_in_scope_and_admins_can_see_the_analysis(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    run_once(MockProvider(), storage)
    team, other_team = create_team(db), create_team(db)
    db.execute(
        "update public.reports set assigned_team_id = %s where id = %s", (team, receipt["id"])
    )
    staff, outsider, admin = (
        create_user(db, "staff"),
        create_user(db, "staff"),
        create_user(db, "administrator"),
    )
    add_member(db, team, staff)
    add_member(db, other_team, outsider)
    url = f"/reports/{receipt['id']}/analysis"

    assert client.get(url, headers=auth_as(receipt["submitter_id"])).status_code == 403
    assert client.get(url, headers=auth_as(outsider)).status_code == 404
    for viewer in (staff, admin):
        response = client.get(url, headers=auth_as(viewer))
        assert response.status_code == 200
        assert response.json()["processing_status"] == "succeeded"
        assert response.json()["error"] is None


def test_failed_analysis_can_be_sent_again(
    client: TestClient, db: Db, storage: FakeStorage, queue: RecordingQueue
) -> None:
    receipt = submit(client, db, storage)
    run_once(MockProvider(always_fail("timeout", retryable=False)), storage)
    admin = create_user(db, "administrator")
    url = f"/reports/{receipt['id']}/analysis"
    assert client.get(url, headers=auth_as(admin)).json()["processing_status"] == "failed"

    retry = client.post(url, headers=auth_as(admin))
    assert retry.status_code == 202
    assert retry.json()["processing_status"] == "pending"
    assert client.post(url, headers=auth_as(admin)).status_code == 409  # Already waiting.

    run_once(MockProvider(), storage)
    history = analyses(db, receipt["id"])
    assert [row["processing_status"] for row in history] == ["failed", "succeeded"]
    assert client.get(url, headers=auth_as(admin)).json()["processing_status"] == "succeeded"


def test_sending_for_analysis_when_ai_is_off_is_refused(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    receipt = submit(client, db, storage)
    admin = create_user(db, "administrator")
    url = f"/reports/{receipt['id']}/analysis"
    assert client.post(url, headers=auth_as(admin)).status_code == 503
    assert client.get(url, headers=auth_as(admin)).status_code == 404  # Never analyzed.


def test_analysis_of_an_unknown_report_is_not_found(client: TestClient, db: Db) -> None:
    admin = create_user(db, "administrator")
    url = f"/reports/{UUID(int=0)}/analysis"
    assert client.get(url, headers=auth_as(admin)).status_code == 404
