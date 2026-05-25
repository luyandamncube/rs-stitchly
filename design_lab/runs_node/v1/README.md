# Runs Node Lab · V1

This folder holds the first design pass for node-level runtime states.

Source of truth for state modeling:

- [18_run_lifecycle_and_events.md](/home/mncubel/rs-stitchly/docs/00_foundation/18_run_lifecycle_and_events.md)
- [01_node_state_model.md](/home/mncubel/rs-stitchly/docs/03_ui/01_node_state_model.md)
- [api_contract/src/lib.rs](/home/mncubel/rs-stitchly/crates/api_contract/src/lib.rs)

Current studies:

- `00_node_run_state_planning/`
  Planning board for canonical node run states and recommended design order.
- `01_pending/`
  First-pass muted blocked state for nodes that belong to the run but are not yet unblocked.
- `02_ready/`
  First-pass unblocked state for nodes that are eligible to execute next.
- `03_running/`
  First-pass live execution state for the currently active node.
- `04_succeeded/`
  First-pass calm terminal success state for completed nodes.
- `05_failed/`
  First-pass terminal failure state for the node that broke the run.
- `06_skipped/`
  First-pass intentional bypass state for nodes that did not execute.
- `07_retrying/`
  First-pass recovery state for nodes between failed attempts.
- `08_cancelling/`
  First-pass interruption-in-progress state for nodes stopping cooperatively.
- `09_cancelled/`
  First-pass calm terminal interruption state after cancellation completes.

Recommended first design order:

- `01_pending/`
- `02_ready/`
- `03_running/`
- `04_succeeded/`
- `05_failed/`
- `06_skipped/`
- `07_retrying/`
- `08_cancelling/`
- `09_cancelled/`

Why this order:

- `pending` gives us the blocked pre-execution baseline
- `ready` can then become the more alert sibling without inventing a new family
- `running`, `succeeded`, and `failed` are the core everyday states
- `skipped` and `retrying` add important nuance after the core family is stable
- `cancelling` and `cancelled` are interruption states best designed last
