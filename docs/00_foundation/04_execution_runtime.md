# 04 Execution Runtime

## Purpose

Describe how Stitchly plans and executes workflows.

## This Doc Should Cover

- workflow compilation and planning
- node lifecycle
- dependency resolution
- concurrency model
- executor selection and dispatch
- engine pushdown and external workload execution
- retries and failure handling
- cancellation
- scheduled runs and backfills
- logging and run events
- resource limits

## Early Direction

- Runtime orchestration belongs entirely to the backend.
- The runtime should support both native Rust executors and external executors such as Python.
- Dataflow nodes should let Stitchly orchestrate the work while pushing heavy compute into the selected data engine where possible.
- Execution should be designed for low overhead so local workflows stay fast and lightweight.
- Containers should be optional isolation mechanisms, not the default execution path for every node in the first version.

## Open Questions

- Do we use a task graph scheduler from the start or grow into one?
- Are node outputs materialized eagerly, lazily, or by type?
- What is the first artifact-passing strategy between nodes?
- When does a node compile into engine-native SQL or a workload spec versus run inside a local executor?
- When do we introduce containerized workers instead of subprocess executors?
- How do long-running data workloads, retries, and backfills fit into the run model?
