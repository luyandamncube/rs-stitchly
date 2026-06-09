# 21 Quality Check

Type: `surface-study`

Purpose:

- introduce the first concrete `quality_check` node study for post-merge validation
- separate “data landed” from “data is trusted enough to advance state”
- show how a validation gate hands off into `checkpoint_write`

What this sample is testing:

- a compact QA card with `Suite`, `Gate`, and `Last result`
- a config panel focused on validation presets, rule thresholds, and downstream gating behavior
- a more operator-facing review surface than the raw data movement nodes
- a clean handoff into checkpoint advancement only after the dataset passes

Still unresolved:

- whether the rule library should be preset-driven only or allow inline custom checks
- whether sample failing rows belong in the node body, a drawer, or a separate artifact viewer
- whether `warn` should be a first-class status or collapse into pass-with-notes
