# 00 Idea Framework

## Purpose

Create a repeatable operating system for deciding which ideas should be built next with Stitchly as the backbone.

This framework is designed for:

- fast comparison across very different ideas
- solo-founder decision making
- South Africa-aware opportunity selection
- ideas that may become public utility products, SaaS products, or business-OS modules

The framework is docs-first in v1. It should later be straightforward to convert this into a Stitchly workflow or template.

## Framework Priorities

The framework is intentionally optimized for:

- fast first-dollar learning
- practical recurring-income potential
- solo-founder decision quality
- South Africa-aware market selection
- ideas where Stitchly acts as a real backbone or business-operating layer

It should work for both:

- consumer or public utility products
- SaaS or business-OS products

## Core Outcome

Every idea should end with:

- a normalized idea record
- a weighted score
- a confidence-aware interpretation
- a deterministic recommendation
- one next concrete action

The framework should not produce raw scores without a recommendation.

## Standard Interfaces

The framework uses the same output shapes every time.

### Idea intake schema

- fixed headings only
- fixed heading order
- no free-form schema drift between ideas

### Scorecard schema

Each dimension must include:

- `score`
- `confidence`
- short `evidence note`

### Recommendation schema

Every scored idea must end with one of:

- `Build Now`
- `Validate First`
- `Incubate / Park`
- `Reject / Archive`

### Portfolio status schema

Every idea in the portfolio backlog must use one of:

- `raw_idea`
- `scoring`
- `validate_first`
- `build_now`
- `incubating`
- `live`
- `archived`

## Operating Loop

### 1. Capture

Record the idea in plain language before trying to optimize it.

The goal at this stage is not polish. The goal is to preserve the opportunity while it is still fresh.

### 2. Normalize

Convert the idea into the fixed schema from `01_idea_record_template.md`.

This prevents one idea from being well-documented and another from being vague but still compared side by side.

### 3. Score

Score the idea using `02_scoring_rubric.md`.

Rules:

- score every dimension from `1` to `5`
- higher is always better
- assign a confidence label to every score
- include a short evidence note for every score

### 4. Recommend

Use `03_recommendation_rules.md` to assign one of:

- `Build Now`
- `Validate First`
- `Incubate / Park`
- `Reject / Archive`

This step must follow the deterministic thresholds and gating rules rather than founder mood.

### 5. Define Next Action

Every evaluated idea should end with one immediate next action.

Examples:

- run 10 customer interviews
- prove a data source can be acquired reliably
- ship a clickable prototype
- launch a landing page and collect demand
- run a manual concierge test

### 6. Track Portfolio Status

Add or update the idea in `04_portfolio_backlog.md` with:

- latest score
- recommendation
- confidence
- portfolio status
- next action
- owner
- last reviewed date

## Where Stitchly Fits

Every idea should explicitly state Stitchly's role:

- `backbone`
- `etl_only`
- `business_os`
- `not_central`

This matters because some ideas are strongest when Stitchly is:

- the data pipeline layer
- the operator workflow layer
- both

The framework should reward ideas where Stitchly creates a structural advantage, not just incidental reuse.

## Decision Principles

When scores are close, prefer the idea that:

- gets to first dollar faster
- requires less new infrastructure
- has stronger local market pull
- has clearer data rights and source reliability
- gives Stitchly more reusable capability

Do not prefer an idea only because it sounds bigger.

When scores are close, do not let theoretical upside outrank:

- faster first revenue
- clearer acquisition
- cleaner data rights
- better operational leverage

## Anti-Patterns

Do not treat an idea as strong just because:

- it has a large theoretical market
- competitors already exist
- it feels socially useful
- it could become a platform later

These may be positives, but they do not replace:

- data access
- distribution
- monetization
- implementation feasibility

## Review Cadence

Recommended founder loop:

- capture ideas anytime
- normalize and score during a weekly review block
- revisit `Validate First` and `Incubate / Park` ideas monthly
- revisit `Build Now` ideas immediately after the current build slot opens

## Future Stitchly Translation

This docs framework is expected to become a future Stitchly artifact.

Likely later forms:

- idea intake workflow
- scorecard workflow
- portfolio tracker workflow
- validation experiment workflow

That future implementation is out of scope for v1, but this framework should be written with that eventual translation in mind.
