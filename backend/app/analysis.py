"""AI analysis pipeline (LS-11; SDD §5.5 step 5, RC-10, DD-08, RISK-05).

1. Submitting a report queues an analysis: a `pending` row in `ai_analyses`,
   written in the same transaction as the report. Nothing about the AI service
   is checked or awaited, so an AI outage can never block a submission.
2. A background worker picks up pending analyses one at a time, sends the
   approved report content to the configured provider with a timeout and a
   bounded number of attempts, and records the outcome as `succeeded` or
   `failed`. A failure is stored as a failure, never as a result.
3. The worker only writes to `ai_analyses`. It never changes a report's status,
   assignment, or category: AI output is advisory (RC-02, RC-03).

Each retry requested by staff is a new row; the newest row is the current one.
"""

import logging
import threading
import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Annotated, Any, Protocol
from uuid import UUID

from fastapi import Depends
from psycopg.types.json import Jsonb

from app.ai import AIProvider, AIProviderError, AnalysisOutput, AnalysisRequest
from app.ai.images import prepare_image
from app.ai.provider import CategoryOption
from app.db import Connection
from app.duplicates import DEFAULT_TEXT_THRESHOLD, DEFAULT_WINDOW_HOURS, detect_duplicates
from app.storage import MediaStorage, StorageError

logger = logging.getLogger(__name__)

MAX_BACKOFF_SECONDS = 30.0
DEFAULT_CONFIDENCE_THRESHOLD = 0.6  # Settings.ai_confidence_threshold


def queue_analysis(db: Connection, report_id: UUID) -> UUID:
    """Record that a report is waiting for AI analysis. Part of the caller's transaction."""
    row = db.execute(
        "insert into public.ai_analyses (report_id) values (%s) returning id", (report_id,)
    ).fetchone()
    assert row is not None
    return UUID(str(row["id"]))


