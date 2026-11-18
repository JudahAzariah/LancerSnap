"""Duplicate-report detection (LS-15; RC-06, DD-06, RC-02, OQ-04, RISK-03).

Finds earlier or later reports that may describe the same issue and records
them as *candidates* in `duplicate_candidates` for staff review. It never
merges, deletes, closes, or otherwise changes a report.

Matching follows OQ-04's first stage: category, location, submission time,
and text. Image similarity is deliberately not used (deferred by OQ-04), and
no extra technology (such as a vector database) is involved.

A pair of reports is a candidate when both are at the **same location**, were
submitted within the **time window**, and either:

* both have a category and it is the **same category**; or
* at least one has no category yet, and their **text is similar** enough
  (note plus AI summary, word overlap at or above the threshold).

Two reports with different categories are never paired. The text similarity
is always recorded as an extra signal for staff. The window and threshold are
implementation choices, not SDD values, and are configurable.
"""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from app.db import Connection

DEFAULT_WINDOW_HOURS = 72
DEFAULT_TEXT_THRESHOLD = 0.3
MAX_CANDIDATES_PER_REPORT = 10

_STOPWORDS = frozenset(
    """
    the and for are but not you all any can had her was one our out has have
    this that with from they will there their what when where which while near
    room floor building campus outside inside next there here very been into
    """.split()
)

# A report's category for matching: the staff-confirmed one, otherwise the
# newest validated AI suggestion (LS-12). Never an unvalidated AI result.
_REPORT_FACTS = """
    select r.id, r.reference_code, r.location_id, r.created_at, r.note,
           case when r.category_confirmed_by is not null then r.category_id
                else ai.suggested_category_id end as category_id,
           ai.summary
    from public.reports r
    left join lateral (
        select suggested_category_id, summary
        from public.ai_analyses a
        where a.report_id = r.id and a.processing_status = 'succeeded'
          and a.suggested_priority is not null and a.confidence is not null
        order by a.created_at desc, a.id desc
        limit 1
    ) ai on true
"""


def words(text: str | None) -> frozenset[str]:
    """Meaningful lower-case words (3+ letters, common words removed)."""
    if not text:
        return frozenset()
    return frozenset(
        word for word in re.findall(r"[a-z0-9]{3,}", text.lower()) if word not in _STOPWORDS
    )


def text_similarity(a: frozenset[str], b: frozenset[str]) -> float:
    """Jaccard overlap of two word sets, 0 to 1."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _report_words(row: dict[str, Any]) -> frozenset[str]:
    return words(f"{row['note'] or ''} {row['summary'] or ''}")


def detect_duplicates(
    db: Connection,
    report_id: UUID,
    *,
    window_hours: float = DEFAULT_WINDOW_HOURS,
    text_threshold: float = DEFAULT_TEXT_THRESHOLD,
) -> list[UUID]:
    """Record duplicate candidates for one report. Returns the newly paired report ids.

    Safe to run more than once: a pair already recorded (in either direction)
    is left as it is, including any staff decision about it. Only
    `duplicate_candidates` is written.
    """
    report = db.execute(f"{_REPORT_FACTS} where r.id = %s", (report_id,)).fetchone()
    if report is None:
        return []
    others = db.execute(
        f"""
        {_REPORT_FACTS}
        where r.id <> %s and r.location_id = %s
          and r.created_at between %s - make_interval(secs => %s)
                               and %s + make_interval(secs => %s)
        order by abs(extract(epoch from r.created_at - %s)), r.id
        """,
        (
            report_id,
            report["location_id"],
            report["created_at"],
            window_hours * 3600,
            report["created_at"],
            window_hours * 3600,
            report["created_at"],
        ),
    ).fetchall()

    own_words = _report_words(report)
    added: list[UUID] = []
    for other in others:
        if len(added) >= MAX_CANDIDATES_PER_REPORT:
            break
        signals = _signals(report, other, own_words, text_threshold)
        if signals is None:
            continue
        inserted = db.execute(
            """
            insert into public.duplicate_candidates
                (report_id, candidate_report_id, similarity_signals)
            select %s, %s, %s
            where not exists (
                select 1 from public.duplicate_candidates
                where (report_id = %s and candidate_report_id = %s)
                   or (report_id = %s and candidate_report_id = %s)
            )
            returning candidate_report_id
            """,
            (
                report_id,
                other["id"],
                Jsonb(signals),
                report_id,
                other["id"],
                other["id"],
                report_id,
            ),
        ).fetchone()
        if inserted is not None:
            added.append(UUID(str(inserted["candidate_report_id"])))
    return added


def _signals(
    report: dict[str, Any],
    other: dict[str, Any],
    own_words: frozenset[str],
    text_threshold: float,
) -> dict[str, object] | None:
    """Why two reports may be duplicates, or None if they should not be paired."""
    similarity = round(text_similarity(own_words, _report_words(other)), 3)
    hours_apart = round(_hours_between(report["created_at"], other["created_at"]), 1)
    both_categorized = report["category_id"] is not None and other["category_id"] is not None

    if both_categorized:
        if report["category_id"] != other["category_id"]:
            return None
        rule = "same_category_location_time"
    elif similarity >= text_threshold:
        rule = "similar_text_location_time"
    else:
        return None
    return {
        "rule": rule,
        "same_location": True,
        "same_category": True if both_categorized else None,
        "hours_apart": hours_apart,
        "text_similarity": similarity,
    }


def _hours_between(a: datetime, b: datetime) -> float:
    return abs((a - b).total_seconds()) / 3600
