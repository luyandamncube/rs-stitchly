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
- a summary shell centered on `From`, `To`, and `Sync mode`
- a config panel focused on repo ref input, sync strategy, branch guard, and
  dirty working-copy policy
- a clear boundary between repo sync and change detection

Still unresolved:

- whether sync should expose a manual ref override for recovery workflows
- whether the `dirty working copy` policy belongs in basic config or advanced
  config only
- whether the card needs to show both commits or only the latest synced commit

