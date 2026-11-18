import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.ai import ProviderNotConfigured, get_provider
from app.analysis import (
    AnalysisQueue,
    AnalysisWorker,
    DisabledQueue,
    safe_detect_duplicates,
    set_analysis_queue,
)
from app.api import admin_users, analysis, duplicates, health, me, media, reference, reports
from app.config import Settings, get_settings
from app.storage import storage_from_settings

logger = logging.getLogger("app")


def build_analysis_queue(settings: Settings) -> AnalysisQueue:
    """Start AI analysis if it is configured. Reports are accepted either way."""
    try:
        provider = get_provider(settings)
    except ProviderNotConfigured as error:
        logger.error("AI analysis is off: %s", error)
        return DisabledQueue()
    if provider is None:
        logger.info("AI analysis is off (AI_PROVIDER=disabled)")
        return DisabledQueue()
    storage = storage_from_settings(settings)
    if storage is None or not settings.database_url:
        logger.error("AI analysis is off: database or photo storage is not configured")
        return DisabledQueue()
    worker = AnalysisWorker(
        provider=provider,
        storage=storage,
        connect=db.connection,
        max_attempts=settings.ai_max_attempts,
        confidence_threshold=settings.ai_confidence_threshold,
        find_duplicates=partial(
            safe_detect_duplicates,
            window_hours=settings.duplicate_window_hours,
            text_threshold=settings.duplicate_text_threshold,
        ),
    )
    worker.start()
    logger.info("AI analysis is on: %s / %s", provider.name, provider.model)
    return worker


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    queue = build_analysis_queue(get_settings())
    set_analysis_queue(queue)
    yield
    if isinstance(queue, AnalysisWorker):
        queue.stop()
    set_analysis_queue(DisabledQueue())
    db.close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(admin_users.router)
    app.include_router(reference.router)
    app.include_router(reference.admin_router)
    app.include_router(media.router)
    app.include_router(reports.router)
    app.include_router(analysis.router)
    app.include_router(duplicates.router)
    return app


app = create_app()
