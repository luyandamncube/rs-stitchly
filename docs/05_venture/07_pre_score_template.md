# 07 Pre-Score Template

## Purpose

Filter candidate ideas quickly before doing a full rubric pass.

This is the lightweight gate between:

- raw signals
- full idea records

Use it when:

- one signal produced multiple variants
- many raw ideas need quick comparison
- a candidate is still too early for full documentation

## Pre-Score Dimensions

Use a reduced subset of the full rubric.

| Dimension | Weight |
| --- | ---: |
| Problem usefulness / urgency | 20 |
| Reachability of first users | 15 |
| Ease of first dollar | 25 |
| Data availability / reliability | 20 |
| Implementation ease | 10 |
| Stitchly leverage | 10 |

Total weight = `100`.

## Calculation

For each dimension:

`weighted_points = (score / 5) * weight`

Pre-score total:

`pre_score = sum(weighted_points)`

## Confidence

Use the same labels as the full framework:

- `low`
- `medium`
- `high`

If more than `2` dimensions are `low` confidence, treat the result as provisional even if the total is strong.

## Promotion Rules

| Pre-score band | Default action |
| --- | --- |
| `75-100` | `Promote to full scoring` |
| `60-74` | `Keep in candidate queue` |
| `<60` | `Park or discard` |

## Hard Stops

Do not promote yet if one of these is true:

- the user is still vague
- the first-user acquisition path is still vague
- the data path is clearly weak or unowned
- the product only sounds attractive after many future assumptions

## Template

```md
# Candidate Idea Variant

## Source signal

## Candidate shape

## Why this variant exists

## Pre-score

| Dimension | Weight | Score (1-5) | Confidence | Evidence note |
| --- | ---: | ---: | --- | --- |
| Problem usefulness / urgency | 20 |  |  |  |
| Reachability of first users | 15 |  |  |  |
| Ease of first dollar | 25 |  |  |  |
| Data availability / reliability | 20 |  |  |  |
| Implementation ease | 10 |  |  |  |
| Stitchly leverage | 10 |  |  |  |

## Pre-score total

## Decision
One of:
- promote_to_full_scoring
- keep_in_candidate_queue
- park_or_discard

## Next action
```

## Usage Notes

- this is a filter, not a replacement for the full rubric
- keep notes short and evidence-based
- if two variants score similarly, prefer the one with:
  - clearer monetization
  - better data path
  - stronger Stitchly leverage
  - lower delivery burden

## Working Rule

It is better to discard ten weak ideas cheaply here than to fully document them and create false momentum.
