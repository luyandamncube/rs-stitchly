# 12 Dolt Repo Source

Type: `surface-study`

Purpose:

- create the first concrete `dolt_repo_source` node study in the design lab
- define how a repo-aware Dolt source should read before `dolt_dump` and
  DuckDB load nodes exist in the real app
- review the compact source card together with its config panel before
  implementation starts
- pressure-test where repo identity ends and export behavior begins

What this sample is testing:

- a compact source-first card for `post-no-preference/earnings`
- single right-side output handle that emits repo metadata rather than table
  files directly
- a summary shell centered on `Repo`, `Branch`, and `Current commit`
- a config panel focused on connection ref, repo path, branch, clone mode,
  sync strategy, and table discovery
- a clear boundary between `dolt_repo_source` and downstream `dolt_dump`
- whether the current synced commit should be visible on the card or stay
  manager-only

Reference direction:

- node shell stays inside the shared `nodes/v1` card language
- manager panel takes layout and density cues from the recent
  table-oriented node studies
- the node is source-oriented and repo-aware, not yet artifact-oriented

Still unresolved:

- whether `checkout ref override` should be a free text field or a later
  advanced setting
- whether `table discovery` belongs on the source node or should first appear
  on `dolt_dump`
- whether checkpoint state should remain runtime-owned until a dedicated
  checkpoint node exists
- whether the node title should stay `Dolt Repo` or be more explicit as
  `Dolt Repo Source`

Shared styling:

- the node card uses `../shared.css`
- this study includes a small local stage and panel override inside
  `index.html`, because it reviews node-manager context rather than only the
  isolated card

Review questions:

- does the card clearly read as a repo source rather than a raw file source?
- is `Repo / Branch / Current commit` the right compact abstraction for the
  first pass?
- does the panel keep a clean boundary between source ownership and export
  behavior?
- does the downstream pairing with `dolt_dump` feel legible enough for the
  full Dolt ingest chain?
