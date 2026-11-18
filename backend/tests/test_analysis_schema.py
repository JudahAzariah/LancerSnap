"""Structured AI classification schema (LS-12; US-02, RC-02, SDD §5.5, §5.7).

Valid results are stored as advisory analysis; anything malformed, incomplete,
or naming an unsupported category is recorded as a failure and never reaches
downstream logic. No real AI service is called.
"""

import json
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.ai.mock import MockProvider, mock_output
from app.ai.provider import (
    AIProviderError,
    AnalysisOutput,
    AnalysisRequest,
    output_json_schema,
    parse_output,
)
from app.analysis import latest_validated_analysis
from tests.conftest import FakeStorage, create_user
from tests.test_analysis import analyses, run_once, submit

Db = psycopg.Connection[Any]

VALID: dict[str, Any] = {
    "category": "Spills",
    "summary": "Water is pooled on the hallway floor.",
    "details": ["Large puddle", "Near the stairwell"],
    "priority": "medium",
    "potential_safety_hazard": True,
    "confidence": 0.82,
    "uncertain": False,
    "uncertainty_reason": None,
}


def payload(**changes: Any) -> str:
    data = VALID | changes
    return json.dumps({key: value for key, value in data.items() if value is not ...})


def rejected(raw: str) -> AIProviderError:
    with pytest.raises(AIProviderError) as raised:
        parse_output(raw)
    return raised.value


def add_category(db: Db, name: str, *, active: bool = True) -> UUID:
    row = db.execute(
        "insert into public.categories (name, description, is_active) values (%s, %s, %s)"
        " returning id",
        (name, f"{name} issues", active),
    ).fetchone()
    assert row is not None
    return UUID(str(row["id"]))


# --- Parsing and validation -------------------------------------------------------


def test_a_valid_payload_is_parsed() -> None:
    output = parse_output(payload())
    assert output.category == "Spills"
    assert output.details == ["Large puddle", "Near the stairwell"]
    assert output.priority == "medium" and output.potential_safety_hazard is True
    assert output.confidence == 0.82 and output.uncertain is False


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[]",
        payload(summary=...),  # missing field
        payload(priority=...),
        payload(confidence=...),
        payload(uncertain=...),
        payload(extra="field"),  # unexpected field
        payload(summary="   "),
        payload(priority="urgent"),
        payload(confidence=1.5),
        payload(confidence=-0.1),
        payload(details=["x"] * 6),
        payload(details=["x" * 201]),
        payload(summary="x" * 501),
        payload(potential_safety_hazard="yes"),
    ],
)
def test_malformed_or_incomplete_payloads_are_rejected(raw: str) -> None:
    error = rejected(raw)
    assert (error.code, error.retryable) == ("invalid_response", False)


def test_no_category_must_be_flagged_as_uncertain() -> None:
    rejected(payload(category=None))
    output = parse_output(
        payload(category=None, uncertain=True, uncertainty_reason="None of the categories fit.")
    )
    assert output.category is None and output.uncertain


def test_uncertainty_needs_a_reason_and_the_reason_is_preserved() -> None:
    rejected(payload(uncertain=True, uncertainty_reason=None))
    rejected(payload(uncertain=True, uncertainty_reason="  "))
    output = parse_output(
        payload(uncertain=True, uncertainty_reason="Photo is blurry.", confidence=0.3)
    )
    assert output.uncertainty_reason == "Photo is blurry." and output.confidence == 0.3


def test_a_reason_without_uncertainty_is_dropped() -> None:
    assert parse_output(payload(uncertainty_reason="unused")).uncertainty_reason is None


def test_schema_constrains_the_category_to_the_offered_names() -> None:
    schema = output_json_schema(["Spills", "Lighting"])
    assert schema["properties"]["category"]["anyOf"][0]["enum"] == ["Spills", "Lighting"]
    assert set(schema["required"]) == set(AnalysisOutput.model_fields)
    assert schema["additionalProperties"] is False
    # With no categories configured, the only allowed value is null (uncertain).
    assert output_json_schema([])["properties"]["category"] == {"type": "null"}


# --- Pipeline: validation before storage ---------------------------------------------


