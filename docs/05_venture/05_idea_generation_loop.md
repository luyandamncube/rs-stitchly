# 05 Idea Generation Loop

## Purpose

Define a repeatable method for finding new ideas instead of waiting for inspiration.

This layer sits before the full scoring framework. Its job is to turn raw signals into a shortlist of candidate ideas that are strong enough to justify full evaluation.

## Core Output

A sourcing session should end with:

- a list of raw signals
- `3-5` candidate idea variants per strong signal
- a pre-score for each promising variant
- a shortlist promoted to full scoring

The loop should create options, not just opinions.

## Operating Loop

### 1. Collect Source Signals

Look for recurring pain, broken workflows, and data-rich inefficiencies.

Typical signals:

- people repeatedly checking the same information manually
- people coordinating through WhatsApp, spreadsheets, or screenshots
- public notices that are hard to interpret
- high-friction local consumer comparisons
- internal business tasks that require many human handoffs
- existing products with obvious complaint patterns

Use `06_idea_source_catalog.md` as the main discovery menu.

### 2. Write The Signal Down Clearly

Capture the signal in one sentence.

Format:

- `who is struggling`
- `what task or problem keeps recurring`
- `why the current workaround is poor`

Example:

- residents repeatedly rely on fragmented community messages to understand outages
- operators manually reconcile inbound leads from WhatsApp into spreadsheets
- consumers compare prices informally because retailer price visibility is weak

### 3. Generate Idea Variants

From each strong signal, generate multiple product shapes instead of committing to the first one.

Default variant lenses:

- consumer utility
- SMB workflow tool
- operator dashboard
- alerting / monitoring product
- Stitchly-backed SaaS
- internal business-OS module

Example:

One signal:
- small operators lose track of inbound WhatsApp requests

Possible variants:
- consumer-facing request tracker
- SMB lead inbox for WhatsApp
- internal follow-up workflow tool
- Stitchly-backed intake and routing OS

### 4. Pre-Score The Best Variants

Use `07_pre_score_template.md`.

Do not full-score every idea. Pre-score first to remove weak candidates cheaply.

### 5. Promote Only The Best Candidates

Promote only variants that are:

- practically useful
- plausible to monetize
- reachable through a real acquisition path
- supported by a believable data path
- strong enough to justify full normalization and scoring

### 6. Move To Full Evaluation

For promoted candidates:

- create a full record using `01_idea_record_template.md`
- score with `02_scoring_rubric.md`
- assign a recommendation with `03_recommendation_rules.md`
- add or update the row in `04_portfolio_backlog.md`

## Search Mode

This framework can be used with live research as well as internal observation.

When browsing or searching externally, prefer:

- current public pain
- recent policy or infrastructure changes
- popular complaints about incumbent tools
- evidence of recurring manual workaround behavior

If the topic is time-sensitive or the market may have shifted, current browsing is preferred before scoring.

## Session Structure

A good sourcing session is:

1. `30-45 min` signal collection
2. `15-30 min` variant generation
3. `15-30 min` pre-scoring
4. promote the top `1-3` ideas only

This helps avoid turning one good signal into too much speculative documentation.

## Selection Rules

Prefer signals where at least two of these are true:

- the pain is recurring
- people already use ugly workarounds
- there is a visible local market angle
- the data path is plausible
- Stitchly can create a real operational advantage

Avoid promoting signals where:

- the user is vague
- the data path is unclear
- monetization is purely wishful
- the product depends on many unresolved external actors

## Deliverables From One Session

Minimum output:

- `5-10` raw signals
- `3-6` promising candidate variants
- `1-3` promoted ideas for full scoring

If a session produces many vague candidates and no promotions, that is still useful. It means the sourcing net is working and weak ideas are being filtered early.
