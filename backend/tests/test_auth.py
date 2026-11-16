"""Access-token verification tests (LS-02).

Tokens are signed with keys generated inside the test, so no Supabase project
or real credential is involved.
"""

import time
from uuid import UUID

import jwt
import psycopg
from fastapi.testclient import TestClient

from app.auth import TokenVerifier, get_token_verifier
from app.main import app
from tests.conftest import (
    AUDIENCE,
    ISSUER,
    bearer,
    make_claims,
    make_token,
    other_signing_key,
)

USER_ID = "11111111-2222-3333-4444-555555555555"
HS_SECRET = "test-only-shared-secret-of-sufficient-length"

_auth = bearer
_token = make_token
_claims = make_claims
_other_private_key = other_signing_key


def test_valid_token_identifies_user(client: TestClient, db: psycopg.Connection) -> None:
    db.execute("insert into auth.users (id) values (%s)", (UUID(USER_ID),))
    response = client.get("/me", headers=_auth(_token()))
    assert response.status_code == 200
    assert response.json() == {
        "id": USER_ID,
        "email": "student@example.edu",
        "role": "student",
        "team_ids": [],
    }


def test_missing_token_is_rejected(client: TestClient) -> None:
    response = client.get("/me")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_malformed_token_is_rejected(client: TestClient) -> None:
    assert client.get("/me", headers=_auth("not-a-jwt")).status_code == 401


def test_non_bearer_scheme_is_rejected(client: TestClient) -> None:
    assert client.get("/me", headers={"Authorization": "Basic abc123"}).status_code == 401


def test_expired_token_is_rejected(client: TestClient) -> None:
    token = _token(exp=int(time.time()) - 60)
    assert client.get("/me", headers=_auth(token)).status_code == 401


def test_token_signed_by_another_key_is_rejected(client: TestClient) -> None:
    token = _token(key=_other_private_key)
    assert client.get("/me", headers=_auth(token)).status_code == 401


def test_wrong_audience_is_rejected(client: TestClient) -> None:
    assert client.get("/me", headers=_auth(_token(aud="anon"))).status_code == 401


def test_wrong_issuer_is_rejected(client: TestClient) -> None:
    token = _token(iss="https://attacker.example/auth/v1")
    assert client.get("/me", headers=_auth(token)).status_code == 401


def test_token_without_subject_is_rejected(client: TestClient) -> None:
    assert client.get("/me", headers=_auth(_token(sub=None))).status_code == 401


def test_unsigned_token_is_rejected(client: TestClient) -> None:
    token = jwt.encode(_claims(), key=None, algorithm="none")
    assert client.get("/me", headers=_auth(token)).status_code == 401


def test_hs256_token_rejected_when_no_secret_configured(client: TestClient) -> None:
    token = _token(key=HS_SECRET, algorithm="HS256")
    assert client.get("/me", headers=_auth(token)).status_code == 401


def test_hs256_token_accepted_when_legacy_secret_configured(db: psycopg.Connection) -> None:
    db.execute("insert into auth.users (id) values (%s)", (UUID(USER_ID),))
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(
        issuer=ISSUER, audience=AUDIENCE, hs256_secret=HS_SECRET
    )
    try:
        client = TestClient(app)
        good = _token(key=HS_SECRET, algorithm="HS256")
        bad = _token(key="a-different-secret-of-sufficient-length!!", algorithm="HS256")
        assert client.get("/me", headers=_auth(good)).status_code == 200
        assert client.get("/me", headers=_auth(bad)).status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_unconfigured_backend_reports_unavailable_not_success() -> None:
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(
        issuer="", audience=AUDIENCE
    )
    try:
        response = TestClient(app).get("/me", headers=_auth(_token()))
        assert response.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_health_stays_public(client: TestClient) -> None:
    assert client.get("/health").status_code == 200
