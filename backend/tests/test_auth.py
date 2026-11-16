"""Access-token verification tests (LS-02).

Tokens are signed with keys generated inside the test, so no Supabase project
or real credential is involved.
"""

import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.auth import TokenVerifier, get_token_verifier
from app.main import app

ISSUER = "https://example-project.supabase.co/auth/v1"
AUDIENCE = "authenticated"
USER_ID = "11111111-2222-3333-4444-555555555555"
HS_SECRET = "test-only-shared-secret-of-sufficient-length"

_private_key = ec.generate_private_key(ec.SECP256R1())
_other_private_key = ec.generate_private_key(ec.SECP256R1())


class _StaticKeyVerifier(TokenVerifier):
    """Verifier that uses a fixed public key instead of fetching a JWKS."""

    def _signing_key(self, token: str, algorithm: str) -> Any:
        if algorithm == "ES256":
            return _private_key.public_key()
        return super()._signing_key(token, algorithm)


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": USER_ID,
        "email": "student@example.edu",
        "aud": AUDIENCE,
        "iss": ISSUER,
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    return {key: value for key, value in claims.items() if value is not None}


def _token(key: Any = _private_key, algorithm: str = "ES256", **overrides: Any) -> str:
    return jwt.encode(_claims(**overrides), key, algorithm=algorithm)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client() -> Any:
    app.dependency_overrides[get_token_verifier] = lambda: _StaticKeyVerifier(
        issuer=ISSUER, audience=AUDIENCE
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_valid_token_identifies_user(client: TestClient) -> None:
    response = client.get("/me", headers=_auth(_token()))
    assert response.status_code == 200
    assert response.json() == {"id": USER_ID, "email": "student@example.edu"}


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


def test_hs256_token_accepted_when_legacy_secret_configured() -> None:
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
