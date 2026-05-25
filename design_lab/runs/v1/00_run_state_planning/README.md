# 00 Run State Planning

This study is not a final run UI. It is a planning board for the canonical
workflow run states we should design next.

Source of truth:

- [18_run_lifecycle_and_events.md](/home/mncubel/rs-stitchly/docs/00_foundation/18_run_lifecycle_and_events.md)
- [api_contract/src/lib.rs](/home/mncubel/rs-stitchly/crates/api_contract/src/lib.rs)

Canonical workflow run states:

- `created`
- `queued`
- `planning`
- `running`
- `succeeded`
- `failed`
- `cancelling`
- `cancelled`

Important notes from the current docs and contract:

- `queued` may be optional in the earliest local-only runtime, but the model should still allow it
- `planning` should remain visible, because setup or validation can fail before active execution
- `cancelling` is distinct from `cancelled`, because interruption is not always instant

What is not a top-level workflow run state:

- `pending`
- `ready`
- `skipped`
- `retrying`

Those are real runtime states, but they belong to node runs and run-detail
surfaces more than the top-level workflow run summary.

Recommended first design order:

1. `created` + `queued`
2. `planning`
3. `running`
4. `succeeded`
5. `failed`
6. `cancelling` + `cancelled`

Why this order:

- it lets us define the preflight family first
- it treats `planning` as a distinct state instead of hiding it inside `running`
- it covers the core everyday lifecycle before designing interruption edge cases

Questions to decide before visual design:

- should `created` and `queued` look nearly identical or clearly distinct?
- should `planning` feel calmer and more technical than `running`?
- should `cancelled` inherit more from `failed` or from a neutral interrupted state?
- do we want retry-aware workflow surfaces later, or only node-level retry surfaces?
