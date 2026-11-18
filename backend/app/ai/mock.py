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
        return mock_output(request)


def mock_output(request: AnalysisRequest, **overrides: object) -> AnalysisOutput:
    """A valid, clearly fake result. Always marked uncertain: it is not a real classification."""
    values: dict[str, object] = {
        "category": request.categories[0].name if request.categories else None,
        "summary": f"[Mock analysis] Reported issue at {request.location_name}.",
        "details": ["Mock result: no AI service was called."],
        "priority": "low",
        "potential_safety_hazard": False,
        "confidence": 0.0,
        "uncertain": True,
        "uncertainty_reason": "Mock analysis for development; not a real classification.",
    }
    values.update(overrides)
    return AnalysisOutput.model_validate(values)


def always_fail(code: str, *, retryable: bool) -> Callable[[AnalysisRequest], AnalysisOutput]:
    def behavior(_: AnalysisRequest) -> AnalysisOutput:
        raise AIProviderError(code, retryable=retryable)

    return behavior
