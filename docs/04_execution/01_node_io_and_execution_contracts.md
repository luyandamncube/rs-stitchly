# 01 Node IO And Execution Contracts

## Purpose

Define the practical execution contract between:

- the workflow graph
- the runtime planner
- the node adapter layer

This doc exists to answer a very specific product and runtime question:

- when a node runs, what inputs does it actually receive
- what outputs may it emit
- how does one node's output become another node's input
- which parts of that contract are global versus node-specific

## Why This Is A Separate Doc

`15_node_definition_spec.md` defines the schema shape of a node definition.

This doc is narrower and more operational.

It keeps a running, node-by-node contract table so that as we add real nodes, we can lock:

- input expectations
- config fallbacks
- output shapes
- execution notes

The goal is to avoid implicit behavior scattered across:

- frontend UI assumptions
- runtime adapter code
- test fixtures

## Recommended Doc Pattern

Do not create one standalone contract doc per node type.

Instead:

- keep one shared execution-contract doc
- keep one running contract table inside it
- add one row per node type as implementation becomes real

That gives us:

- one place to compare node behavior
- one source of truth for data passing rules
- one table we can extend without fragmenting the docs

## V1 Global Contract

### Graph Contract

The workflow graph is the routing layer.

The canonical workflow already declares:

- `nodes`
- `edges`
- `source_node_id`
- `source_port_id`
- `target_node_id`
- `target_port_id`

That means the runtime does not need nodes to discover downstream consumers themselves.

The runtime is responsible for:

- planning node order
- resolving upstream values
- passing resolved inputs into node execution

### Input Contract

For v1, a node should execute against a resolved input map:

- key: `target_port_id`
- value: one `TypedValue`

Practical rule:

- single input port -> one `TypedValue`
- missing optional input -> input key absent
- missing required input -> workflow validation failure before run

We are **not** implementing multi-input merge semantics yet.

That means:

- `multiple: true` may remain in node definitions as future-facing metadata
- but runtime behavior should currently assume one value per input port

### Output Contract

For v1, a node may emit zero or more named outputs:

- key: `source_port_id`
- value: one `TypedValue`

The runtime stores outputs by:

- `(node_id, port_id)`

### Fan-Out Contract

Fan-out is supported in v1.

That means one output port may feed multiple downstream nodes.

Example:

- `input_text.text -> send_email_a.body`
- `input_text.text -> send_email_b.body`

The runtime behavior should be:

- execute the upstream node once
- store the output once
- allow all matching downstream edges to resolve from that stored output

So we do **not** need “multiple inputs” yet in order to support “one output to many downstream nodes”.

### Node Awareness Boundary

Nodes do not need full pipeline awareness in v1.

A node execution should be able to run from:

- its own node definition
- its own node config
- its resolved input map

The runtime, not the node, owns:

- graph traversal
- dependency order
- upstream output lookup
- fan-out routing
- run and node state transitions

## Recommended Execution Shape

At runtime, each node should conceptually execute against:

- `node`
- `definition`
- `resolved_inputs`
- `run_context`

Where:

- `node` contains the instance config and `node_id`
- `definition` contains the canonical port and runtime metadata
- `resolved_inputs` is the final port-value map
- `run_context` is future-facing for run/workspace metadata

The current runtime is already close to this shape, even if `run_context` is still implicit.

## Running Contract Table

This table should grow as real nodes are implemented.

| Node type | Inputs | Config fallback / notes | Outputs | Current runtime contract |
| --- | --- | --- | --- | --- |
| `text_input` | none | requires `config.text: string` | `text -> TypedValue::Text` | source node; emits one text payload from config; no upstream dependency |
| `text_transform` | `source -> Text` required | `config.operation` controls transform mode; currently `identity`, `uppercase`, `trim` | `text -> TypedValue::Text` | consumes one upstream text value and emits one transformed text value |
| `preview_output` | `text -> Text` required | optional `config.title`; no output ports | none | terminal preview/log-style node; consumes one text value and emits logs only |
| `send_email` | `body -> Text` optional | requires `config.to` and `config.subject`; may fall back to `config.body` when no upstream body exists | none | terminal side-effect node; consumes optional upstream text body or fallback body string and emits logs only |

## Current Node Contract Notes

### `text_input`

`text_input` should be treated as a pure source node.

It does not consume graph input.

Its execution contract is:

- read `config.text`
- emit `text`

### `send_email`

`send_email` is a useful example of mixed input resolution.

Its current runtime contract is:

- upstream `body` input may provide the message body
- if `body` is absent, runtime may fall back to `config.body`
- `to` and `subject` are always config-owned in v1

This means `send_email` already shows the pattern we should follow:

- some values come from graph input
- some values come from node config
- the node contract must state both clearly

## What This Means For The Next Runtime Step

Before deeper run logic, the runtime is already capable of:

- typed single-input resolution
- deterministic topological execution
- one-output-to-many-downstream fan-out

So the next implementation work does **not** need a new graph model.

It mostly needs stricter alignment between:

- node definitions
- runtime adapter behavior
- node manager UI

## Immediate Follow-Up Work

As we implement more node types, add rows here for:

- `json_input`
- `http_request`
- `conditional`
- `preview_output`
- future dataflow source / transform / sink nodes

Later additions should probably extend this doc with:

- per-node output payload examples
- artifact-ref and dataset-ref rules
- richer executor-specific runtime context
