"""Mock AI provider for local development and tests. Makes no network calls."""

from collections.abc import Callable

from app.ai.provider import AIProviderError, AnalysisOutput, AnalysisRequest


class MockProvider:
    """Returns a fixed, clearly labelled result without calling any AI service.

    `behavior` lets tests script each attempt: return an AnalysisOutput or
    raise AIProviderError (for example a timeout).
    """

    def __init__(self, behavior: Callable[[AnalysisRequest], AnalysisOutput] | None = None):
        self._behavior = behavior
        self.requests: list[AnalysisRequest] = []

    @property
    def name(self) -> str:
        return "mock"

    @property
    def model(self) -> str:
        return "mock"

    def analyze(self, request: AnalysisRequest) -> AnalysisOutput:
        self.requests.append(request)
        if self._behavior is not None:
            return self._behavior(request)
        return AnalysisOutput(summary=f"[Mock analysis] Reported issue at {request.location_name}.")


def always_fail(code: str, *, retryable: bool) -> Callable[[AnalysisRequest], AnalysisOutput]:
    def behavior(_: AnalysisRequest) -> AnalysisOutput:
        raise AIProviderError(code, retryable=retryable)

    return behavior
