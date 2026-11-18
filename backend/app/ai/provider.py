"""Provider-independent AI analysis interface (LS-11, LS-12; SDD §5.3, OQ-03).

Everything outside `app/ai/` talks to the AI service only through
`AIProvider`. Switching providers means writing another class with the same
`analyze` method and selecting it in `app.ai.get_provider`; nothing else in
the backend changes.

AI output is advisory (RC-02, RC-03). A provider never changes a report: it
returns a suggestion that the backend validates and stores for staff review.
The structured result every provider must return is `AnalysisOutput`; it is
documented field by field in docs/AI-Analysis-Schema.md.
"""

from dataclasses import dataclass
from typing import Literal, Protocol, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

# The prompt asks for under 30 words; this hard cap only rejects runaway output.
MAX_SUMMARY_LENGTH = 500
MAX_DETAILS = 5
MAX_DETAIL_LENGTH = 200
MAX_REASON_LENGTH = 300

Priority = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class CategoryOption:
    """An active, administrator-configured category offered to the AI (LS-05)."""

    id: UUID
    name: str
    description: str | None


@dataclass(frozen=True)
class AnalysisRequest:
    """The only report content sent to an AI provider.

    No student identity is included: just the photo (re-encoded without its
    metadata), the student's optional note, the campus location name, and the
    list of categories the AI may choose from.
    """

    image: bytes
    image_media_type: str
    note: str | None
    location_name: str
    categories: tuple[CategoryOption, ...] = ()


class AnalysisOutput(BaseModel):
    """The structured result of one analysis (LS-12).

    Every field is required. A provider's response that does not match this
    exactly (missing or extra fields, wrong types, out-of-range values, or
    inconsistent uncertainty) is rejected and the analysis is recorded as
    failed; it is never stored as a valid result.
    """

    # Strict: no type coercion (for example "yes" is not accepted as true).
    model_config = ConfigDict(extra="forbid", strict=True)

    # Name of one of the offered categories, or null when none fits.
    category: str | None
    # One short sentence for staff.
    summary: str = Field(min_length=1, max_length=MAX_SUMMARY_LENGTH)
    # Key visible facts about the issue, most important first.
    details: list[str] = Field(max_length=MAX_DETAILS)
    priority: Priority
    potential_safety_hazard: bool
    # The AI's own confidence in its category, from 0 to 1.
    confidence: float = Field(ge=0, le=1)
    uncertain: bool
    uncertainty_reason: str | None = Field(max_length=MAX_REASON_LENGTH)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        self.summary = self.summary.strip()
        self.details = [item.strip() for item in self.details if item.strip()]
        if not self.summary:
            raise ValueError("summary is blank")
        if any(len(item) > MAX_DETAIL_LENGTH for item in self.details):
            raise ValueError("a detail is too long")
        if self.category is None and not self.uncertain:
            # "No category fits" is itself uncertainty and must be flagged (RC-02).
            raise ValueError("no category given but not marked uncertain")
        reason = (self.uncertainty_reason or "").strip() or None
        if self.uncertain and reason is None:
            raise ValueError("uncertain result without a reason")
        self.uncertainty_reason = reason if self.uncertain else None
        return self


def output_json_schema(category_names: list[str]) -> dict[str, object]:
    """JSON Schema a provider must follow, with the category constrained to the offered list."""
    category: dict[str, object] = (
        {"anyOf": [{"type": "string", "enum": category_names}, {"type": "null"}]}
        if category_names
        else {"type": "null"}
    )
    return {
        "type": "object",
        "properties": {
            "category": category,
            "summary": {"type": "string"},
            "details": {"type": "array", "items": {"type": "string"}},
            "priority": {"type": "string", "enum": ["low", "medium", "high"]},
            "potential_safety_hazard": {"type": "boolean"},
            "confidence": {"type": "number"},
            "uncertain": {"type": "boolean"},
            "uncertainty_reason": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        },
        "required": [
            "category",
            "summary",
            "details",
            "priority",
            "potential_safety_hazard",
            "confidence",
            "uncertain",
            "uncertainty_reason",
        ],
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
