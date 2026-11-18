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
from typing import Annotated, Any, Protocol
from uuid import UUID

from fastapi import Depends

from app.ai import AIProvider, AIProviderError, AnalysisOutput, AnalysisRequest
from app.ai.images import prepare_image
from app.db import Connection
from app.storage import MediaStorage, StorageError

logger = logging.getLogger(__name__)

MAX_BACKOFF_SECONDS = 30.0


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
        try:
            output = _analyze(row, provider, storage, max_attempts, sleep)
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
                set processing_status = 'succeeded', summary = %s, error_message = null,
                    provider = %s, model = %s, completed_at = now()
                where id = %s
                """,
                (output.summary, provider.name, provider.model, analysis_id),
            )
    return analysis_id


def _analyze(
    row: dict[str, Any],
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
                request = _build_request(row, storage)
            return provider.analyze(request)
        except AIProviderError as error:
            if not error.retryable or attempt == attempts:
                raise
            sleep(min(2.0**attempt, MAX_BACKOFF_SECONDS))
    raise AssertionError("unreachable")


def _build_request(row: dict[str, Any], storage: MediaStorage) -> AnalysisRequest:
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
    )


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
        poll_seconds: float = 60.0,
    ) -> None:
        self._provider = provider
        self._storage = storage
        self._connect = connect
        self._max_attempts = max_attempts
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
