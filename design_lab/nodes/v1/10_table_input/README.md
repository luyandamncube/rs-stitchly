# 10 Table Input

Type: `surface-study`

Purpose:

- create the first concrete `table_input` node study in the design lab
- define how a table-backed source should read inside the shared node system
- review the compact source card together with its manager panel before app
  implementation starts
- test a simple dataflow reference using the
  `table_input -> preview_output` pattern

What this sample is testing:

- a compact source-first card for `workflow.duckdb / runs.workflow_runs`
- single right-side output handle
- a table-specific summary shell for `Source`, `Columns`, and `Catalog`
- a manager panel centered on catalog, schema, table, alias, and row shaping
- shared execution timing controls for node-level wait behavior
- a generated SQL preview that makes the read contract visible
- the reduced panel height footprint that leaves more breathing room at the
  bottom of the canvas

Reference direction:

- node shell stays inside the shared `nodes/v1` card language
- manager panel takes layout and density cues from
  `design_lab/canvas/02_node_management_panel`
- not a direct copy of the canvas reference, but the same darker utility-first
  family

Still unresolved:

- whether `table_input` should keep this compact table-specific summary shell or
  move closer to the generic `ARC_INPUT_REFERENCE` pattern used by `file_input`
- whether row filter and row limit belong directly on the node or should wait
  for a later SQL-oriented compute layer
- whether the compact card should show the catalog name in the footer or infer
  it silently from canvas context
- whether aliasing should be part of the first implementation pass or added
  later once downstream SQL and joins are more mature

Shared styling:

- the node card uses `../shared.css`
- this study includes a small local stage and panel override inside
  `index.html`, because it reviews node-manager context rather than only the
  isolated card

Review questions:

- does the card clearly read as a table source rather than a sink?
- does the `Source / Columns / Catalog` summary feel like the right compact
  abstraction for a first `table_input` node?
- does the manager panel feel appropriately read-oriented without drifting into
  full SQL-editor territory?
- is the `table_input -> preview_output` review flow simple enough for the
  first implementation pass?
