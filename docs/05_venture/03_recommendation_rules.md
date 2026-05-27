# 03 Recommendation Rules

## Deterministic Recommendation Bands

Use the final weighted score from `02_scoring_rubric.md`.

| Score band | Recommendation |
| --- | --- |
| `80-100` | `Build Now` |
| `65-79` | `Validate First` |
| `50-64` | `Incubate / Park` |
| `<50` | `Reject / Archive` |

## Gating Rules

Even if an idea scores highly, it must not move to `Build Now` if one of these is true:

- more than `3` dimensions are marked `low` confidence
- data source ownership is unclear
- the first acquisition path is unclear
- there is an unresolved legal or platform dependency

If any of those conditions apply, cap the recommendation at:

- `Validate First`

## Output Format

Every scored idea must end with this exact output structure:

### Weighted score

Numeric total on a `0-100` scale.

### Overall confidence

One of:

- `high`
- `medium`
- `low`

### Top 3 strengths

Three short bullets pulled from the strongest dimensions or strongest structural advantages.

### Top 3 risks

Three short bullets pulled from weak scores, low-confidence scores, or blocker conditions.

### Recommendation

One of:

- `Build Now`
- `Validate First`
- `Incubate / Park`
- `Reject / Archive`

### Next concrete action

Exactly one next action that reduces the highest uncertainty or unlocks the fastest commercial signal.

### Validation artifact

Choose one primary artifact:

- `landing_page`
- `customer_interviews`
- `data_source_proof`
- `prototype`
- `manual_concierge_test`

## Next-Action Mapping

Use the dominant unknown to choose the next action.

### If the biggest unknown is demand

Use:

- `landing_page`
- `customer_interviews`

### If the biggest unknown is data access or reliability

Use:

- `data_source_proof`

### If the biggest unknown is product interaction or workflow shape

Use:

- `prototype`

### If the biggest unknown is willingness to pay for operational value

Use:

- `manual_concierge_test`

## Status Mapping For Portfolio Tracking

Use these portfolio statuses:

| Recommendation | Default status |
| --- | --- |
| `Build Now` | `build_now` |
| `Validate First` | `validate_first` |
| `Incubate / Park` | `incubating` |
| `Reject / Archive` | `archived` |

Additional statuses that can appear earlier in the process:

- `raw_idea`
- `scoring`
- `live`

## Rule Intent

The point of these rules is to reduce founder drift.

If an idea feels exciting but the score and gates say `Validate First` or `Incubate / Park`, the framework should win unless a new decision is explicitly logged.
