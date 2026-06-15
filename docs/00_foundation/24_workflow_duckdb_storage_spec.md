# 24 Workflow DuckDB Storage Spec

## Purpose

Define the first concrete storage model for workflow-local table management.

This doc builds on:

- `23_storage_root_and_identity_architecture.md`

It chooses the first workflow-local table store and explains:

- where each workflow database should live
- what should be created when a workflow is created
- which data belongs in the workflow DuckDB file
- which data must remain in the control-plane database
- which schemas the workflow DuckDB file should contain in v1

## Why This Exists

We already have:

- a rooted local-first storage direction
- backend-owned users, sessions, workspaces, workflows, and runs
- durable run summaries and event/log history in the control plane

What is still missing is the workflow-local data plane for:

- table-shaped inputs
- staging tables
- workflow-owned durable tables
- output tables
- local analytical query workloads

We want a first implementation that is:

- simple to create per workflow
- easy to move across machines later
- strong for local analytical workloads
- compatible with the future mounted-cloud-volume direction
- clearer than a directory of many Parquet files for the first pass

## Recommended V1 Choice

Use:

- one DuckDB file per workflow

Rationale:

- one workflow maps cleanly to one local analytical artifact
- local analytical performance is strong
- the runtime can reason about one file path instead of managing a directory of table files
- the file is portable for later backup, transplant, or export workflows
- Parquet export can still be added later without making Parquet the first canonical workflow-local store

## Relationship To The Existing Control Plane

The workflow DuckDB file is not the control plane.

The control plane must remain the canonical source for:

- users
- auth identities
- sessions
- workspaces
- workflow metadata
- workflow versions
- canonical run summaries
- canonical run events
- canonical run logs

The workflow DuckDB file should be used for workflow-local data workloads only.

That means:

- `workflow.json` stays the canonical workflow definition
- the Rust backend still owns workflow CRUD and run lifecycle
- DuckDB stores workflow-local tables and workflow-shaped analytical state

## Root Path Model

Within the rooted storage layout from `23_storage_root_and_identity_architecture.md`, each workflow should look like this:

```text
<workflow_id>/
  workflow.json
  db/
    workflow.duckdb
  files/
```

When expanded under the rooted ownership model:

```text
<root>/
  platform/
    platform.sqlite3

  users/
    <user_id>/
      workspaces/
        <workspace_id>/
          workflows/
            <workflow_id>/
              workflow.json
              db/
                workflow.duckdb
              files/
                uploads/
                outputs/
                artifacts/
```

## What Happens On Workflow Creation

When a new workflow is created, Stitchly should create:

1. the workflow directory
2. `workflow.json`
3. `db/`
4. `db/workflow.duckdb`
5. `files/`
6. the standard DuckDB schemas

This should happen for:

- blank workflows
- starter workflows
- any future templated workflows

The control-plane `workflows` row should also persist the workflow storage owner user id, so the backend can resolve the rooted workflow path later even when the current session user is not the original workflow creator.

## Required V1 DuckDB Schemas

Each new workflow database should be initialized with these schemas:

- `runs`
- `staging`
- `tables`
- `outputs`

## Schema Responsibilities

### `runs`

Purpose:

- workflow-local run tables
- node-level result tables
- optional materialized run outputs for later inspection

Examples:

- `runs.node_send_email_attempts`
- `runs.run_input_snapshots`
- `runs.run_output_summary`

This schema is for workflow-local analytical run data, not the canonical run control-plane record.

The canonical run summary, event history, and log history must still remain in the backend persistence model documented in:

- `22_run_history_and_debugging_spec.md`

### `staging`

Purpose:

- transient or semi-transient imported tables
- landing-zone data before validation or promotion
- intermediate ingestion tables

Examples:

- `staging.raw_contacts`
- `staging.api_orders_batch_20260525`

This schema is useful for:

- file import nodes
- API extraction nodes
- future ETL flows

### `tables`

Purpose:

- workflow-owned durable working tables
- curated internal tables used by the workflow
- tables that should survive beyond one run

Examples:

- `tables.contacts`
- `tables.customers`
- `tables.email_recipients`

This should be the main durable data schema for workflow-local operational tables.

### `outputs`

Purpose:

- tables or views intended as workflow outputs
- published result tables
- user-facing or downstream-facing output artifacts in table form

Examples:

- `outputs.preview_rows`
- `outputs.failed_refund_alerts`
- `outputs.final_export`

This schema is where output nodes can materialize result tables or views.

## Recommended V1 Bootstrap SQL

The workflow DB bootstrap should at least run:

```sql
create schema if not exists runs;
create schema if not exists staging;
create schema if not exists tables;
create schema if not exists outputs;
```

## Implemented V1 Mirror Tables

Phase 4 adds the first concrete workflow-local run mirror tables.

Current implementation note:
- workflow-local run mirroring is feature-flagged behind `STITCHLY_ENABLE_WORKFLOW_RUN_DUCKDB_SYNC`
- the default is `disabled`
- canonical run history remains the control-plane store in SQLite
- set `STITCHLY_ENABLE_WORKFLOW_RUN_DUCKDB_SYNC=1` to enable local DuckDB mirroring during debugging or focused development

### `runs.workflow_runs`

Purpose:

- one row per workflow run
- quick analytical facts about run duration, status, and error counts
- a workflow-local snapshot mirror without replacing the canonical control-plane run tables

Columns:

- `run_id`
- `workspace_id`
- `workflow_id`
- `workflow_version`
- `status`
- `trigger_kind`
- `started_at`
- `finished_at`
- `duration_ms`
- `error_category`
- `error_message`
- `error_count`
- `retry_count`
- `node_count`
- `completed_node_count`
- `snapshot_json`
- `created_at`
- `updated_at`

