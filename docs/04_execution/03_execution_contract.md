# 03 Execution Contract

## Purpose

Define the runtime-facing execution shape for a node instance.

This doc answers:

- what inputs the runtime passes into execution
- what preconditions must hold before a node starts
- what a successful or failed execution means
- which parts of execution are global versus node-specific

## V1 Global Contract

### Node Execution Inputs

Each node should conceptually execute against:

- `node`
- `definition`
- `resolved_inputs`
- `run_context`

Where:

- `node` contains the instance config and `node_id`
- `definition` contains canonical ports, config schema, and runtime metadata
- `resolved_inputs` contains the final upstream values by input port
- `run_context` is reserved for run/workspace metadata and can remain minimal in v1

### Preconditions

Before execution starts, the runtime should already have ensured:

- workflow validation passed
- required inputs are satisfied
- the workflow graph is acyclic
- upstream dependencies completed successfully enough for this node to run

That means adapter execution should not be responsible for graph planning.

### Shared Timing Controls

For v1, any node may also carry optional workflow-level execution timing in config:

- `config.execution.wait_before_seconds`
- `config.execution.wait_after_seconds`

These waits are runtime-owned orchestration controls, not adapter-owned business logic.

Practical rule:

- before wait keeps the node in its running phase before adapter execution starts
- after wait keeps the node in its running phase after adapter success and before node completion is recorded
- absent or `0` means no extra wait

### Execution Outcome

A node execution should resolve to one of:

- success with outputs and optional logs
- failure with a structured runtime error

For v1 we do not need a third “partial success” contract.

### Runtime-Owned Responsibilities

The runtime owns:

- planning order
- input resolution
- run/node state transitions
- event emission
- retry orchestration later
- cancellation orchestration later

The node executor owns:

- applying node-specific config
- consuming resolved inputs
- producing outputs
- emitting logs
- surfacing domain-level execution failure

## Running Execution Contract Table

| Node type | Preconditions | Consumes | Produces | Side effects | V1 execution rule |
| --- | --- | --- | --- | --- | --- |
| `text_input` | valid `config.text` | config only | one text output | none | pure source execution; no upstream dependency; optional runtime wait before/after |
| `text_transform` | valid `config.operation`; `source` input present | one upstream text input | one transformed text output | none | pure transform execution; synchronous in-process |
| `preview_output` | `text` input present | one upstream text input | no graph outputs | structured logs | sink-style execution; consumes text and logs preview content |
| `send_email` | valid `to` and `subject`; optional body from input or config | optional upstream `body`, config fields | no graph outputs | notification side effect, structured logs | output-side execution; consumes body and records send intent; optional runtime wait before/after |

## Notes By Node

### Pure Source Nodes

`text_input` is the source-node baseline.

Its execution contract is:

- no upstream inputs
- no side effects
- deterministic output from config

### Pure Transform Nodes

`text_transform` is the transform-node baseline.

Its execution contract is:

- one resolved input
- config-driven transformation
- deterministic derived output

### Sink / Side-Effect Nodes

`preview_output` and `send_email` are the first sink patterns.

They show two useful categories:

- sink with observability only
- sink with external side-effect intent

## Future Fields To Add Per Node

As runtime behavior deepens, extend the per-node table with:

- timeout expectations
- retry suitability
- cancellation behavior
- determinism / cacheability notes
- whether execution can be replayed safely
