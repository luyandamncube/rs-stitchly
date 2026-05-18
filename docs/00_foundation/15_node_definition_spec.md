# 15 Node Definition Spec

## Purpose

Define the exact contract a Stitchly node must satisfy so the frontend, backend, and runtime can all agree on node behavior.

## Design Goals

- let the frontend render nodes from metadata
- let the backend validate nodes from one canonical definition
- let the runtime resolve execution behavior without frontend-specific assumptions
- support built-in nodes and future custom nodes
- keep engine-specific behavior contained rather than leaking into the whole workflow model

## Node Definition Layers

A node definition should separate five concerns:

1. identity
2. interface
3. configuration
4. runtime binding
5. UI metadata

## Required Fields

Every node definition should eventually declare:

- `type_id`: stable identifier such as `python_script`
- `version`: definition version
- `display_name`
- `category`
- `description`
- `inputs`
- `outputs`
- `config_schema`
- `runtime`
- `capabilities`
- `ui`

## Port Definition

Each port definition should declare:

- `port_id`
- `display_name`
- `direction`
- `data_type`
- `required`
- `multiple` or single-connection behavior
- `description`

Optional fields may include:

- default value behavior
- partition semantics
- collection semantics
- compatibility aliases

## Config Schema

Each node should expose a machine-readable config schema.

The config schema should define:

- allowed fields
- required fields
- enums and scalar types
- nested objects
- validation constraints
- defaults when appropriate

The frontend should use this to generate or assist inspector UIs, but the backend remains the enforcement point.

## Runtime Binding

The runtime block should declare how the node executes.

Candidate fields:

- `executor_kind`: `rust_native`, `python`, `engine_adapter`, `process`, or future kinds
- `adapter_id`: when execution is delegated to a named adapter
- `isolation_mode`: `in_process`, `subprocess`, `external_engine`, `container`, or future modes
- `resource_hints`
- `timeout_policy`
- `retry_policy`
- `determinism`
- `cacheability`

This is where we keep execution strategy explicit without forcing the frontend to understand how to run the node.

The important distinction is:

- `executor_kind` describes who performs the work
- `isolation_mode` describes how isolated that work is

## Capability Metadata

Capabilities describe behavior that affects planning and UX.

Examples:

- reads external state
- writes external state
- produces durable artifacts
- supports preview
- supports partitioned execution
- requires connection reference
- may emit structured logs

## UI Metadata

The UI block should include only safe metadata the frontend needs to render and edit the node.

Examples:

- icon key
- color token
- default size
- port labels
- config section groupings
- inline help text
- output preview hints

Secrets, runtime internals, and sensitive connection details should not be part of the UI block.

## Recommended Node Definition Shape

Illustrative shape:

```json
{
  "type_id": "sql_transform",
  "version": 1,
  "display_name": "SQL Transform",
  "category": "compute",
  "description": "Runs SQL in a selected engine.",
  "inputs": [
    {
      "port_id": "source",
      "display_name": "Source",
      "direction": "input",
      "data_type": "table_ref",
      "required": true,
      "multiple": true
    }
  ],
  "outputs": [
    {
      "port_id": "result",
      "display_name": "Result",
      "direction": "output",
      "data_type": "table_ref",
      "required": true,
      "multiple": false
    }
  ],
  "config_schema": {
    "type": "object"
  },
  "runtime": {
    "executor_kind": "engine_adapter",
    "adapter_id": "clickhouse"
  },
  "capabilities": {
    "requires_connection": true,
    "supports_preview": false
  },
  "ui": {
    "icon": "database",
    "default_width": 320
  }
}
```

## Workflow Node Instance Versus Node Definition

We should keep a clean distinction between:

- node definitions in the registry
- node instances inside a workflow

The definition describes what a node type is.

The workflow instance provides:

- node ID within the graph
- selected config values
- layout metadata
- any per-instance labels or notes

The workflow should not duplicate the entire node definition.

## Built-In Node Requirements

Each built-in node should ship with:

- one registered definition
- one valid config fixture
- one invalid config fixture
- one minimal workflow fixture
- one runtime test or adapter test

## Custom Node Requirements

Custom nodes should eventually support the same contract shape as built-in nodes, with additional packaging metadata.

Likely extra fields:

- publisher or namespace
- package version
- distribution source
- signature or trust metadata later if needed

## Validation Rules

Validation should happen at multiple levels.

### Definition Validation

Check that the node definition itself is well-formed.

Examples:

- unique port IDs
- valid data types
- config schema parses correctly
- runtime binding is internally consistent

### Workflow Validation

Check that a workflow uses the node definition correctly.

Examples:

- required config fields present
- port connections type-check correctly
- multiple-connection rules are respected
- required connection references exist syntactically

### Runtime Validation

Check that the environment can satisfy execution needs.

Examples:

- referenced adapter is available
- required connection exists
- referenced engine supports requested operation

## Versioning Direction

Node definitions should have explicit versioning.

Why:

- config schemas will evolve
- node behavior may tighten over time
- workflows need predictable migrations

We do not need complex migrations on day one, but we should not assume node definitions are forever static.

## Examples By Node Family

### `file_input`

Likely traits:

- no upstream inputs
- output type `file_ref`
- local or uploaded artifact reference in config
- runtime kind may be `rust_native`

### `python_script`

Likely traits:

- multiple typed inputs
- output type may be `file_ref`, `json`, or other declared shapes
- runtime kind `python`
- isolation mode likely starts as `subprocess`
- sandbox and dependency policy declared separately

### `dolt_dump_csv`

Likely traits:

- input `dataset_ref` or `directory_ref`
- output `directory_ref`
- runtime kind `engine_adapter` or `process`
- isolation mode likely starts as `subprocess`
- produces raw artifact bundle plus manifest

## Open Questions

- How strongly should output typing be declared for custom code nodes?
- Do we allow node definitions to expose generated inspector UIs only, or also custom React inspector components later?
- Which part of node definition versioning belongs in the workflow versus the registry?
