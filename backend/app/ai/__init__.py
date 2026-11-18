"""AI processing adapter (LS-11). See `provider.py` for the interface."""

from app.ai.provider import AIProvider, AIProviderError, AnalysisOutput, AnalysisRequest
from app.config import Settings

__all__ = [
    "AIProvider",
    "AIProviderError",
    "AnalysisOutput",
    "AnalysisRequest",
    "ProviderNotConfigured",
    "get_provider",
]


class ProviderNotConfigured(Exception):
    """AI analysis is turned on, but the provider is missing its settings."""


def get_provider(settings: Settings) -> AIProvider | None:
    """The configured provider, or None when AI analysis is turned off."""
    choice = settings.ai_provider.strip().lower()
    if choice in ("", "disabled"):
        return None
    if choice == "mock":
        from app.ai.mock import MockProvider

        return MockProvider()
    if choice == "anthropic":
        if not settings.anthropic_api_key:
            raise ProviderNotConfigured("AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY")
        from app.ai.claude import ClaudeProvider

        return ClaudeProvider(
            api_key=settings.anthropic_api_key,
            model=settings.ai_model,
            timeout_seconds=settings.ai_timeout_seconds,
        )
    raise ProviderNotConfigured(f"Unknown AI_PROVIDER: {settings.ai_provider!r}")
