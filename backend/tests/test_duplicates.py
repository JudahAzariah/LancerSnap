"""Duplicate-report detection (LS-15; RC-06, DD-06, RC-01, OQ-04, RISK-03).

Fixture reports cover true matches, near misses, and unrelated reports. No
real AI service is called.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import analysis as analysis_module
from app import db as app_db
from app.ai.mock import MockProvider, mock_output
from app.duplicates import detect_duplicates, text_similarity, words
from tests.conftest import (
    FakeStorage,
    add_member,
    auth_as,
    create_location,
    create_team,
    create_user,
)
from tests.test_analysis import analyses, jpeg, run_once, submit
from tests.test_analysis_schema import add_category

Db = psycopg.Connection[Any]


def make_report(
    db: Db,
    location: UUID,
    *,
    hours_ago: float = 0,
    note: str | None = None,
    category: UUID | None = None,
    summary: str | None = None,
    confirmed_category: UUID | None = None,
    team: UUID | None = None,
) -> UUID:
    student = create_user(db)
    row = db.execute(
        """
        insert into public.reports (submitter_id, location_id, note, assigned_team_id, created_at)
        values (%s, %s, %s, %s, now() - make_interval(secs => %s))
        returning id
        """,
        (student, location, note, team, hours_ago * 3600),
    ).fetchone()
    report_id = UUID(str(row["id"]))
    if category is not None or summary is not None:
        db.execute(
            """
            insert into public.ai_analyses (report_id, processing_status, suggested_category_id,
                summary, details, suggested_priority, is_potential_safety_hazard, confidence)
            values (%s, 'succeeded', %s, %s, '[]', 'medium', false, 0.9)
            """,
            (report_id, category, summary or "An issue."),
        )
    if confirmed_category is not None:
        staff = create_user(db, "staff")
        db.execute(
            """
            update public.reports set category_id = %s, category_confirmed_by = %s,
                   category_confirmed_at = now() where id = %s
            """,
            (confirmed_category, staff, report_id),
        )
    return report_id


def detect(report_id: UUID, **kwargs: Any) -> list[UUID]:
    with app_db.connection() as conn:
        return detect_duplicates(conn, report_id, **kwargs)


def candidates(db: Db) -> list[dict[str, Any]]:
    return db.execute(
        "select * from public.duplicate_candidates order by created_at, id"
    ).fetchall()


def reports_snapshot(db: Db) -> list[dict[str, Any]]:
    return db.execute(
        """
        select id, status, category_id, category_confirmed_by, assigned_team_id, assigned_to,
               updated_at
        from public.reports order by id
        """
    ).fetchall()


# --- Text signal -------------------------------------------------------------------------


def test_words_ignore_case_short_and_common_words() -> None:
    assert words("The broken LIGHT in the hallway, is it out?") == frozenset(
        {"broken", "light", "hallway"}
    )
    assert words(None) == frozenset()


def test_text_similarity_is_word_overlap() -> None:
    assert text_similarity(words("broken light hallway"), words("hallway light broken")) == 1.0
    assert text_similarity(words("broken light"), words("water leak")) == 0.0
    assert text_similarity(frozenset(), words("anything")) == 0.0


# --- Matching rules ----------------------------------------------------------------------


def test_same_category_and_location_within_the_window_is_a_candidate(db: Db) -> None:
    location = create_location(db)
    lighting = add_category(db, "Lighting")
    earlier = make_report(db, location, hours_ago=20, category=lighting, note="Light out")
    new = make_report(db, location, category=lighting, note="Hallway lamp broken")

    assert detect(new) == [earlier]
    (row,) = candidates(db)
    assert (row["report_id"], row["candidate_report_id"]) == (new, earlier)
    assert row["review_state"] == "pending"
    signals = row["similarity_signals"]
    assert signals["rule"] == "same_category_location_time"
    assert signals["same_location"] is True and signals["same_category"] is True
    assert signals["hours_apart"] == 20.0
    assert 0 <= signals["text_similarity"] <= 1


@pytest.mark.parametrize(
    "near_miss",
    ["other_location", "other_category", "outside_window"],
)
def test_near_misses_are_not_candidates(db: Db, near_miss: str) -> None:
    location, elsewhere = create_location(db), create_location(db)
    lighting, plumbing = add_category(db, "Lighting"), add_category(db, "Plumbing")
    other = {
        "other_location": {"location": elsewhere, "category": lighting, "hours_ago": 1},
        "other_category": {"location": location, "category": plumbing, "hours_ago": 1},
        "outside_window": {"location": location, "category": lighting, "hours_ago": 73},
    }[near_miss]
    make_report(
        db, other["location"], hours_ago=other["hours_ago"], category=other["category"], note="x"
    )
    new = make_report(db, location, category=lighting, note="x")
    assert detect(new) == []
    assert candidates(db) == []


def test_without_a_category_similar_text_is_needed(db: Db) -> None:
    location = create_location(db)
    similar = make_report(db, location, hours_ago=2, note="Water leaking from ceiling tiles")
    make_report(db, location, hours_ago=3, note="Broken chair in lecture hall")
    new = make_report(db, location, note="Ceiling tiles leaking water near stairs")

    assert detect(new) == [similar]
    (row,) = candidates(db)
    assert row["similarity_signals"]["rule"] == "similar_text_location_time"
    assert row["similarity_signals"]["same_category"] is None
    assert row["similarity_signals"]["text_similarity"] >= 0.3


def test_a_staff_confirmed_category_is_used_over_the_ai_suggestion(db: Db) -> None:
    location = create_location(db)
    lighting, plumbing = add_category(db, "Lighting"), add_category(db, "Plumbing")
    earlier = make_report(db, location, hours_ago=1, category=lighting)
    # The AI said plumbing, but staff confirmed lighting: it matches the earlier report.
    new = make_report(db, location, category=plumbing, confirmed_category=lighting)
    assert detect(new) == [earlier]


def test_window_and_threshold_are_configurable(db: Db) -> None:
    location = create_location(db)
    lighting = add_category(db, "Lighting")
    old = make_report(db, location, hours_ago=100, category=lighting)
    new = make_report(db, location, category=lighting)
    assert detect(new) == []
    assert detect(new, window_hours=120) == [old]


def test_detection_is_idempotent_and_keeps_staff_decisions(db: Db) -> None:
    location = create_location(db)
    lighting = add_category(db, "Lighting")
    earlier = make_report(db, location, hours_ago=1, category=lighting)
    new = make_report(db, location, category=lighting)
    detect(new)
    db.execute("update public.duplicate_candidates set review_state = 'not_duplicate'")

    assert detect(new) == []
    assert detect(earlier) == []  # The reverse pair is the same pair.
    (row,) = candidates(db)
    assert row["review_state"] == "not_duplicate"


def test_detection_never_changes_any_report(db: Db) -> None:
    location = create_location(db)
    lighting = add_category(db, "Lighting")
    for hours in (1, 2, 3):
        make_report(db, location, hours_ago=hours, category=lighting)
    new = make_report(db, location, category=lighting)
    before = reports_snapshot(db)

    assert len(detect(new)) == 3
    assert reports_snapshot(db) == before
    assert db.execute("select count(*) as n from public.status_history").fetchone()["n"] == 0


# --- When detection runs ---------------------------------------------------------------


def test_detection_runs_after_analysis(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any
) -> None:
    add_category(db, "Facilities")
    first = submit(client, db, storage)
    location = db.execute(
        "select location_id from public.reports where id = %s", (first["id"],)
    ).fetchone()["location_id"]
    classify = MockProvider(
        lambda request: mock_output(
            request, category="Facilities", confidence=0.9, uncertain=False, uncertainty_reason=None
        )
    )
    run_once(classify, storage)

    # A second report at the same location, with a photo, analyzed into the same category.
    second = make_report(db, location)
    storage.put("second/photo.jpg", data=jpeg())
    db.execute(
        """
        insert into public.report_media
            (report_id, uploader_id, bucket, object_path, content_type, size_bytes)
        select id, submitter_id, 'report-media', 'second/photo.jpg', 'image/jpeg', 100
        from public.reports where id = %s
        """,
        (second,),
    )
    db.execute("insert into public.ai_analyses (report_id) values (%s)", (second,))
    run_once(classify, storage)

    (row,) = candidates(db)
    assert {row["report_id"], row["candidate_report_id"]} == {UUID(first["id"]), second}


def test_detection_runs_at_submission_when_ai_is_off(
    client: TestClient, db: Db, storage: FakeStorage
) -> None:
    first = submit(client, db, storage, note="Water leaking from the ceiling tiles")
    location = db.execute(
        "select location_id from public.reports where id = %s", (first["id"],)
    ).fetchone()["location_id"]
    student = create_user(db)
    ticket = client.post(
        "/media/uploads",
        headers=auth_as(student),
        json={"content_type": "image/jpeg", "size_bytes": 1000},
    ).json()
    storage.put(ticket["object_path"])
    second = client.post(
        "/reports",
        headers=auth_as(student),
        json={
            "media_id": ticket["media_id"],
            "location_id": str(location),
            "note": "Ceiling tiles leaking water",
        },
    )
    assert second.status_code == 201
    (row,) = candidates(db)
    assert row["similarity_signals"]["rule"] == "similar_text_location_time"


def test_a_detection_failure_never_breaks_the_analysis(
    client: TestClient, db: Db, storage: FakeStorage, queue: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*args: Any, **kwargs: Any) -> list[UUID]:
        raise RuntimeError("detection bug")

    monkeypatch.setattr(analysis_module, "detect_duplicates", broken)
    receipt = submit(client, db, storage)
    run_once(MockProvider(), storage)
    assert analyses(db, receipt["id"])[0]["processing_status"] == "succeeded"


# --- Staff API ---------------------------------------------------------------------------


@pytest.fixture
def pair(db: Db) -> dict[str, Any]:
    """Two matching reports on team one, and a third on team two."""
    location = create_location(db)
    lighting = add_category(db, "Lighting")
    team_one, team_two = create_team(db), create_team(db)
    earlier = make_report(db, location, hours_ago=5, category=lighting, team=team_one)
    other_team = make_report(db, location, hours_ago=6, category=lighting, team=team_two)
    new = make_report(db, location, category=lighting, team=team_one)
    detect(new)
    staff_one, staff_two = create_user(db, "staff"), create_user(db, "staff")
    add_member(db, team_one, staff_one)
    add_member(db, team_two, staff_two)
    return {
        "new": new,
        "earlier": earlier,
        "other_team": other_team,
        "staff_one": staff_one,
        "staff_two": staff_two,
        "admin": create_user(db, "administrator"),
    }


def test_staff_see_candidates_only_for_reports_they_handle(
    client: TestClient, db: Db, pair: dict[str, Any]
) -> None:
    url = f"/reports/{pair['new']}/duplicates"
    # Team one sees the pairing with its own earlier report, not team two's report.
    listed = client.get(url, headers=auth_as(pair["staff_one"])).json()
    assert [c["other_report"]["id"] for c in listed] == [str(pair["earlier"])]
    assert listed[0]["review_state"] == "pending"
    assert listed[0]["signals"]["rule"] == "same_category_location_time"

    assert client.get(url, headers=auth_as(pair["staff_two"])).status_code == 404
    admin_view = client.get(url, headers=auth_as(pair["admin"])).json()
    assert {c["other_report"]["id"] for c in admin_view} == {
        str(pair["earlier"]),
        str(pair["other_team"]),
    }
    # The candidate also shows from the other report's side.
    from_earlier = client.get(
        f"/reports/{pair['earlier']}/duplicates", headers=auth_as(pair["staff_one"])
    ).json()
    assert [c["other_report"]["id"] for c in from_earlier] == [str(pair["new"])]


def test_students_cannot_see_duplicate_candidates(
    client: TestClient, db: Db, pair: dict[str, Any]
) -> None:
    submitter = db.execute(
        "select submitter_id from public.reports where id = %s", (pair["new"],)
    ).fetchone()["submitter_id"]
    response = client.get(f"/reports/{pair['new']}/duplicates", headers=auth_as(submitter))
    assert response.status_code == 403


def test_staff_can_mark_not_a_duplicate_and_reports_stay_separate(
    client: TestClient, db: Db, pair: dict[str, Any]
) -> None:
    (candidate,) = client.get(
        f"/reports/{pair['new']}/duplicates", headers=auth_as(pair["staff_one"])
    ).json()
    before = reports_snapshot(db)
    url = f"/reports/{pair['new']}/duplicates/{candidate['id']}"

    response = client.patch(
        url, headers=auth_as(pair["staff_one"]), json={"review_state": "not_duplicate"}
    )
    assert response.status_code == 200
    assert response.json()["review_state"] == "not_duplicate"
    assert response.json()["reviewed_at"] is not None
    row = db.execute(
        "select reviewed_by from public.duplicate_candidates where id = %s", (candidate["id"],)
    ).fetchone()
    assert row["reviewed_by"] == pair["staff_one"]

    # Confirming is also only a record: nothing is merged, closed, or deleted.
    client.patch(
        url, headers=auth_as(pair["staff_one"]), json={"review_state": "confirmed_duplicate"}
    )
    assert reports_snapshot(db) == before
    assert db.execute("select count(*) as n from public.reports").fetchone()["n"] == 3

    reset = client.patch(url, headers=auth_as(pair["staff_one"]), json={"review_state": "pending"})
    assert reset.json()["reviewed_at"] is None


def test_review_is_refused_outside_staff_scope(
    client: TestClient, db: Db, pair: dict[str, Any]
) -> None:
    admin_view = client.get(
        f"/reports/{pair['new']}/duplicates", headers=auth_as(pair["admin"])
    ).json()
    cross_team = next(c for c in admin_view if c["other_report"]["id"] == str(pair["other_team"]))
    body = {"review_state": "not_duplicate"}
    url = f"/reports/{pair['new']}/duplicates/{cross_team['id']}"

    # Team one handles the new report but not team two's: refused.
    assert client.patch(url, headers=auth_as(pair["staff_one"]), json=body).status_code == 404
    assert client.patch(url, headers=auth_as(pair["admin"]), json=body).status_code == 200
    unknown = f"/reports/{pair['new']}/duplicates/{UUID(int=0)}"
    assert client.patch(unknown, headers=auth_as(pair["admin"]), json=body).status_code == 404
    bad = client.patch(url, headers=auth_as(pair["admin"]), json={"review_state": "merged"})
    assert bad.status_code == 422
