# LancerSnap — AI Analysis Schema

The structured result of an AI analysis of a report (LS-12). It is defined in
code by `AnalysisOutput` in `backend/app/ai/provider.py`; this page explains it
for the routing engine (LS-16), manual review (LS-17), and the staff UI (LS-19).

**Everything here is advisory** (RC-02, RC-03). An analysis never changes a
report's status, category, or team by itself. Staff confirm or correct it.

## Fields

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `category` | category name, or `null` | The suggested category. Always one of the **active** categories configured by administrators (LS-05). `null` means no category fits, and the result is then always marked uncertain. |
| `summary` | text, 1–500 characters | One short, neutral sentence about the issue, for staff. |
| `details` | list of 0–5 texts, each up to 200 characters | Key facts visible in the photo or stated in the note, most important first. |
| `priority` | `low`, `medium`, or `high` | Suggested priority. A recommendation only (LS-14 adds the conservative rules). |
| `potential_safety_hazard` | true / false | Whether the issue could hurt someone. |
| `confidence` | number from 0 to 1 | The AI's own confidence in its category. Stored to 3 decimal places. |
| `uncertain` | true / false | The result should not be relied on without a closer human look (RC-02). |
| `uncertainty_reason` | text up to 300 characters, or `null` | Why it is uncertain. Required when `uncertain` is true; always `null` otherwise. |

## Validation rules

A provider's response is accepted only if all of these hold. Otherwise the
analysis is recorded as **failed** and stores no suggestion at all.

- It is a JSON object with exactly the fields above: none missing, none extra.
- Every value has the stated type, with no conversion (`"yes"` is not `true`,
  `"0.8"` is not a number).
- Values are within the stated ranges and lengths. The summary is not blank.
- The category is one that was offered: active at the time of analysis. An
  unknown or deactivated category fails with `unsupported_category`. This check
  is made by the backend itself, outside any provider adapter.
- No category (`null`) is only allowed together with `uncertain: true`.
- `uncertain: true` needs a non-blank `uncertainty_reason`.

The category list is also sent to the provider as a constraint on its output,
but the backend never relies on the provider having followed it.

## Conservative rules applied before storing (LS-14)

After validation, and outside any provider adapter, the backend applies two
rules (`apply_safety_rules()` in `backend/app/analysis.py`):

1. **A potential safety hazard is always `high` priority** (RC-07, RISK-04).
   The AI cannot suggest a lower priority for something that could hurt
   someone; it can only raise priorities.
2. **Low confidence is always uncertain** (RC-02). A result with `confidence`
   below `AI_CONFIDENCE_THRESHOLD` (default `0.6`) is marked uncertain with the
   reason "Low AI confidence (…); a person should check the category.", unless
   the AI already gave its own reason. The confidence value itself is kept.
   The threshold is an implementation choice, not an SDD value; tune it from
   real use.

The result stays a recommendation. Nothing acts on it automatically: the
report's status, team, assignee, and category are unchanged; no notification
or status change is created; and LancerSnap never contacts emergency services
(RC-03, RC-08).

## How staff see it

Staff on the report's team and administrators see an **AI analysis
(suggestion only)** panel on the report details screen. Every state is written
in words with a symbol, never by color alone (RC-11):

- `▲ High priority (suggested)`, `■ Medium priority (suggested)`, `▼ Low priority (suggested)`
- `⚠ Potential safety hazard: needs human attention`, with the reminder that
  LancerSnap does not contact emergency services
- `? Uncertain result`, with the reason, and the AI confidence as a percentage
- `✕ AI analysis failed` with the reason in plain words, stating that no
  priority or category was suggested, so a failure is never read as "no
  priority" (RC-10)
- `… AI analysis in progress` and `○ Not analyzed by AI`

Students see only the category (below).

## Where results are stored

Each attempt is one row in `ai_analyses` (see [Database-Schema.md](Database-Schema.md)).

| `ai_analyses` column | Field |
| :--- | :--- |
| `suggested_category_id` | `category`, as the category's id |
| `summary` | `summary` |
| `details` | `details` (JSON array) |
| `suggested_priority` | `priority` |
| `is_potential_safety_hazard` | `potential_safety_hazard` |
| `confidence` | `confidence` |
| `is_uncertain` | `uncertain` |
| `uncertainty_reason` | `uncertainty_reason` |
| `processing_status` | `pending`, `succeeded`, or `failed` |
| `error_message` | short failure reason, only when `failed` |
| `provider`, `model` | which service produced it |

Failure reasons: `timeout`, `unavailable`, `rate_limited`, `not_authorized`,
`rejected`, `declined`, `invalid_response`, `unsupported_category`,
`unsupported_image`, `photo_missing`, `photo_unavailable`.

## Reading results

- **Backend logic (routing, LS-16) uses only `latest_validated_analysis()`** in
  `backend/app/analysis.py`. It returns the newest *succeeded, complete* result
  for a report, or nothing. Pending and failed attempts never reach it. Neither
  do summary-only rows from before this schema.
- **Staff and administrators** read the newest attempt, whatever its status,
  through `GET /reports/{id}/analysis`. Failures stay visible there, so a failed
  analysis is never mistaken for "no suggestion". The response has the fields
  above, with `category` as `{id, name}`, plus `processing_status`, `error`,
  `provider`, `model`, `created_at`, and `completed_at`.
- **Students** see only the category, in their report details
  (`GET /reports/{id}`, field `category`): `{name, source, uncertain}`.
  `source` is `staff` when staff confirmed the category, otherwise
  `ai_suggestion`, taken from `latest_validated_analysis()`. The app always
  labels an AI suggestion in words ("AI suggestion … Campus staff will confirm
  or change it"), and says when the AI was not sure. A category on the report
  that staff have not confirmed is never shown as confirmed. Students never see
  the priority, hazard flag, confidence, or details.

## Privacy rule for the prompt

The request contains only the photo (re-encoded without metadata), the note,
the location name, and the category list. The prompt tells the model never to
identify anyone: no faces, appearance, clothing, or identity, and no names, ID
cards, screens, or licence plates; a person who matters to the issue is just
"a person" (SDD §2.4).
