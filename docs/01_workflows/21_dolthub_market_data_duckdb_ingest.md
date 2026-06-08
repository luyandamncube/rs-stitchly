# 21 DoltHub Market Data Ingest Into DuckDB

## Purpose

Capture how Stitchly should ingest the free DoltHub market datasets into workflow-local DuckDB storage, with a focus on:

- large initial loads
- efficient recurring reingestion
- append-friendly raw landing
- durable normalized tables for downstream research

This doc is the DuckDB-oriented complement to `20_workflow_example_dolt.md`.

## Source Scope

The first source set is a group of free DoltHub repositories maintained by `post-no-preference`.

The current manual process is:

1. install `dolt`
2. clone each repo
3. dump each repo's tables as CSV files
4. load those CSV files into a local engine

Initial repositories:

### Earnings

Repository:

- `post-no-preference/earnings`

Tables dumped today:

- `balance_sheet_assets.csv`
- `balance_sheet_equity.csv`
- `balance_sheet_liabilities.csv`
- `cash_flow_statement.csv`
- `earnings_calendar.csv`
- `eps_estimate.csv`
- `eps_history.csv`
- `income_statement.csv`
- `rank_score.csv`
- `sales_estimate.csv`

### Options

Repository:

- `post-no-preference/options`

Tables dumped today:

- `option_chain.csv`
- `volatility_history.csv`

### Rates

Repository:

- `post-no-preference/rates`

Tables dumped today:

- `us_treasury.csv`

Expected scale:

- roughly `14 GB` across the first source set

## Key Product Decision

If the target engine is DuckDB, Stitchly should support the user's current CSV-based flow, but it should not treat CSV as the best long-term interchange format.

Dolt supports exporting tables in:

- `csv`
- `json`
- `parquet`
- `sql`

For DuckDB, `parquet` should likely become the preferred export format for bulk loads, while `csv` remains important for compatibility and first-pass implementation.

Relevant Dolt docs:

- CLI commands and `dolt dump`: `https://docs.dolthub.com/cli-reference/cli`
- Dolt CSV export API: `https://www.dolthub.com/docs/products/dolthub/api/csv/`
- Dolt diffs and diff system tables: `https://www.dolthub.com/docs/concepts/dolt/git/diff/`
- Dolt system tables: `https://docs.dolthub.com/sql-reference/version-control/dolt-system-tables`

## Core Ingestion Principle

We should treat append-only as a property of the raw landing layer, not as a blind write policy for every final table.

Why:

- some upstream Dolt tables are likely append-mostly
- some are likely revised in place
- some may receive deletions or schema changes

So the Stitchly design should be:

- append-only raw batches into `staging`
- merge, upsert, or rebuild into durable `tables`
- publish selected outputs into `outputs`

This gives us both efficiency and correctness.

## Recommended DuckDB Schema Placement

### `staging`

Use for landed batch data and raw extracted files.

Examples:

- `staging.fundamentals__filing__dolthub__entity__raw_batch`
- `staging.options_chain__snapshot__dolthub__multi_symbol__raw_batch`
- `staging.rates_curve__1d__dolthub__series__raw_batch`

Each landed batch should carry metadata columns such as:

- `source_repo`
- `source_table`
- `source_commit`
- `ingested_at`
- `batch_id`

### `tables`

Use for normalized durable source tables and ingest checkpoints.

Examples:

- `tables.fundamentals__filing__dolthub__entity__normalized`
- `tables.options_chain__snapshot__dolthub__multi_symbol__normalized`
- `tables.rates_curve__1d__dolthub__series__normalized`
- `tables.ingest_checkpoints__asof__derived__entity__dolthub_v1`

### `outputs`

Use for curated downstream products once the raw ingests are stable.

Examples:

- `outputs.earnings_event_windows__event__composite__multi_symbol__final`
- `outputs.options_dashboards__snapshot__model__multi_symbol__rv_iv_monitor_v1`

## Recommended Workflow Split

Do not build one giant workflow for all repos.

Recommended first split:

- one workflow for `earnings`
- one workflow for `options`
- one workflow for `rates`

Why:

- refresh cadence may differ
- table mutability patterns differ
- failures should isolate cleanly
- schema changes in one repo should not block the others

## Recommended Stitchly Workflow Shape

### Bootstrap workflow

Use for first load or full rebuild.

Canonical shape:

`manual_trigger -> dolt_repo_source -> dolt_dump -> load_to_duckdb_staging -> sql_transform -> table_merge -> checkpoint_write -> table_output`

### Recurring sync workflow

Use for scheduled updates after the initial bootstrap.

Canonical shape:

`schedule_trigger -> checkpoint_read -> dolt_repo_sync -> dolt_change_manifest -> dolt_diff_export or dolt_dump_changed_tables -> load_to_duckdb_staging -> table_merge -> checkpoint_write -> quality_check`

## Candidate Nodes We Would Need

### 1. `dolt_repo_source`

Purpose:

- clone a Dolt repo for first use
- optionally shallow-clone when appropriate
- emit repo metadata and current commit

Typical config:

- connection ref such as `dolthub_public`
- repo path such as `post-no-preference/earnings`
- branch, usually `main` or `master`
- clone mode such as `full`, `depth_1`, or `read_tables`
- local cache or artifact path policy

Output:

- `dataset_ref` or repo ref
- current commit id

### 2. `dolt_repo_sync`

Purpose:

- update an existing local repo copy from remote
- resolve the previous and current commit range for ingestion

Typical config:

- repo ref from `dolt_repo_source`
- sync mode such as `pull` or `fetch_and_checkout`

Output:

- previous commit id
- current commit id
- changed refs summary

This is separate from clone because reingestion should not need to recreate the repo every run.

