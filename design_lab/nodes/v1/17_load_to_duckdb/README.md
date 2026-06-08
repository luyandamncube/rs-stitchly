# 17 Load To DuckDB

Type: `surface-study`

Purpose:

- create the first concrete `load_to_duckdb` node study in the design lab
- define how Dolt artifact bundles should land into workflow-local DuckDB
  staging tables
- review the compact load card together with its config panel

What this sample is testing:

- a compact landing card for raw-batch DuckDB ingest
- a summary shell centered on `Target`, `Batch mode`, and stamped metadata
- a config panel focused on target schema, table mapping, inference, and
  metadata stamping
- a clear boundary between landing and durable merge policy

Still unresolved:

- whether table mapping deserves more visibility on the card itself
- whether metadata stamping should be configurable per column or offered as
  preset packs first
- how much file-format-specific detail belongs in the base panel

