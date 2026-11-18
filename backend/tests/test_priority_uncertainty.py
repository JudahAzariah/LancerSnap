"""Priority recommendations and uncertainty handling (LS-14; RC-07, RC-02, RC-03,
RC-08, RC-10, RISK-04, RISK-05). No real AI service is called."""

from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.ai.claude import SYSTEM_PROMPT
from app.ai.mock import MockProvider, always_fail
from app.ai.provider import AnalysisOutput, parse_output
from app.analysis import apply_safety_rules
from app.config import Settings
from tests.conftest import FakeStorage, auth_as, create_user
from tests.test_analysis import analyses, run_once, submit
from tests.test_analysis_schema import add_category, payload

Db = psycopg.Connection[Any]
THRESHOLD = 0.6


def rules(**changes: Any) -> AnalysisOutput:
    return apply_safety_rules(parse_output(payload(**changes)), confidence_threshold=THRESHOLD)


# --- Priority mapping and safety hazards ------------------------------------------------


@pytest.mark.parametrize("given", ["low", "medium", "high"])
def test_a_potential_safety_hazard_is_always_high_priority(given: str) -> None:
    assert rules(potential_safety_hazard=True, priority=given).priority == "high"


@pytest.mark.parametrize("given", ["low", "medium", "high"])
def test_priority_is_kept_when_there_is_no_hazard(given: str) -> None:
    assert rules(potential_safety_hazard=False, priority=given).priority == given


# --- Low confidence and ambiguity ---------------------------------------------------------


def test_low_confidence_is_marked_uncertain_with_a_reason() -> None:
    output = rules(confidence=0.45, uncertain=False, uncertainty_reason=None)
    assert output.uncertain is True
    assert output.uncertainty_reason == (
        "Low AI confidence (0.45); a person should check the category."
    )
    assert output.confidence == 0.45  # The confidence itself is preserved.


def test_confidence_at_or_above_the_threshold_is_left_alone() -> None:
    for confidence in (0.6, 0.95):
        output = rules(confidence=confidence, uncertain=False, uncertainty_reason=None)
        assert output.uncertain is False and output.uncertainty_reason is None


def test_the_ais_own_uncertainty_reason_is_kept() -> None:
    output = rules(confidence=0.2, uncertain=True, uncertainty_reason="Blurry photo.")
    assert output.uncertainty_reason == "Blurry photo."


def test_the_threshold_is_configurable_and_defaults_to_0_6() -> None:
    assert Settings(_env_file=None).ai_confidence_threshold == 0.6
    output = apply_safety_rules(
        parse_output(payload(confidence=0.7, uncertain=False, uncertainty_reason=None)),
        confidence_threshold=0.8,
    )
    assert output.uncertain is True


def test_prompt_asks_for_conservative_priority() -> None:
    assert "Any potential safety hazard is high" in SYSTEM_PROMPT
    assert "choose the higher one" in SYSTEM_PROMPT


# --- Stored as a recommendation; nothing acts on it ----------------------------------------


def test_hazard_result_is_stored_high_and_takes_no_action(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    add_category(db, "Spills")
    receipt = submit(client, db, storage)
    before = {
        table: db.execute(f"select count(*) as n from public.{table}").fetchone()["n"]
        for table in ("status_history", "notifications", "duplicate_candidates")
    }

    run_once(
        MockProvider(
            lambda request: parse_output(
                payload(priority="low", potential_safety_hazard=True, confidence=0.4)
            )
        ),
        storage,
    )
    (row,) = analyses(db, receipt["id"])
    assert row["processing_status"] == "succeeded"
    assert row["suggested_priority"] == "high"
    assert row["is_potential_safety_hazard"] is True
    assert row["is_uncertain"] is True  # Low confidence (0.4).

    # Advisory only (RC-03, RC-08): the report is untouched and nothing was triggered.
    report = db.execute(
        "select status, assigned_team_id, assigned_to, category_id from public.reports"
        " where id = %s",
        (receipt["id"],),
    ).fetchone()
    assert report == {
        "status": "submitted",
        "assigned_team_id": None,
        "assigned_to": None,
        "category_id": None,
    }
    after = {
        table: db.execute(f"select count(*) as n from public.{table}").fetchone()["n"]
        for table in before
    }
    assert after == before


# --- Failures are visible and never look like "no priority" ------------------------------


def test_failed_analysis_is_reported_as_failed_with_no_priority(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    receipt = submit(client, db, storage)
    run_once(MockProvider(always_fail("unavailable", retryable=False)), storage)
    admin = create_user(db, "administrator")

    body = client.get(f"/reports/{receipt['id']}/analysis", headers=auth_as(admin)).json()
    assert body["processing_status"] == "failed"
    assert body["error"] == "unavailable"
    assert body["priority"] is None and body["potential_safety_hazard"] is None

    # The student is not shown any category or priority from a failed analysis.
    student_view = client.get(
        f"/reports/{receipt['id']}", headers=auth_as(receipt["submitter_id"])
    ).json()
    assert student_view["category"] is None
    assert "priority" not in student_view