### 3. `dolt_change_manifest`

Purpose:

- determine which tables changed between the last synced commit and the current commit
- collect row-change summaries where possible

Typical config:

- previous commit
- current commit
- selected tables or `all_tables`

Output:

- manifest of changed tables
- change counts per table
- schema-changed flags where possible

This node would likely use Dolt diff metadata and system tables under the hood.

### 4. `dolt_dump`

Purpose:

- export whole tables from a Dolt repo into files

Typical config:

- output format: `csv` or `parquet`
- selected tables or `all_tables`
- output directory policy

Output:

- `directory_ref`
- table manifest with file paths and row counts when known

This should likely replace the overly specific `dolt_dump_csv` idea with a more general export node.

### 5. `dolt_diff_export`

Purpose:

- export only changed rows or changed tables between two commits

Typical config:

- previous commit
- current commit
- table selection
- export format
- change filter such as `added`, `modified`, `removed`, or `all`

Output:

- `directory_ref` of per-table deltas
- delta manifest

This is the key efficiency node for reingestion.

### 6. `load_to_duckdb`

Purpose:

- load exported files into DuckDB staging tables

Typical config:

- target schema, usually `staging`
- file format handling
- schema inference or explicit schema mapping
- batch metadata columns to stamp on ingest

Output:

- one or more `table_ref` values

### 7. `table_merge`

Purpose:

- reconcile landed batches into durable `tables`

Typical config:

- merge key definition
- write policy such as `append_only`, `upsert`, or `snapshot_replace`
- schema drift behavior

Output:

- durable normalized `table_ref`

### 8. `checkpoint_read` and `checkpoint_write`

Purpose:

- track the last successful commit per repo or per table

Minimal checkpoint fields:

- `source_repo`
- `branch`
- `table_name` if table-level checkpointing is needed later
- `last_synced_commit`
- `last_success_at`
- `last_ingest_mode`

## Recommended Ingestion Policies By Table Type

Not all tables should use the same write mode.

### Policy 1: `append_only`

Use when rows are expected to only accumulate and stable keys exist.

Likely candidates:

- some history-style tables
- some rates history tables
- some volatility history tables

### Policy 2: `upsert`

Use when rows may be revised in place but stable business keys exist.

Likely candidates:

- `earnings_calendar`
- `eps_estimate`
- `sales_estimate`
- some statement tables if corrections or restatements occur
- `option_chain`

### Policy 3: `snapshot_replace`

Use when a table behaves more like a full current-state snapshot than a durable append log.

Likely candidates:

- highly mutable current chain views
- tables without a safe merge key
- tables with broad row churn between commits

## Efficient Reingestion Direction

### V1 pragmatic path

For the first implementation:

1. bootstrap each repo with a full export
2. land the files into `staging`
3. merge into durable `tables`
4. store the synced commit in a checkpoint table
5. on later runs, sync the repo and identify changed tables
6. re-export only changed tables if row-level diff export is not ready yet

This is not perfect row-level incrementality, but it is still much better than re-dumping all repos every run.

### V2 better path

Once Dolt-specific diff export exists:

1. sync repo to current commit
2. compare previous checkpoint commit to current commit
3. export row-level deltas for changed tables
4. append deltas into `staging`
5. merge or apply deletes into `tables`
6. advance checkpoint only after success

This is the cleanest long-term ingest model.

## Important Practical Note

Pure append-only writes are not always correct for mutable source tables.

For example:

- `option_chain` is likely snapshot-like and highly mutable
- `earnings_calendar` may be revised
- estimates may be updated before release

So the safe design is:

- append-only landing in `staging`
- policy-aware reconciliation in `tables`

That keeps reingestion efficient without corrupting downstream data.

## CSV Versus Parquet In Stitchly

If we mirror the exact manual flow, `csv` is the simplest first implementation.

However, if the target is DuckDB and the source exporter supports it, `parquet` should likely become the preferred bulk path because it improves:

- load speed
- disk efficiency
- type fidelity
- downstream scan performance

Recommended product direction:

- support `csv` first if that is the fastest path to a working node
- make `dolt_dump` format-configurable from day one
- switch heavy bulk DuckDB workflows to `parquet` as soon as practical

## Candidate V1 Workflow Definitions

### Earnings

`manual_trigger or schedule_trigger -> dolt_repo_source -> dolt_dump(all_tables) -> load_to_duckdb(staging) -> sql_transform -> table_merge -> checkpoint_write`

### Options

`manual_trigger or schedule_trigger -> dolt_repo_source -> dolt_dump(all_tables) -> load_to_duckdb(staging) -> sql_transform -> table_merge -> checkpoint_write`

### Rates

`manual_trigger or schedule_trigger -> dolt_repo_source -> dolt_dump(all_tables) -> load_to_duckdb(staging) -> sql_transform -> table_merge -> checkpoint_write`

After incremental support exists, each should move to:

`schedule_trigger -> checkpoint_read -> dolt_repo_sync -> dolt_change_manifest -> dolt_diff_export or dolt_dump(changed_tables) -> load_to_duckdb(staging) -> table_merge -> checkpoint_write`

## What We Should Not Do

- do not re-clone every repo from scratch on every run
- do not re-dump all tables from all repos if only one table changed
- do not blindly append mutable snapshot tables into final durable tables
- do not mix raw landing, normalized tables, and final outputs into one schema
- do not force all repos into one workflow

## Recommended Next Step

The best next concrete step would be to draft the first node contract set for:

1. `dolt_repo_source`
2. `dolt_repo_sync`
3. `dolt_change_manifest`
4. `dolt_dump`
5. `dolt_diff_export`
6. `load_to_duckdb`
7. `table_merge`
