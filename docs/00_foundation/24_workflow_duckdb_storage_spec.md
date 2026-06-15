# 24 Workspace DuckDB Storage Spec

## Purpose

Define the first concrete storage model for workspace-scoped table management.

This doc builds on:

- `23_storage_root_and_identity_architecture.md`

It chooses the first workspace data-plane table store and explains:

- where each workspace database should live
- what should be created when a workspace is created or opened
- which data belongs in the workspace DuckDB file
- which data must remain in the control-plane database
- which schemas the workspace DuckDB file should contain in v1

## Why This Exists

We already have:

- a rooted local-first storage direction
- backend-owned users, sessions, workspaces, workflows, and runs
- durable run summaries and event/log history in the control plane

What is still missing is the workspace data plane for:

- table-shaped inputs
- staging tables
- durable tables shared by workflows in the workspace
- output tables
- local analytical query workloads

We want a first implementation that is:

- simple to create per workspace
- easy to move across machines later
- strong for local analytical workloads
- compatible with the future mounted-cloud-volume direction
- clearer than a directory of many Parquet files for the first pass

## Recommended V1 Choice

Use:

- one DuckDB file per workspace

Rationale:

- workflows in the same workspace can build on shared datasets
- the workspace is the natural boundary for shared analytical objects
- local analytical performance is strong
- the runtime can reason about one workspace database path instead of one database per workflow
- the file is portable for later backup, transplant, or export workflows at the workspace boundary
- Parquet export can still be added later without making Parquet the first canonical workflow-local store

## Relationship To The Existing Control Plane

The workspace DuckDB file is not the control plane.

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

The workspace DuckDB file should be used for workspace-scoped data workloads only.

That means:

- `workflow.json` stays the canonical workflow definition
- the Rust backend still owns workflow CRUD and run lifecycle
- DuckDB stores shared workspace tables and workflow-shaped analytical state

## Root Path Model

Within the rooted storage layout from `23_storage_root_and_identity_architecture.md`, each workspace should look like this:

```text
<workspace_id>/
  db/
    workspace.duckdb
  workflows/
    <workflow_id>/
      workflow.json
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
          db/
            workspace.duckdb
          workflows/
            <workflow_id>/
              workflow.json
              files/
                uploads/
                outputs/
                artifacts/
```

## What Happens On Workspace Creation Or Open

When a new workspace is created or an existing workspace is opened, Stitchly should create:

1. the workspace directory
2. `db/`
3. `db/workspace.duckdb`
4. `workflows/`
5. the standard DuckDB schemas

This should happen for:

- newly created workspaces
- existing workspaces missing the workspace DuckDB file
- future imported or restored workspaces

Workflow creation should still create the workflow directory, `workflow.json`, and workflow-local `files/` directories. New workflows should not create workflow-local `db/workflow.duckdb` files. Legacy workflow-local DuckDB files should be cleaned up during storage bootstrap: delete system-only mirror files, quarantine corrupt files, and quarantine files that contain non-system tables.

## Required V1 DuckDB Schemas

Each new workspace database should be initialized with these schemas:

- `runs`
- `staging`
- `tables`
- `outputs`

## Schema Responsibilities

### `runs`

Purpose:

- workspace-scoped run tables
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

The workspace DB bootstrap should at least run:

```sql
create schema if not exists runs;
create schema if not exists staging;
create schema if not exists tables;
create schema if not exists outputs;
```

## Implemented V1 Mirror Tables

Phase 4 added the first concrete run mirror tables; they now live in the workspace DuckDB.

Current implementation note:
- workspace DuckDB run mirroring is feature-flagged behind `STITCHLY_ENABLE_WORKSPACE_RUN_DUCKDB_SYNC`
- the default is `disabled`
- canonical run history remains the control-plane store in SQLite
- set `STITCHLY_ENABLE_WORKSPACE_RUN_DUCKDB_SYNC=1` to enable workspace DuckDB mirroring during debugging or focused development
- `STITCHLY_ENABLE_WORKFLOW_RUN_DUCKDB_SYNC` remains a compatibility fallback

### `runs.workflow_runs`

Purpose:

- one row per workflow run
- quick analytical facts about run duration, status, and error counts
- a workspace-scoped snapshot mirror without replacing the canonical control-plane run tables

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
- workspace-scoped inspection of node status, attempts, log counts, and latest output

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

- first workspace-scoped materialization of node output artifacts
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

The runtime should treat `db/workspace.duckdb` as the workspace analytical store.

Likely early node behavior:

- input nodes may load table-shaped data into `staging`
- transform nodes may read from `staging` or `tables` and write into `tables`
- output nodes may materialize into `outputs`
- run-oriented materializations may write into `runs`
- workflows may read tables created by other workflows in the same workspace

The runtime should resolve the workspace DB path from:

- `user_id`
- `workspace_id`

It should not derive the path from mutable names.

## Cloud Transplant Direction

This model is compatible with the later deployment shape already discussed:

- local disk now
- mounted cloud volume later

The logical path should stay the same.

That means the future move to a DigitalOcean-hosted setup can preserve:

- workspace directory ownership
- `db/workspace.duckdb`
- workflow directory ownership
- `workflow.json`
- `files/`

without forcing a redesign of workspace-scoped storage semantics.

## Known Limits And Deferred Work

This v1 choice intentionally accepts some limits:

- DuckDB is not the shared multi-writer control plane
- canonical run/event/log persistence remains elsewhere
- table export strategy is deferred
- Parquet interoperability is deferred
- retention and cleanup rules for workspace tables are deferred
- legacy workflow-local `db/workflow.duckdb` cleanup is conservative and does not silently merge old user tables into the workspace database; quarantined legacy files can be imported later through an explicit maintenance helper

These should be documented later when we introduce:

- table import/export nodes
- larger ETL workloads
- retention policies
- workspace backup or sync behavior

## Recommended Implementation Order

Before implementation:

1. accept this workspace DuckDB direction
2. confirm the initial schema set:
   - `runs`
   - `staging`
   - `tables`
   - `outputs`

Then implement in this order:

1. storage helper that resolves the workspace DuckDB path
2. workspace creation/open bootstrap that creates:
   - workspace directory
   - `db/workspace.duckdb`
   - `workflows/`
3. DuckDB bootstrap that creates the standard schemas
4. workflow creation bootstrap that creates:
   - workflow directory
   - `workflow.json`
   - `files/`
5. tests proving every new workspace gets the expected directory and DB shape
6. migrate runtime and catalog APIs to the workspace DB while retaining compatibility wrappers during the transition
7. move persisted run mirrors to the workspace DuckDB path
8. clean up legacy workflow-local DuckDB files after the workspace database is canonical

## Review Keys

Use these keys for approval or requested changes:

- `WDB_01`: one DuckDB file per workspace
- `WDB_02`: canonical layout is `<workspace_id>/db/workspace.duckdb` plus per-workflow `workflow.json` and `files/`
- `WDB_03`: control plane stays canonical for workflow metadata and run history
- `WDB_04`: initialize `runs`, `staging`, `tables`, and `outputs` for every workspace database
- `WDB_05`: `workflow.json` stays the canonical workflow graph artifact
