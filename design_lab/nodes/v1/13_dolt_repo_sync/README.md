# 13 Dolt Repo Sync

Type: `surface-study`

Purpose:

- create the first concrete `dolt_repo_sync` node study in the design lab
- define how recurring Dolt sync should read before change-manifest and diff
  export nodes exist in the real app
- review the compact sync card together with its config panel
- pressure-test whether sync should surface commit ranges directly on the card

What this sample is testing:

- a compact commit-range card for a reused working copy
- a summary shell centered on `From`, `To`, and `Sync action`
- a config panel focused on repo ref input, sync action, branch guard, and
  dirty working-copy policy
- a clear boundary between repo sync and change detection
- a runtime-owned checkpoint model where previous commit state is not manually
  entered into node config

Still unresolved:

- whether `no change` runs should emit an identical `from -> to` range or a
  more explicit no-op flag
- whether recovery-only ref overrides belong here or should live in a separate
  maintenance workflow pattern
