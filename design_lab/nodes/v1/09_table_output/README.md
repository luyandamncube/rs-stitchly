# 09 Table Output

Type: `surface-study`

Purpose:

- create the first concrete table sink node in the design lab
- test how a persistence-oriented output can fit the shared output-result card
  family
- review the node card together with its manager panel, since table sinks are
  mostly about mapping and destination choices
- preserve the current in-app `table_output` design as a stable visual
  reference before the next round of node work, including the live compact
  `Target / Shape / Last write` shell

What this sample is testing:

- a compact sink node for a simple `text_input -> table_output` flow
- single left-side input handle
- the currently shipped custom node shell for `Target`, `Shape`, and `Last write`
- the current mapping-first manager panel for schema, table, mode, and
  generated columns
- shared execution timing controls for node-level wait behavior
- a basic output-table shape that writes one text value plus run metadata
- the reduced panel height footprint that leaves more breathing room at the
  bottom of the canvas

Reference direction:

- node shell stays inside the shared `nodes/v1` card language
- manager panel takes layout and density cues from
  `design_lab/canvas/02_node_management_panel`
- not a direct copy of the canvas reference, but the same darker utility-first
  family

Still unresolved:

- whether `table_output` should accept raw text directly or only true
  table-shaped inputs once dataflow nodes land
- whether the compact node should stay on the current custom
  `Target / Shape / Last write` shell or move to the generic
  `Schema / Table / Mode` card pattern later
- whether metadata columns like `run_id` and `written_at` should be opt-in or
  always on
- whether we eventually want a richer success state on the compact node card
  once real table stats are available

Shared styling:

- the node card uses `../shared.css`
- this study includes a small local stage and panel override inside
  `index.html`, because it reviews node-manager context rather than only the
  isolated card

Review questions:

- does the card clearly read as a persistence sink rather than a preview node?
- does the preserved live `Target / Shape / Last write` shell still feel like
  the right compact summary?
- does the manager panel feel like the right preserved V1 shape for table
  mapping?
- is the `text_input -> table_output` test flow simple enough for the first
  implementation pass?
