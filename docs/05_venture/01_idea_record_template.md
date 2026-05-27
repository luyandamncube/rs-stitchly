# 01 Idea Record Template

Use this exact schema for every new idea.

The order should not change. Headings should not be added or removed unless the framework itself is revised.

This template exists to stop well-written ideas from getting an unfair advantage over vague but possibly stronger opportunities.

## Template

```md
# Idea Name

## 1. Core Record

### One-line thesis

### Target user

### Geography / market

### Customer type
One of:
- consumer
- smb
- internal_ops
- hybrid

### Product surface
Choose the primary surface:
- web
- mobile_web
- native_mobile
- map_first
- utility
- workflow_backed_saas

## 2. Problem

### Core user problem

### Why now

## 3. Delivery Model

### Data dependencies

### Likely business model

### First acquisition channel

### Likely Stitchly role
One of:
- backbone
- etl_only
- business_os
- not_central

## 4. Risks

### Main risks

### Open unknowns

## 5. Scorecard

| Dimension | Weight | Score (1-5) | Confidence | Evidence note |
| --- | ---: | ---: | --- | --- |
| Problem usefulness / urgency | 15 |  |  |  |
| Reachability of first users | 10 |  |  |  |
| Ease of first dollar | 20 |  |  |  |
| Ease of recurring income | 15 |  |  |  |
| Implementation ease | 10 |  |  |  |
| Operating cost efficiency | 10 |  |  |  |
| Data availability / reliability | 8 |  |  |  |
| South Africa local edge | 5 |  |  |  |
| Platform / regulatory safety | 3 |  |  |  |
| Stitchly leverage | 4 |  |  |  |

## 6. Evaluation Output

### Weighted score

### Overall confidence

### Top 3 strengths

### Top 3 risks

### Recommendation
One of:
- Build Now
- Validate First
- Incubate / Park
- Reject / Archive

### Next concrete action

### Validation artifact
Choose the primary artifact:
- landing_page
- customer_interviews
- data_source_proof
- prototype
- manual_concierge_test
```

## Usage Notes

- keep the heading order exactly as written
- do not add custom sections to only one idea
- `Score (1-5)` must use the anchors from `02_scoring_rubric.md`.
- `Confidence` must be one of:
  - `low`
  - `medium`
  - `high`
- `Weighted score` should be calculated using the formula in `02_scoring_rubric.md`.
- `Recommendation` must follow `03_recommendation_rules.md`.

## Normalization Rule

If an idea is too fuzzy to complete this template, that is a signal.

Do not skip missing sections. Record the unknowns explicitly and let the confidence and recommendation reflect that uncertainty.
