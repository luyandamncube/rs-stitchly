# 19 Checkpoint Read

Type: `surface-study`

Purpose:

- introduce the first concrete `checkpoint_read` node study for recurring ingest workflows
- make the “previous successful commit” boundary visible and explicit
- show how checkpoint context feeds downstream `dolt_repo_sync`

What this sample is testing:

- a compact state-recovery card with `Scope`, `Fallback`, and `Last commit`
- a config panel focused on checkpoint lookup keys and emitted resume metadata
- a control-plane framing distinct from the raw data movement nodes
- a clean handoff into recurring repo sync and commit-range resolution

Still unresolved:

- whether repo-level and table-level checkpoint modes should be one node or two
- whether stale-checkpoint warnings belong in the card footer or the config panel
- whether bootstrap fallback should be represented as a dedicated badge on the node
