# 16 Dolt Diff Export

Type: `surface-study`

Purpose:

- create the first concrete `dolt_diff_export` node study in the design lab
- define how row-level Dolt delta export should read before delta-aware DuckDB
  load and merge nodes exist in the real app
- review the compact diff-export card together with its config panel

What this sample is testing:

- a compact delta-export card for commit-range-specific artifact creation
- a summary shell centered on `Range`, `Filter`, and `Bundle`
- a config panel focused on change filters, file format, and delete handling
- a clear boundary between diff export and merge policy

Still unresolved:

- whether delete handling should be visible in the base card or manager only
- whether row-level diff export is a first-wave feature or a later optimization
- whether the diff bundle should display table counts or operation counts first

