# Runs Lab · V1

This folder holds the first design pass for Stitchly workflow runs.

Source of truth for state modeling:

- [18_run_lifecycle_and_events.md](/home/mncubel/rs-stitchly/docs/00_foundation/18_run_lifecycle_and_events.md)
- [api_contract/src/lib.rs](/home/mncubel/rs-stitchly/crates/api_contract/src/lib.rs)

Current studies:

- `00_run_state_planning/`
  Planning board for canonical workflow run states and recommended design order.
- `01_created_and_queued/`
  Early workflow run states and their shared preflight family.
- `02_planning/`
  Workflow preparation state before active node execution begins.
- `03_running/`
  Primary active execution state with live node and log context.
- `04_succeeded/`
  Calm terminal success state with outputs and rerun actions.
- `05_failed/`
  Terminal error state with diagnosis and retry emphasis.
- `06_cancelling_and_cancelled/`
  Interruption states, split into active cancelling and terminal cancelled.

Recommended study order after planning:

- `01_created_and_queued/`
- `02_planning/`
- `03_running/`
- `04_succeeded/`
- `05_failed/`
- `06_cancelling_and_cancelled/`

Why this order:

- `created` and `queued` can share an early/preflight family
- `planning` deserves its own pass because it can fail before active execution
- `running`, `succeeded`, and `failed` are the core everyday states
- `cancelling` and `cancelled` are important but less frequent terminal/interruption states
