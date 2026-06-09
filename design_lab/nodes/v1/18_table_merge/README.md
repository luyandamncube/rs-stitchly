# 18 Table Merge

Type: `surface-study`

Purpose:

- create the first concrete `table_merge` node study in the design lab
- define how raw or delta landing tables reconcile into durable normalized
  workflow-owned tables
- review the compact merge card together with its config panel

What this sample is testing:

- a compact reconcile card for durable table policy
- a summary shell centered on `Policy`, `Key`, and durable target
- an explicit input/output contract between `load_to_duckdb` and durable `tables`
- a config panel focused on write policy, merge key, delete handling, and
  schema drift behavior
- a clear boundary between raw landing and published outputs

Still unresolved:

- whether `merge key` needs more structured UI than a pill summary
- whether delete handling should be hidden when policy is `append_only`
- whether schema-drift behavior belongs in the base config or advanced mode
- whether multi-table merge should show one policy card per resolved table family
