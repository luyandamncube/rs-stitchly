# 12 Dataflow And Workloads

## Purpose

Define how Stitchly supports data ingestion, transformation, and workload-oriented orchestration in addition to general workflow automation.

## Product Framing

Stitchly should be able to model both:

- lightweight automation and scripting workflows
- data pipelines that move, transform, and materialize datasets

This pushes the product closer to an Airflow-like orchestration role, but with a Rust backend and a node model designed to support both custom code and engine-backed execution.

## Core Idea

For data workloads, Stitchly should act as:

- the workflow authoring layer
- the validation and planning layer
- the scheduler and run coordinator
- the observability surface

Stitchly should not try to become a full analytical engine itself. When a task is better executed inside a system such as ClickHouse, Stitchly should push the work there and manage the lifecycle around it.
Rust should coordinate those workloads, not ingest large datasets into the runtime process unless a node truly requires local processing.

## Candidate Dataflow Node Families

### Source Nodes

- object store readers
- database extract nodes
- table and dataset references

### Transform Nodes

- SQL transform nodes
- engine-native workload nodes
- Python transform nodes for glue logic and custom processing

### Sink Nodes

- table materialization nodes
- export nodes
- object store writers

### Orchestration Nodes

- partition or parameter fan-out
- data quality checks
- backfill helpers
- notifications and completion hooks

## Engine Adapter Direction

The backend should eventually support engine adapters that expose a common orchestration contract while allowing engine-specific optimization.

The first candidate engine can be ClickHouse because it covers a useful slice of ingestion and transformation workloads while fitting the performance-oriented direction of the product.

Later candidates may include DuckDB, DataFusion, Spark, or Postgres, but only after the first adapter model is proven.

This means data-oriented compute should usually follow one of two paths:

- run a lightweight local executor for glue logic
- push heavy transforms and materializations into the selected data engine

## Workloads In Nodes

Workload-oriented nodes may define:

- a workload kind such as ingest, transform, load, or quality check
- the target engine
- the inputs and outputs they expect
- the config or query they need
- resource and retry hints

The important boundary is that node authors can describe the workload, but Stitchly should still standardize orchestration concerns such as retries, run IDs, observability, cancellation, and scheduling semantics.

## Scheduling Direction

Airflow-like capabilities probably belong in Stitchly, but they should arrive after manual execution is solid.

Early scheduling support could include:

- manual runs
- parameterized runs
- cron-like schedules
- backfills over a declared range

## Open Questions

- Should schedules live on workflows, on specific nodes, or in a separate runtime layer?
- What is the first engine adapter we want to implement after the core workflow loop works?
- How much of a workload node should be engine-specific versus normalized across engines?
- Do we model lineage and dataset metadata from the first dataflow release, or add it later?
