# 17 Artifacts And Dataset Refs

## Purpose

Define how Stitchly refers to files, directories, tables, and datasets as they move through workflows.

## Why This Matters

Without stable references, workflows become coupled to ad hoc paths, engine-specific strings, and fragile runtime assumptions.

Stitchly should pass typed references between nodes rather than leaking raw storage details everywhere.

## Core Principles

1. Nodes should exchange typed references where possible.
2. References should be serializable and inspectable.
3. Artifact storage location should be abstracted from most workflows.
4. Dataset references should express logical meaning, not only physical location.
5. The runtime should track lineage between produced and consumed references.

## Primary Reference Types

### `file_ref`

Represents one file artifact.

Examples:

- uploaded CSV file
- generated JSON report
- exported parquet file

### `directory_ref`

Represents a directory or bundle of files.

Examples:

- `dolt dump -r csv` output directory
- unpacked archive
- partitioned export set

### `table_ref`

Represents a physical table in an engine.

Examples:

- ClickHouse table
- Postgres table
- DuckDB table

### `dataset_ref`

Represents a logical dataset or materialized result that may map to one or more physical storage objects.

Examples:

- quarterly company financials dataset
- current earnings calendar dataset
- raw DoltHub earnings dump

## Recommended Common Reference Shape

Illustrative shape:

```json
{
  "ref_type": "table_ref",
  "ref_id": "ref_01hxyz",
  "storage_kind": "clickhouse",
  "location": {
    "database": "raw_stock",
    "table": "dolthub_earnings_calendar"
  },
  "metadata": {
    "created_by_run_id": "run_123",
    "schema_version": 1
  }
}
```

Not every field applies to every ref type, but the system should use a predictable envelope.

## Artifact Classes

### Temporary Artifacts

Used only during execution or short-lived debugging.

Examples:

- intermediate CSV files
- temp manifests
- unpacked working files

### Durable Artifacts

Expected to survive beyond one run.

Examples:

- exported reports
- persisted raw ingests
- user-visible downloadable outputs

### Materialized Tables

Durable engine-managed outputs.

Examples:

- raw ingestion tables
- staging tables
- curated marts

## Lifecycle Expectations

Each produced ref should have an intended lifecycle.

Useful lifecycle categories:

- ephemeral
- retained for debugging
- retained until replaced
- durable until manually cleaned up

The lifecycle policy should be visible to the runtime and eventually configurable per node or sink.

## Artifact Storage Direction

The first implementation can support simple storage targets, but the abstraction should remain consistent.

Likely early backends:

- local filesystem
- managed run artifact directory
- S3-compatible object storage later

Workflows should describe sink intent rather than raw absolute paths whenever possible.

## Dataset Semantics

`dataset_ref` should help us talk about logical outputs without baking in one storage engine.

A dataset may point to:

- one directory bundle
- one table
- multiple partition tables
- a versioned materialization

This is useful for dataflow nodes that operate on logical datasets rather than single files.

## Passing Strategy Between Nodes

Prefer:

- nodes emit typed refs
- downstream nodes consume those refs
- the runtime resolves physical access as needed

Avoid:

- arbitrary string paths as the main contract
- raw SQL table names passed through untyped config fields when a `table_ref` would work

## Naming And Identity

We should distinguish between:

- logical name such as `earnings_calendar_curated`
- physical location such as `analytics.earnings_calendar_curated`
- runtime ref ID such as `ref_01hxyz`

All three can matter, but they should not be conflated.

## Lineage Direction

The runtime should eventually be able to answer:

- which run created this artifact
- which node produced it
- which inputs fed into it
- which downstream nodes consumed it

We do not need a full lineage product on day one, but we should not design references in a way that blocks it later.

## Example: DoltHub Earnings Flow

One plausible chain is:

1. `dolt_repo_source` emits a `dataset_ref`
2. `dolt_dump_csv` emits a `directory_ref`
3. `load` emits multiple `table_ref` values
4. `sql_transform` emits a curated `table_ref` or `dataset_ref`
5. `table_output` marks the final durable sink

## UI Implications

The frontend should be able to display safe summaries of references.

Examples:

- file name
- table name
- row count when known
- size estimate when known
- lifecycle class

The frontend does not need direct filesystem or engine credentials to render this metadata.

## Testing Direction

Reference handling should be testable with fixtures.

We should maintain:

- sample `file_ref` fixtures
- sample `table_ref` fixtures
- sample artifact manifests
- small sample files and directories

This is especially important for nodes that transform one ref type into another.

## Open Questions

- Should `table_ref` represent one table only, or can it represent a named collection?
- How soon do we need partition-aware refs?
- Which metadata fields are mandatory across all ref types?
