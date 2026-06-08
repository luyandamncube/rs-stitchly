# 15 Dolt Dump

Type: `surface-study`

Purpose:

- create the first concrete `dolt_dump` node study in the design lab
- define how Dolt table export should read before the real load node exists
- review the compact export card together with its config panel

What this sample is testing:

- a compact export card for bundle-oriented artifact creation
- a summary shell centered on `Format`, `Tables`, and `Bundle`
- a config panel focused on export format, table selection, and artifact
  retention
- a clear boundary between export and DuckDB load behavior

Still unresolved:

- whether `artifact retention` should be node-local or workflow-default first
- whether table selection should always accept a manifest input or also allow
  direct manual scoping
- whether the footer should show a bundle path hint or stay abstract as
  `directory_ref`

