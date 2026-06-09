# 17 Load To DuckDB

Type: `surface-study`

Purpose:

- create the first concrete `load_to_duckdb` node study in the design lab
- define how `dolt_dump` and `dolt_diff_export` bundles should land into
  workflow-local DuckDB staging tables
- review the compact load card together with its config panel

What this sample is testing:

- a compact landing card for bundle-aware DuckDB ingest
- a summary shell centered on `Target`, `Bundle mode`, and merge context
- a config panel focused on bundle detection, staging mapping, bootstrap vs
  recurring schema handling, and metadata stamping
- a clear boundary between landing and durable merge policy

Still unresolved:

- whether bundle-aware staging naming should be fixed or user-configurable
- whether metadata stamping should be configurable per column or offered as
  preset packs first
- whether `load_manifest_ref` should be a first-class output or remain
  metadata attached to the staged table refs