def test_valid_result_is_stored_as_advisory_analysis(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    spills = add_category(db, "Spills")
    add_category(db, "Lighting")
    add_category(db, "Retired", active=False)
    receipt = submit(client, db, storage)

    def classify(request: AnalysisRequest) -> AnalysisOutput:
        # Only active categories are offered.
        assert [c.name for c in request.categories] == ["Lighting", "Spills"]
        return parse_output(payload())

    run_once(MockProvider(classify), storage)
    (row,) = analyses(db, receipt["id"])
    assert row["processing_status"] == "succeeded"
    assert row["suggested_category_id"] == spills
    assert row["summary"] == VALID["summary"]
    assert row["details"] == VALID["details"]
    # The payload is a safety hazard, so LS-14 stores it as high priority.
    assert row["suggested_priority"] == "high"
    assert row["is_potential_safety_hazard"] is True
    assert float(row["confidence"]) == 0.82
    assert row["is_uncertain"] is False and row["uncertainty_reason"] is None

    # Advisory only: the report's own category and team are untouched.
    report = db.execute(
        "select category_id, assigned_team_id, status from public.reports where id = %s",
        (receipt["id"],),
    ).fetchone()
    assert report == {"category_id": None, "assigned_team_id": None, "status": "submitted"}


def test_unsupported_category_is_not_stored_as_a_valid_result(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    add_category(db, "Spills")
    add_category(db, "Retired", active=False)
    receipt = submit(client, db, storage)

    for name in ("Plumbing", "Retired"):  # Unknown, and known but inactive.
        db.execute("update public.ai_analyses set processing_status = 'pending'")
        run_once(
            MockProvider(lambda request, name=name: mock_output(request, category=name)), storage
        )
        row = analyses(db, receipt["id"])[0]
        assert (row["processing_status"], row["error_message"]) == (
            "failed",
            "unsupported_category",
        )
        assert row["suggested_category_id"] is None and row["summary"] is None


def test_uncertain_result_is_stored_with_its_uncertainty(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    add_category(db, "Spills")
    receipt = submit(client, db, storage)
    run_once(
        MockProvider(
            lambda request: parse_output(
                payload(
                    category=None,
                    uncertain=True,
                    uncertainty_reason="No category fits.",
                    confidence=0.2,
                )
            )
        ),
        storage,
    )
    (row,) = analyses(db, receipt["id"])
    assert row["processing_status"] == "succeeded"
    assert row["suggested_category_id"] is None
    assert row["is_uncertain"] is True
    assert row["uncertainty_reason"] == "No category fits."
    assert float(row["confidence"]) == 0.2


# --- Downstream consumers see only validated output ---------------------------------


def test_downstream_reads_only_validated_results(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    spills = add_category(db, "Spills")
    receipt = submit(client, db, storage)
    report_id = UUID(receipt["id"])

    def latest() -> Any:
        with app_db.connection() as conn:
            return latest_validated_analysis(conn, report_id)

    assert latest() is None  # Pending.
    run_once(MockProvider(lambda request: parse_output("not json")), storage)
    assert latest() is None  # Failed.

    # A summary-only row from before this schema is not a complete result.
    db.execute(
        "insert into public.ai_analyses (report_id, processing_status, summary)"
        " values (%s, 'succeeded', 'Legacy summary')",
        (report_id,),
    )
    assert latest() is None

    db.execute(
        "insert into public.ai_analyses (report_id) values (%s)", (report_id,)
    )  # Analyze again.
    run_once(MockProvider(lambda request: parse_output(payload())), storage)
    result = latest()
    assert result is not None
    # Hazard, so high priority (LS-14).
    assert (result.category_id, result.priority, result.confidence) == (spills, "high", 0.82)
    assert result.details == VALID["details"]


def test_staff_api_returns_the_full_structured_result(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    spills = add_category(db, "Spills")
    receipt = submit(client, db, storage)
    run_once(MockProvider(lambda request: parse_output(payload())), storage)
    admin = create_user(db, "administrator")
    from tests.conftest import auth_as

    body = client.get(f"/reports/{receipt['id']}/analysis", headers=auth_as(admin)).json()
    assert body["processing_status"] == "succeeded"
    assert body["category"] == {"id": str(spills), "name": "Spills"}
    assert body["details"] == VALID["details"]
    assert body["priority"] == "high"  # Hazard, so high (LS-14).
    assert body["potential_safety_hazard"] is True
    assert body["confidence"] == 0.82
    assert body["uncertain"] is False and body["uncertainty_reason"] is None
