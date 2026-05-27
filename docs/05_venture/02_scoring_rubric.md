# 02 Scoring Rubric

## Scoring Model

Every dimension is scored from `1` to `5`.

- `1` = weak
- `3` = workable / mixed
- `5` = strong

Higher is always better.

## Weights

| Dimension | Weight |
| --- | ---: |
| Problem usefulness / urgency | 15 |
| Reachability of first users | 10 |
| Ease of first dollar | 20 |
| Ease of recurring income | 15 |
| Implementation ease | 10 |
| Operating cost efficiency | 10 |
| Data availability / reliability | 8 |
| South Africa local edge | 5 |
| Platform / regulatory safety | 3 |
| Stitchly leverage | 4 |

Total weight = `100`.

## Weight Intent

The weighting is intentionally not neutral.

It favors:

- fast first-dollar learning
- practical recurring revenue paths
- manageable implementation and operating burden

It does not favor theoretical market size by itself.

## Calculation

For each dimension:

`weighted_points = (score / 5) * weight`

Total idea score:

`total_score = sum(weighted_points)`

The final score is therefore on a `0-100` scale.

## Confidence

Every dimension must also have a confidence label:

- `high`
- `medium`
- `low`

Use confidence to show how trustworthy the score is, not how attractive the idea feels.

### Confidence guidance

- `high`
  Strong evidence exists already.
- `medium`
  Some evidence exists, but key assumptions remain.
- `low`
  Score is mostly inferred and needs validation.

### Overall confidence guidance

- `high`
  `0-1` low-confidence dimensions.
- `medium`
  `2-3` low-confidence dimensions.
- `low`
  More than `3` low-confidence dimensions, or one major unresolved blocker.

## Dimension Anchors

### 1. Problem usefulness / urgency

- `1`
  Nice-to-have problem with weak urgency.
- `3`
  Useful problem for a known segment, but not consistently urgent.
- `5`
  Painful, recurring, high-salience problem users already try to solve.

### 2. Reachability of first users

- `1`
  No obvious path to first users.
- `3`
  Reachable through effortful but realistic channels.
- `5`
  Clear, direct, inexpensive path to first users already exists.

### 3. Ease of first dollar

- `1`
  First revenue path is vague or distant.
- `3`
  There is a plausible first transaction path, but it needs setup or proof.
- `5`
  It is obvious how to charge early and test willingness to pay quickly.

### 4. Ease of recurring income

- `1`
  Revenue is likely one-off, ad hoc, or fragile.
- `3`
  Repeat usage exists but recurring revenue is not yet strong.
- `5`
  Strong path to subscriptions, repeat operational usage, or recurring contracts.

### 5. Implementation ease

- `1`
  Requires major unknown systems, heavy engineering, or hard integrations.
- `3`
  Moderate build difficulty with some unfamiliar parts.
- `5`
  Can be built leanly with current capability and low technical novelty.

### 6. Operating cost efficiency

- `1`
  Likely expensive to run, support, or maintain.
- `3`
  Costs are manageable but not trivial.
- `5`
  Low infrastructure and operational burden relative to likely value.

### 7. Data availability / reliability

- `1`
  Key data is inaccessible, unstable, or legally unclear.
- `3`
  Data exists, but quality, ownership, or freshness still needs proof.
- `5`
  Key data sources are clear, usable, and sustainable.

### 8. South Africa local edge

- `1`
  Little local advantage or local specificity.
- `3`
  Some relevance to the local economy or local context.
- `5`
  Strong local fit, local timing, and local defensibility.

### 9. Platform / regulatory safety

- `1`
  High risk around platform policy, compliance, or legal uncertainty.
- `3`
  Some manageable platform or regulatory constraints.
- `5`
  Low policy/regulatory risk and a clean operational path.

### 10. Stitchly leverage

- `1`
  Stitchly adds little structural advantage.
- `3`
  Stitchly helps with part of the product, but is not central.
- `5`
  Stitchly materially improves speed, automation, data handling, or operating leverage.

## Interpretation

The rubric is intentionally biased toward:

- fast validation
- fast first revenue
- manageable implementation
- practical local usefulness

It is not designed to maximize theoretical TAM.
