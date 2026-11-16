"""Authentication: verifies Supabase-issued access tokens on protected requests.

The backend is the authoritative boundary (SDD v0.2 RC-01, section 5.7). The
mobile client signs in with Supabase and sends the access token as a Bearer
token; every protected endpoint depends on `get_current_user`.

This module establishes identity only. Roles and record-level authorization
are added in LS-04.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

# Asymmetric algorithms Supabase signing keys can use. HS256 is handled
# separately and only when a legacy shared secret is configured.
ASYMMETRIC_ALGORITHMS = ("ES256", "RS256", "EdDSA")


@dataclass(frozen=True)
class AuthUser:
    """The authenticated caller, taken from a verified access token."""

    id: str
    email: str | None = None


class AuthNotConfiguredError(Exception):
    """Raised when the backend has no Supabase project configured."""


class TokenVerifier:
    """Verifies a Supabase access token and returns its claims."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        jwks_url: str = "",
        hs256_secret: str = "",
    ) -> None:
        self._issuer = issuer
        self._audience = audience
        self._hs256_secret = hs256_secret
        self._jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True) if jwks_url else None

    def _signing_key(self, token: str, algorithm: str) -> Any:
        if algorithm == "HS256":
            if not self._hs256_secret:
                raise jwt.InvalidAlgorithmError("HS256 tokens are not accepted")
            return self._hs256_secret
        if algorithm not in ASYMMETRIC_ALGORITHMS:
            raise jwt.InvalidAlgorithmError("Unsupported signing algorithm")
        if self._jwks_client is None:
            raise AuthNotConfiguredError
        return self._jwks_client.get_signing_key_from_jwt(token).key

    def verify(self, token: str) -> dict[str, Any]:
        if not self._issuer:
            raise AuthNotConfiguredError
        # The header is read only to pick the key type; the algorithm is then
        # pinned so a token cannot choose a weaker one than its key allows.
        algorithm = jwt.get_unverified_header(token).get("alg", "")
        key = self._signing_key(token, algorithm)
        return jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience=self._audience,
            issuer=self._issuer,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )


@lru_cache
def _build_verifier(issuer: str, audience: str, hs256_secret: str) -> TokenVerifier:
    jwks_url = f"{issuer}/.well-known/jwks.json" if issuer else ""
    return TokenVerifier(
        issuer=issuer, audience=audience, jwks_url=jwks_url, hs256_secret=hs256_secret
    )


def get_token_verifier(settings: Annotated[Settings, Depends(get_settings)]) -> TokenVerifier:
    return _build_verifier(
        settings.supabase_auth_url, settings.supabase_jwt_audience, settings.supabase_jwt_secret
    )


_bearer = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    # Deliberately generic: do not reveal why a token was rejected.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
) -> AuthUser:
    """FastAPI dependency: require a valid Supabase access token."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        claims = verifier.verify(credentials.credentials)
    except AuthNotConfiguredError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        ) from None
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is unavailable",
        ) from None
    except jwt.PyJWTError:
        raise _unauthorized() from None
    return AuthUser(id=str(claims["sub"]), email=claims.get("email"))


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