### `runs.node_runs`

Purpose:

- one row per node execution inside a run
- workflow-local inspection of node status, attempts, log counts, and latest output

Columns:

- `run_id`
- `node_id`
- `type_id`
- `status`
- `attempt`
- `started_at`
- `finished_at`
- `duration_ms`
- `log_count`
- `error_category`
- `error_message`
- `last_output_json`
- `created_at`
- `updated_at`

### `outputs.node_outputs`

Purpose:

- first workflow-local materialization of node output artifacts
- mirrors `last_output` from the node snapshot as the first output record shape

Columns:

- `run_id`
- `node_id`
- `output_data_type`
- `output_json`
- `output_text_preview`
- `produced_at`

Recommended bootstrap SQL now becomes:

```sql
create schema if not exists runs;
create schema if not exists staging;
create schema if not exists tables;
create schema if not exists outputs;

create table if not exists runs.workflow_runs (
  run_id varchar not null,
  workspace_id varchar not null,
  workflow_id varchar not null,
  workflow_version integer not null,
  status varchar not null,
  trigger_kind varchar,
  started_at varchar,
  finished_at varchar,
  duration_ms bigint,
  error_category varchar,
  error_message varchar,
  error_count bigint not null default 0,
  retry_count bigint not null default 0,
  node_count integer not null default 0,
  completed_node_count integer not null default 0,
  snapshot_json text not null,
  created_at varchar not null,
  updated_at varchar not null
);

create table if not exists runs.node_runs (
  run_id varchar not null,
  node_id varchar not null,
  type_id varchar not null,
  status varchar not null,
  attempt integer not null default 0,
  started_at varchar,
  finished_at varchar,
  duration_ms bigint,
  log_count bigint not null default 0,
  error_category varchar,
  error_message varchar,
  last_output_json text,
  created_at varchar not null,
  updated_at varchar not null
);

create table if not exists outputs.node_outputs (
  run_id varchar not null,
  node_id varchar not null,
  output_data_type varchar not null,
  output_json text not null,
  output_text_preview varchar,
  produced_at varchar not null
);
```

The mirror tables intentionally avoid DuckDB primary-key indexes. Run history remains canonical in SQLite, and the mirror writer maintains idempotency with delete-then-insert semantics so damaged mirror indexes can be rebuilt without touching workflow staging or durable tables.

Optional later additions such as metadata tables should still wait until needed.

## What Should Not Go Into The Workflow DuckDB File Yet

Do not move these into the workflow DB in v1:

- user records
- workspace membership
- session state
- canonical workflow definitions
- canonical workflow version history
- canonical run summaries
- canonical run event history
- canonical run logs

Do not treat `workflow.duckdb` as a multi-user shared control-plane database.

## `workflow.json` Ownership Rules

`workflow.json` should remain the workflow-definition artifact beside the DuckDB file.

It should continue to represent:

- nodes
- edges
- workflow metadata
- viewport metadata
- workflow-level configuration

DuckDB should not become the canonical source of graph structure in v1.

## `files/` Ownership Rules

The `files/` directory should remain file-oriented storage beside the DB.

Recommended subfolders:

- `files/uploads/`
- `files/outputs/`
- `files/artifacts/`

Use `files/` for:

- uploaded CSV, JSON, XLSX, and similar sources
- exported outputs
- generated files that are better stored as normal files than table rows

## Runtime Usage Direction

The runtime should treat `db/workflow.duckdb` as the workflow-local analytical store.

Likely early node behavior:

- input nodes may load table-shaped data into `staging`
- transform nodes may read from `staging` or `tables` and write into `tables`
- output nodes may materialize into `outputs`
- run-oriented materializations may write into `runs`

The runtime should resolve the workflow-local DB path from:

- `user_id`
- `workspace_id`
- `workflow_id`

It should not derive the path from mutable names.

## Cloud Transplant Direction

This model is compatible with the later deployment shape already discussed:

- local disk now
- mounted cloud volume later

The logical path should stay the same.

That means the future move to a DigitalOcean-hosted setup can preserve:

- workflow directory ownership
- `workflow.json`
- `db/workflow.duckdb`
- `files/`

without forcing a redesign of workflow-local storage semantics.

## Known Limits And Deferred Work

This v1 choice intentionally accepts some limits:

- DuckDB is not the shared multi-writer control plane
- canonical run/event/log persistence remains elsewhere
- table export strategy is deferred
- Parquet interoperability is deferred
- retention and cleanup rules for workflow-local tables are deferred

These should be documented later when we introduce:

- table import/export nodes
- larger ETL workloads
- retention policies
- workflow-local backup or sync behavior

## Recommended Implementation Order

Before implementation:

1. accept this workflow-local DuckDB direction
2. confirm the initial schema set:
   - `runs`
   - `staging`
   - `tables`
   - `outputs`

Then implement in this order:

1. storage helper that resolves the workflow root path
2. workflow creation bootstrap that creates:
   - workflow directory
   - `workflow.json`
   - `db/workflow.duckdb`
   - `files/`
3. DuckDB bootstrap that creates the standard schemas
4. tests proving every new workflow gets the expected directory and DB shape
5. only then start wiring table-management behavior into runtime nodes

## Review Keys

Use these keys for approval or requested changes:

- `WDB_01`: one DuckDB file per workflow
- `WDB_02`: canonical layout is `<workflow_id>/workflow.json`, `db/workflow.duckdb`, `files/`
- `WDB_03`: control plane stays canonical for workflow metadata and run history
- `WDB_04`: initialize `runs`, `staging`, `tables`, and `outputs` for every workflow
- `WDB_05`: `workflow.json` stays the canonical workflow graph artifact