def process_next(
    db: Connection,
    *,
    provider: AIProvider,
    storage: MediaStorage,
    max_attempts: int,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    find_duplicates: Callable[[Connection, UUID], object] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> UUID | None:
    """Run the oldest pending analysis. Returns its id, or None if none was waiting.

    The row stays locked (FOR UPDATE SKIP LOCKED) while it is processed, so two
    workers never analyze the same report twice.
    """
    with db.transaction():
        row = db.execute(
            """
            select a.id, a.report_id, r.note, l.name as location_name, m.object_path
            from public.ai_analyses a
            join public.reports r on r.id = a.report_id
            join public.locations l on l.id = r.location_id
            left join lateral (
                select object_path from public.report_media
                where report_id = r.id order by created_at limit 1
            ) m on true
            where a.processing_status = 'pending'
            order by a.created_at, a.id
            limit 1
            for update of a skip locked
            """
        ).fetchone()
        if row is None:
            return None

        analysis_id = UUID(str(row["id"]))
        categories = active_categories(db)
        try:
            output = _analyze(row, categories, provider, storage, max_attempts, sleep)
            category_id = resolve_category(output, categories)
            output = apply_safety_rules(output, confidence_threshold=confidence_threshold)
        except AIProviderError as error:
            logger.warning("AI analysis %s failed: %s", analysis_id, error.code)
            db.execute(
                """
                update public.ai_analyses
                set processing_status = 'failed', error_message = %s,
                    provider = %s, model = %s, completed_at = now()
                where id = %s
                """,
                (error.code, provider.name, provider.model, analysis_id),
            )
        else:
            db.execute(
                """
                update public.ai_analyses
                set processing_status = 'succeeded', error_message = null,
                    suggested_category_id = %s, summary = %s, details = %s,
                    suggested_priority = %s, is_potential_safety_hazard = %s,
                    confidence = %s, is_uncertain = %s, uncertainty_reason = %s,
                    provider = %s, model = %s, completed_at = now()
                where id = %s
                """,
                (
                    category_id,
                    output.summary,
                    Jsonb(output.details),
                    output.priority,
                    output.potential_safety_hazard,
                    round(output.confidence, 3),
                    output.uncertain,
                    output.uncertainty_reason,
                    provider.name,
                    provider.model,
                    analysis_id,
                ),
            )
        # With the category known (or not), look for possible duplicates (LS-15).
        (find_duplicates or safe_detect_duplicates)(db, UUID(str(row["report_id"])))
    return analysis_id


def safe_detect_duplicates(
    db: Connection,
    report_id: UUID,
    *,
    window_hours: float = DEFAULT_WINDOW_HOURS,
    text_threshold: float = DEFAULT_TEXT_THRESHOLD,
) -> None:
    """Duplicate detection that can never undo or block the analysis.

    It runs in a savepoint: if it fails, only its own changes are rolled back
    and the failure is logged. Missing a duplicate is safe; staff review every
    report anyway (RISK-03).
    """
    try:
        with db.transaction():
            detect_duplicates(
                db, report_id, window_hours=window_hours, text_threshold=text_threshold
            )
    except Exception:
        logger.exception("Duplicate detection failed for report %s", report_id)


def apply_safety_rules(output: AnalysisOutput, *, confidence_threshold: float) -> AnalysisOutput:
    """Conservative handling of a validated result (LS-14; RC-07, RC-02, RISK-04).

    Done here, outside any provider, so it holds whatever the AI said:
    * A potential safety hazard is always high priority, so it is surfaced for
      human attention (RC-07). The AI can raise a priority, never lower this.
    * A result below the confidence threshold is always marked uncertain, with
      a reason, even if the AI did not flag it (RC-02).

    The result stays advisory: nothing here (or anywhere) acts on the priority
    automatically, and LancerSnap never contacts emergency services (RC-08).
    """
    changes: dict[str, object] = {}
    if output.potential_safety_hazard and output.priority != "high":
        changes["priority"] = "high"
    if output.confidence < confidence_threshold and not output.uncertain:
        changes["uncertain"] = True
        changes["uncertainty_reason"] = (
            f"Low AI confidence ({output.confidence:.2f}); a person should check the category."
        )
    return output.model_copy(update=changes) if changes else output


def active_categories(db: Connection) -> tuple[CategoryOption, ...]:
    """The categories the AI may suggest: active, administrator-configured ones (LS-05)."""
    rows = db.execute(
        "select id, name, description from public.categories where is_active order by name"
    ).fetchall()
    return tuple(CategoryOption(**row) for row in rows)


def resolve_category(output: AnalysisOutput, offered: tuple[CategoryOption, ...]) -> UUID | None:
    """Map the suggested category name to an offered category, or reject the result.

    Done here, outside any provider, so no provider can store a category that
    was not on the active list. "No category fits" (null) is allowed only
    because the schema forces such a result to be marked uncertain.
    """
    if output.category is None:
        return None
    for option in offered:
        if option.name == output.category:
            return option.id
    raise AIProviderError("unsupported_category", retryable=False)


def _analyze(
    row: dict[str, Any],
    categories: tuple[CategoryOption, ...],
    provider: AIProvider,
    storage: MediaStorage,
    max_attempts: int,
    sleep: Callable[[float], None],
) -> AnalysisOutput:
    if row["object_path"] is None:
        raise AIProviderError("photo_missing", retryable=False)

    request: AnalysisRequest | None = None
    attempts = max(1, max_attempts)
    for attempt in range(1, attempts + 1):
        try:
            if request is None:
                request = _build_request(row, categories, storage)
            return provider.analyze(request)
        except AIProviderError as error:
            if not error.retryable or attempt == attempts:
                raise
            sleep(min(2.0**attempt, MAX_BACKOFF_SECONDS))
    raise AssertionError("unreachable")


def _build_request(
    row: dict[str, Any], categories: tuple[CategoryOption, ...], storage: MediaStorage
) -> AnalysisRequest:
    try:
        original = storage.download(row["object_path"])
    except StorageError as error:
        raise AIProviderError("photo_unavailable", retryable=True) from error
    image, media_type = prepare_image(original)
    return AnalysisRequest(
        image=image,
        image_media_type=media_type,
        note=row["note"],
        location_name=row["location_name"],
        categories=categories,
    )


# --- Reading validated results ---------------------------------------------------


@dataclass(frozen=True)
class ValidatedAnalysis:
    """A successful, schema-validated AI analysis. Advisory only (RC-02, RC-03)."""

    id: UUID
    report_id: UUID
    category_id: UUID | None
    summary: str
    details: list[str]
    priority: str
    potential_safety_hazard: bool
    confidence: float
    uncertain: bool
    uncertainty_reason: str | None


def latest_validated_analysis(db: Connection, report_id: UUID) -> ValidatedAnalysis | None:
    """The newest successful analysis of a report, or None.

    The one place later stages (routing, LS-16) read AI results from. Only
    `succeeded` rows are ever returned, and only those hold AI output: pending
    and failed attempts store no suggestion, so nothing invalid can reach
    downstream logic (Implementation Plan, Critical Dependency Rule 4).
    """
    row = db.execute(
        """
        select id, report_id, suggested_category_id as category_id, summary, details,
               suggested_priority::text as priority,
               is_potential_safety_hazard as potential_safety_hazard,
               confidence::float8 as confidence, is_uncertain as uncertain, uncertainty_reason
        from public.ai_analyses
        where report_id = %s and processing_status = 'succeeded'
          -- Summary-only results from before the LS-12 schema are not complete results.
          and suggested_priority is not null and is_potential_safety_hazard is not null
          and confidence is not null and details is not null
        order by created_at desc, id desc
        limit 1
        """,
        (report_id,),
    ).fetchone()
    return ValidatedAnalysis(**row) if row else None


# --- Background worker ---------------------------------------------------------


class AnalysisQueue(Protocol):
    @property
    def enabled(self) -> bool: ...

    def notify(self) -> None:
        """New work may be waiting."""
        ...


class DisabledQueue:
    """AI analysis is turned off: nothing is queued and reports carry no analysis."""

    enabled = False

    def notify(self) -> None:
        pass


class AnalysisWorker:
    """One background thread that drains pending analyses.

    It wakes when notified after a submission, and also checks periodically,
    so analyses queued before a restart (or whose notification raced the
    commit) are still processed.
    """

    enabled = True

    def __init__(
        self,
        *,
        provider: AIProvider,
        storage: MediaStorage,
        connect: Callable[[], AbstractContextManager[Connection]],
        max_attempts: int,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
        find_duplicates: Callable[[Connection, UUID], object] | None = None,
        poll_seconds: float = 60.0,
    ) -> None:
        self._find_duplicates = find_duplicates
        self._provider = provider
        self._storage = storage
        self._connect = connect
        self._max_attempts = max_attempts
        self._confidence_threshold = confidence_threshold
        self._poll_seconds = poll_seconds
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="ai-analysis", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stopping.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)

    def notify(self) -> None:
        self._wake.set()

    def _run(self) -> None:
        while not self._stopping.is_set():
            self._wake.clear()
            try:
                self._drain()
            except Exception:  # Keep the worker alive through database hiccups.
                logger.exception("AI analysis worker error")
            self._wake.wait(self._poll_seconds)

    def _drain(self) -> None:
        while not self._stopping.is_set():
            with self._connect() as db:
                done = process_next(
                    db,
                    provider=self._provider,
                    storage=self._storage,
                    max_attempts=self._max_attempts,
                    confidence_threshold=self._confidence_threshold,
                    find_duplicates=self._find_duplicates,
                    sleep=self._sleep,
                )
            if done is None:
                return

    def _sleep(self, seconds: float) -> None:
        # Backoff that still ends promptly on shutdown.
        self._stopping.wait(seconds)


_queue: AnalysisQueue = DisabledQueue()


def set_analysis_queue(queue: AnalysisQueue) -> None:
    global _queue
    _queue = queue


def get_analysis_queue() -> AnalysisQueue:
    return _queue


Queue = Annotated[AnalysisQueue, Depends(get_analysis_queue)]
