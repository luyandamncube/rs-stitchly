# 02 Output Contract

## Purpose

Define what a node is allowed to emit after execution and how those outputs should be represented, stored, and handed to downstream nodes.

This doc answers:

- what counts as a node output
- how outputs are keyed
- how outputs are typed
- when a node emits nothing
- how per-node output contracts should be tracked over time

## V1 Global Contract

### Output Shape

For v1, a node may emit zero or more named outputs:

- key: `source_port_id`
- value: one `TypedValue`

Runtime storage shape:

- `(node_id, port_id) -> TypedValue`

### Typed Output Rule

Every emitted output must match the declared port data type from the node definition.

That means:

- a `text` output must emit `TypedValue { data_type: Text, ... }`
- a `json` output must emit `TypedValue { data_type: Json, ... }`
- future artifact refs must emit the matching ref type

### Zero-Output Nodes

Some nodes are terminal or side-effect-only and should emit no graph outputs.

Examples:

- `send_email`
- `preview_output`

Those nodes may still emit:

- run events
- logs
- future artifacts or receipts

But they do not place a value onto a workflow output port unless that is explicitly part of the node definition.

### Output Persistence Boundary

For v1, graph outputs should remain lightweight and runtime-friendly.

That means:

- inline text, json, number, and boolean values are acceptable
- heavy payloads should later move toward ref-style outputs rather than large inline values

This is especially important for future:

- file outputs
- table outputs
- dataset outputs

### Last Output vs Full Output Set

The runtime may store:

- the full output map for execution routing
- a reduced `last_output` preview for node-run observability

Those are not the same concern.

The execution system routes from the full output map.
The run UI may only surface a preview-friendly subset.

## Recommended Per-Node Tracking Pattern

Do not leave output behavior implicit in adapter code.

For each real node type, record:

- declared output ports
- whether output is always emitted or conditional
- which config or inputs influence the output shape
- whether the output is safe to inline

## Running Output Contract Table

| Node type | Declared outputs | Output source | Inline or ref | V1 output contract |
| --- | --- | --- | --- | --- |
| `text_input` | `text -> Text` | config-owned | inline | emits one text payload copied from `config.text` |
| `text_transform` | `text -> Text` | computed from upstream `source` and config operation | inline | emits one transformed text payload |
| `preview_output` | none | n/a | n/a | emits no graph output; logs only |
| `send_email` | none | n/a | n/a | emits no graph output; logs only |

## Notes By Node

### `text_input`

`text_input` is the simplest output contract:

- one declared output
- one inline value
- no conditional behavior

### `text_transform`

`text_transform` is the first derived output contract:

- one upstream input
- one config-controlled transformation
- one output with the same broad type family

### `send_email`

`send_email` should stay output-less in v1.

If we later want delivery receipts or message references, that should be an explicit new output contract, not an implicit change.

## Follow-Up Rows To Add

As more nodes become real, extend this table for:

- `json_input`
- `conditional`
- `http_request`
- `file_output`
- `table_materialize`
- future artifact-producing nodes
