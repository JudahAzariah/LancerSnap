"""Provider-independent AI analysis interface (LS-11; SDD §5.3, OQ-03).

Everything outside `app/ai/` talks to the AI service only through
`AIProvider`. Switching providers means writing another class with the same
`analyze` method and selecting it in `app.ai.get_provider`; nothing else in
the backend changes.

AI output is advisory (RC-02, RC-03). A provider never changes a report: it
returns a suggestion that the backend validates and stores for staff review.
"""

from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

# The prompt asks for under 30 words; this hard cap only rejects runaway output.
MAX_SUMMARY_LENGTH = 500


@dataclass(frozen=True)
class AnalysisRequest:
    """The only report content sent to an AI provider.

    No student identity is included: just the photo (re-encoded without its
    metadata), the student's optional note, and the campus location name.
    """

    image: bytes
    image_media_type: str
    note: str | None
    location_name: str


class AnalysisOutput(BaseModel):
    """The validated structured result of one analysis.

    LS-11 establishes the integration with a one-line summary. The full
    classification schema (category, priority, uncertainty) is defined in LS-12.
    """

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=MAX_SUMMARY_LENGTH)


# JSON Schema the provider must follow. Kept beside the model it mirrors.
OUTPUT_JSON_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}


def parse_output(raw: str) -> AnalysisOutput:
    """Validate provider JSON against the application schema."""
    try:
        return AnalysisOutput.model_validate_json(raw)
    except ValidationError as error:
        raise AIProviderError("invalid_response", retryable=False) from error


class AIProviderError(Exception):
    """An analysis attempt failed.

    `code` is a short, non-sensitive reason that is safe to store and show to
    staff. `retryable` says whether trying again could succeed (timeouts,
    overload, rate limits) or not (bad configuration, a declined request).
    """

    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class AIProvider(Protocol):
    @property
    def name(self) -> str:
        """Provider identifier stored with each analysis (e.g. "anthropic")."""
        ...

    @property
    def model(self) -> str:
        """Model identifier stored with each analysis."""
        ...

    def analyze(self, request: AnalysisRequest) -> AnalysisOutput:
        """Run one analysis attempt. Raises AIProviderError on any failure."""
        ...
