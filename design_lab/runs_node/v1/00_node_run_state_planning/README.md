# 00 Node Run State Planning

This study is the planning board for node-level runtime states.

Source of truth:

- [18_run_lifecycle_and_events.md](/home/mncubel/rs-stitchly/docs/00_foundation/18_run_lifecycle_and_events.md)
- [01_node_state_model.md](/home/mncubel/rs-stitchly/docs/03_ui/01_node_state_model.md)
- [api_contract/src/lib.rs](/home/mncubel/rs-stitchly/crates/api_contract/src/lib.rs)

Canonical node run states:

- `pending`
- `ready`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `cancelling`
- `cancelled`
- `retrying`

Important distinction:

- these are node-level runtime states
- they are not the same thing as top-level workflow run states like `planning` or `queued`

Why this separate lab exists:

- the workflow run surface answers "what is the whole workflow doing?"
- the node run surface answers "what is this specific node doing inside that run?"

Recommended first design order:

1. `pending` + `ready`
2. `running`
3. `succeeded`
4. `failed`
5. `skipped`
6. `retrying`
7. `cancelling` + `cancelled`

Questions to decide before styling:

- should `pending` and `ready` look clearly distinct or just subtly different?
- should `retrying` feel closer to `running` or closer to `failed`?
- should `cancelled` inherit more from `skipped` or from `failed`?
- how much state should live in the whole node card versus only handles, edges, and small accents?
