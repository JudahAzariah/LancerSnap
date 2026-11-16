"""Database access.

The backend connects to PostgreSQL directly with a server-side connection
string. It is the only writer and the authoritative authorization boundary
(RC-01): every query that returns user data must be scoped by the caller's
role in application code. Row-level security in the database is a second
layer for anything that reaches Supabase without going through this API.
"""

from collections.abc import Iterator
from typing import Annotated, Any

import psycopg
from fastapi import Depends, HTTPException, status
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from app.config import get_settings

Connection = psycopg.Connection[dict[str, Any]]

_pool: ConnectionPool[Connection] | None = None


def init_pool(database_url: str, *, max_size: int = 5) -> None:
    """Open the connection pool. Connections are made lazily, on first use."""
    global _pool
    close_pool()
    _pool = ConnectionPool(
        database_url,
        min_size=0,
        max_size=max_size,
        open=True,
        timeout=10,
        kwargs={
            "row_factory": dict_row,
            # Works through connection poolers that do not keep server-side
            # prepared statements between transactions.
            "prepare_threshold": None,
        },
    )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _get_pool() -> ConnectionPool[Connection]:
    if _pool is None:
        database_url = get_settings().database_url
        if not database_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database is not configured",
            )
        init_pool(database_url)
    assert _pool is not None
    return _pool


def get_db() -> Iterator[Connection]:
    """FastAPI dependency: one connection, one transaction per request.

    Commits when the request handler succeeds and rolls back when it raises,
    so a failed request never leaves partial changes behind.
    """
    pool = _get_pool()
    try:
        with pool.connection() as connection:
            yield connection
    except (psycopg.OperationalError, PoolTimeout):
        # Do not leak connection details (host, user) to the client.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from None


Db = Annotated[Connection, Depends(get_db)]
