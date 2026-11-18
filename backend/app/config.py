"""Application settings.

All values come from environment variables (or a local, git-ignored `.env`
file). Secrets must never be hard-coded here or committed to the repository.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, wherever the server is started from.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    app_name: str = "LancerSnap API"
    environment: str = "development"
    # Comma-separated list of origins allowed to call the API from a browser
    # (Expo web during development). Native mobile clients are not subject to CORS.
    cors_origins: str = "http://localhost:8081"

    # Supabase project URL, e.g. https://<project-ref>.supabase.co
    supabase_url: str = ""
    # Only for Supabase projects that still sign access tokens with the legacy
    # shared JWT secret (HS256). Leave empty for projects using asymmetric
    # signing keys, which are verified through the project's public JWKS.
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"

    # PostgreSQL connection string for the Supabase database (SECRET: contains
    # the database password). Server-side only.
    database_url: str = ""

    # SECRET. Supabase secret API key (sb_secret_...; older projects call it the
    # service_role key). Used only by the backend to create short-lived signed
    # URLs for the private report-media bucket. Never ship it to the client.
    supabase_secret_key: str = ""
    report_media_bucket: str = "report-media"
    # How long a signed download URL for one photo stays valid.
    media_download_url_seconds: int = 300

    # AI analysis (LS-11). Which provider analyzes new reports:
    #   "disabled"  - no analysis (default; reports are still accepted)
    #   "mock"      - built-in fake results, no network calls, no cost
    #   "anthropic" - Claude via the Anthropic API (needs ANTHROPIC_API_KEY)
    ai_provider: str = "disabled"
    # SECRET. Anthropic API key. Server-side only, never in the mobile app.
    anthropic_api_key: str = ""
    # Project owner's choice (2026-11-18): the lowest-cost current model.
    ai_model: str = "claude-haiku-5-5"
    # Per attempt. A report is never held up by this: analysis runs after it is saved.
    ai_timeout_seconds: float = 60.0
    # Total attempts per analysis for temporary failures (timeouts, overload).
    ai_max_attempts: int = 3

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_auth_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1" if self.supabase_url else ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
