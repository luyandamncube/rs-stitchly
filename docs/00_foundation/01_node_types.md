# 01 Node Types

## Purpose

This document defines the node taxonomy for Stitchly and the contract every node type should follow.

The goal is to keep the editor generic while allowing the backend to execute a wide range of built-in and custom nodes.

## Node Contract

Every node type should eventually declare:

- stable type ID
- display name
- category
- description
- input port definitions
- output port definitions
- config schema
- execution runtime
- resource hints
- determinism and caching hints

## Data Types We Likely Need Early

- `file_ref`: reference to a file or artifact
- `bytes`: raw binary data
- `text`: UTF-8 text
- `json`: structured JSON value
- `number`: numeric scalar
- `boolean`: boolean scalar
- `directory_ref`: reference to a directory
- `table_ref`: reference to a table in an external engine
- `dataset_ref`: reference to a logical dataset or materialized result set

We can add richer types such as streams, images, partitions, and model-specific artifacts later.

## Initial Node Families

### Trigger Nodes

- `manual_trigger`: start a workflow on demand
- `schedule_trigger`: start a workflow on a cron-like schedule
- `event_trigger`: start a workflow from an external event or webhook

### Input Nodes

- `file_input`: inject a file reference into a workflow
- `text_input`: inject literal or user-provided text
- `json_input`: inject structured JSON
- `table_input`: reference an existing table or dataset
- `object_store_input`: reference files from object storage or a staging location

### Compute Nodes

- `python_script`: run user-defined Python code against declared inputs
- `rust_native`: built-in high-performance Rust node implementation
- `transform`: generic stateless transformation node family
- `sql_transform`: run SQL against a declared execution engine such as ClickHouse
- `engine_workload`: submit an engine-native workload through a backend-managed adapter

### Data Movement Nodes

- `extract`: ingest data from an external source into a staging target
- `load`: load files or records into a target engine
- `materialize`: persist an intermediate dataset as a named table or artifact

### Control Nodes

- `branch`: choose a path based on a condition
- `merge`: combine multiple upstream results
- `map`: apply a node or subgraph across a collection

### Output Nodes

- `file_output`: write a result as an artifact or file
- `preview_output`: surface human-readable output in the UI
- `json_output`: persist structured output
- `table_output`: persist or expose a table-backed result

### System Nodes

- `cache`: reuse previously computed results
- `quality_check`: assert expectations against intermediate or final results
- `debug`: inspect or log intermediate state
- `note`: annotate the graph without affecting execution

## Recommended MVP Node Sets

### Core Workflow MVP

To match the first target workflow shape, the initial supported set can be:

1. `file_input`
2. `text_input`
3. `python_script`
4. `file_output`
5. `preview_output`

This is enough to validate the base architecture without overcommitting too early.

### First Dataflow Extension

Once the core loop works, the first engine-backed data set can likely be:

1. `table_input`
2. `load`
3. `sql_transform`
4. `table_output`
5. `engine_workload`

This creates a realistic path toward Airflow-like data orchestration while keeping the initial engine surface small.

## Custom Node Strategy

Custom nodes should be defined in a way that allows:

- the frontend to render them from metadata
- the backend to validate them from schema
- the runtime to execute them through a declared adapter

That means a custom node definition should eventually separate:

- visual metadata
- config schema
- I/O schema
- runtime binding
- engine binding, when the node targets an external data system
- packaging and distribution details

## First Questions To Resolve

- How strict should port typing be between nodes?
- Should `python_script` accept named inputs, positional inputs, or both?
- Do Python nodes exchange files, structured values, or both?
- How do we model pushdown into external engines without leaking engine-specific details into every node?
- Should workload-oriented nodes define raw SQL or job specs directly, or reference reusable workload templates?
- Which node metadata lives in workflow definitions versus a shared node registry?
