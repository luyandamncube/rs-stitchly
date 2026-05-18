# 00 Intro

## Product Statement

Stitchly is a visual workflow and dataflow builder with a lightweight, high-performance Rust execution backend and a React Flow-based canvas frontend.

The frontend defines workflows semantically. The backend owns validation, planning, execution, resource management, runtime observability, and engine integration.

## Why This Exists

We want the flexibility of modern visual AI, automation, and data orchestration tools without inheriting a heavy runtime model.

Stitchly should make it easy to connect nodes such as:

`file input -> python script -> output`

and also dataflow shapes such as:

`object store input -> clickhouse load -> sql transform -> table output`

while keeping the execution engine efficient enough to scale without dragging along unnecessary framework overhead.

## Core Product Principles

1. Execution belongs to the backend.
2. The canvas is an editor, not a runtime.
3. Rust is the performance-critical core.
4. Workflows must be serializable, portable, and versionable.
5. Heavy data work should run in the right engine, with Stitchly acting as the orchestrator and control plane.
6. Node definitions should support both built-in nodes and custom nodes.
7. The system should be able to run lightweight local workflows first, then grow into more advanced execution modes later.

## Initial Assumptions

- The first UI will use React Flow for graph editing.
- The first backend will be written in Rust.
- Custom code nodes, especially Python, are a core part of the product direction.
- Data ingestion and transformation workflows are first-class use cases, not side features.
- Some nodes will delegate execution to specialized engines such as ClickHouse rather than running entirely inside the Rust process.
- The first release can focus on local or single-runtime execution before distributed orchestration.
- The system should be designed so the frontend never needs to know how execution actually happens.

## MVP Shape

The first meaningful Stitchly version should likely include:

- a workflow canvas
- save/load of workflow definitions
- a small set of core node types
- a Python script node
- a path for engine-backed data nodes, even if only one engine is supported first
- a local execution path
- basic logs, status, and outputs

## Non-Goals For The First Phase

- multi-tenant SaaS concerns
- distributed execution across machines
- a large public node marketplace
- advanced scheduling and enterprise orchestration
- support for every data engine or warehouse in v1
- every possible integration from day one

## What Success Looks Like Early

An early Stitchly user can:

1. create a small workflow in the canvas
2. connect typed inputs and outputs
3. run a script-oriented workflow or a data-oriented workflow through the Rust backend
4. push heavy data work into the right execution engine when applicable
5. inspect logs, outputs, and failures
6. add or evolve custom nodes without changing the editor model

## Open Questions

- What is the first supported execution environment for Python nodes?
- How opinionated should node I/O typing be in v1?
- Do we support only manual runs first, or also file-watch and API-triggered runs?
- What is the first supported data engine for engine-backed transforms?
- How should scheduled and backfill-style data workloads fit into the workflow model?
- How soon do we need remote execution versus local execution?
