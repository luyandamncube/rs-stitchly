# 11 Table Schema

Type: `surface-study`

Purpose:

- refine the original `input_schema` concept into a clearer DuckDB-oriented
  table-definition node
- explore a node that can define a blank local table shape before rows are
  written
- test a wider manager-panel pattern for schema-authoring work rather than a
  narrow form-only inspector
- review whether `table_schema -> table_output` feels like a clear first
  workflow for table bootstrapping

What this sample is testing:

- a compact source node that summarizes target table, column shape, and draft
  readiness
- a linked triple-panel manager:
  panel 1 for raw JSON text
  panel 2 for structured JSON editing
  panel 3 for node-level config
- a synchronized editing model where text and structured JSON stay in step
- a DuckDB-friendly contract centered on `schema`, `table`, `columns`,
  `nullable`, `default`, `primary_key`, and optional `checks`
- shared execution timing controls for the new node family
- how much width the selected-node manager should claim when the main task is
  authoring structure, not just changing a few scalar fields

Reference direction:

- panel framing and density still follow the darker
  `design_lab/canvas/02_node_management_panel` family
- the JSON text/tree split borrows the idea from the attached reference, but is
  restyled into Stitchly's darker utility-first language
- the compact node shell stays aligned with the current `nodes/v1` card family

Still unresolved:

- whether the product-facing name should stay `input_schema` for continuity or
  move fully to `table_schema`
- whether the node should emit only structured table-definition metadata or also
  expose generated SQL for downstream inspection
- whether the structured JSON editor should allow type changes inline or use a
  secondary drawer
- whether `table_output` should consume the schema automatically or require an
  explicit "bootstrap target" mode
- whether schema diffs should be previewed visually before a downstream table is
  recreated or replaced

Shared styling:

- the study uses `../shared.css` for the common node language
- the larger schema-studio layout is handled with local overrides inside
  `index.html`, because this review is primarily about the panel composition

Review questions:

- does the triple-panel layout feel justified for a schema-authoring node?
- is the text editor and structured tree pairing clear enough to suggest live
  synchronization?
- does the compact node summary communicate "DuckDB table definition" rather
  than "table input"?
- are `primary_key`, `default`, and `check` expressive enough for the V1 local
  DuckDB use case without introducing file-warehouse ideas like partitioning?
- should the config panel stay as the third column, or collapse into a footer
  section beneath the two JSON editors later?
