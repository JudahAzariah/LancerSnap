"""Shared test fixtures.

* Tokens are signed with a key generated here, so no Supabase project or real
  credential is involved.
* The database is a throwaway in-memory Postgres (PGlite) with the real
  migrations applied, started by `supabase/scripts/serve-test-db.mjs`.
"""

import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app import db as app_db
from app.auth import TokenVerifier, get_token_verifier
from app.config import Settings
from app.main import app

ISSUER = "https://example-project.supabase.co/auth/v1"
AUDIENCE = "authenticated"

SUPABASE_DIR = Path(__file__).resolve().parents[2] / "supabase"

signing_key = ec.generate_private_key(ec.SECP256R1())
other_signing_key = ec.generate_private_key(ec.SECP256R1())


class StaticKeyVerifier(TokenVerifier):
    """Verifier that uses a fixed public key instead of fetching a JWKS."""

    def _signing_key(self, token: str, algorithm: str) -> Any:
        if algorithm == "ES256":
            return signing_key.public_key()
        return super()._signing_key(token, algorithm)


def make_claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": "11111111-2222-3333-4444-555555555555",
        "email": "student@example.edu",
        "aud": AUDIENCE,
        "iss": ISSUER,
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    return {key: value for key, value in claims.items() if value is not None}


def make_token(key: Any = signing_key, algorithm: str = "ES256", **overrides: Any) -> str:
    return jwt.encode(make_claims(**overrides), key, algorithm=algorithm)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def auth_as(user_id: UUID | str, email: str | None = None) -> dict[str, str]:
    """Authorization header for a signed-in user."""
    return bearer(make_token(sub=str(user_id), email=email or f"{user_id}@example.edu"))


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(autouse=True)
def _never_use_a_real_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never reach the database named in a developer's local .env."""
    monkeypatch.setattr(app_db, "get_settings", lambda: Settings(_env_file=None, database_url=""))


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """Start the throwaway Postgres once for the whole test session."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is required to run the test database")
    if not (SUPABASE_DIR / "node_modules").exists():
        pytest.skip("Run `npm install` in supabase/ to enable database tests")

    port = _free_port()
    process = subprocess.Popen(
        [node, "scripts/serve-test-db.mjs", str(port)],
        cwd=SUPABASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        assert process.stdout is not None
        line = process.stdout.readline()
        if not line.startswith("READY"):
            raise RuntimeError(f"Test database failed to start: {line}{process.stdout.read()}")
        yield f"postgresql://postgres:postgres@127.0.0.1:{port}/postgres?sslmode=disable"
    finally:
        process.terminate()
        process.wait(timeout=10)


@pytest.fixture
def db(database_url: str) -> Iterator[psycopg.Connection[dict[str, Any]]]:
    """A clean database for one test, plus a direct connection for setup."""
    app_db.init_pool(database_url, max_size=1)
    with psycopg.connect(database_url, row_factory=dict_row, autocommit=True) as connection:
        connection.execute("delete from auth.users")
        connection.execute(
            """
            truncate public.notifications, public.status_history, public.duplicate_candidates,
                     public.ai_analyses, public.report_media, public.reports,
                     public.routing_rules, public.team_members, public.teams,
                     public.categories, public.locations, public.profiles
            restart identity cascade
            """
        )
        yield connection
    app_db.close_pool()


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_token_verifier] = lambda: StaticKeyVerifier(
        issuer=ISSUER, audience=AUDIENCE
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


# --- Data builders ------------------------------------------------------------


def create_user(db: psycopg.Connection[Any], role: str = "student") -> UUID:
    user_id = uuid4()
    db.execute(
        "insert into auth.users (id, email) values (%s, %s)", (user_id, f"{user_id}@example.edu")
    )
    if role != "student":
        db.execute("update public.profiles set role = %s where id = %s", (role, user_id))
    return user_id


def create_team(db: psycopg.Connection[Any], name: str | None = None) -> UUID:
    row = db.execute(
        "insert into public.teams (name) values (%s) returning id", (name or f"Team {uuid4()}",)
    ).fetchone()
    assert row is not None
    return UUID(str(row["id"]))


def add_member(db: psycopg.Connection[Any], team_id: UUID, user_id: UUID) -> None:
    db.execute(
        "insert into public.team_members (team_id, user_id) values (%s, %s)", (team_id, user_id)
    )
