"""Application settings.

All values come from environment variables (or a local, git-ignored `.env`
file). Secrets must never be hard-coded here or committed to the repository.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "LancerSnap API"
    environment: str = "development"
    # Comma-separated list of origins allowed to call the API from a browser
    # (Expo web during development). Native mobile clients are not subject to CORS.
    cors_origins: str = "http://localhost:8081"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
