# 22 SQL Transform

Type: `surface-study`

Purpose:

- create the first concrete `sql_transform` node study in the design lab
- define how raw staged tables become merge-ready normalized tables before
  durable reconcile
- review a code-oriented compute card together with its config panel

What this sample is testing:

- a compute card that sits explicitly between `load_to_duckdb` and `table_merge`
- a summary shell centered on `Engine`, `Mode`, and normalized output shape
- a config panel focused on source table selection, SQL authoring, target
  materialization, and output aliasing
- a clear boundary where wide/raw staging can be reshaped without hiding the
  original landed data

Still unresolved:

- whether transformed tables should default to `staging_curated`,
  `intermediate`, or another workflow-local schema
- whether `sql_transform` should start with one inline statement only or allow
  named multi-step transform packs
- whether the panel should show an inline schema diff before execution
- whether reusable transform presets should be first-class alongside raw SQL
