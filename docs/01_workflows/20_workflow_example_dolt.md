# 20 Workflow Example Dolt

## Purpose

Capture the DoltHub earnings ingest as a concrete Stitchly workflow example and use it to pressure-test the node model.

## Workflow Class

This is a source-to-warehouse ingest flow with optional downstream warehouse-native transforms.

Canonical shape:

`schedule_trigger -> source_extract -> load -> sql_transform -> table_output`

In this example, the source is a DoltHub repository and the warehouse sink is likely ClickHouse.

## DoltHub Earnings Ingest

### Source Workflow Today

The current external flow looks like:

1. install `dolt`
2. clone the DoltHub repo
3. dump the repository tables as CSV
4. load the generated CSV files into downstream storage or query engines

The output files are:

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

### How This Should Work In Stitchly

The clean Stitchly version is:

`manual_trigger or schedule_trigger -> dolt_repo_source -> dolt_dump_csv -> load_to_clickhouse -> sql_transform -> table_output`

This keeps the frontend semantic while the Rust backend handles the actual Dolt and ClickHouse integration through adapters.

### Recommended Nodes

1. `manual_trigger` or `schedule_trigger`
2. `dolt_repo_source`
3. `dolt_dump_csv`
4. `load`
5. `sql_transform`
6. `table_output`
7. optional `quality_check`

### Node Responsibilities

#### 1. `manual_trigger` or `schedule_trigger`

Starts the pipeline either on demand or on a recurring schedule.

Typical config:

- cron or interval
- optional run parameters such as repo ref or table subset
- retry and backfill policy

#### 2. `dolt_repo_source`

Represents the source repository rather than a raw shell command.

Typical config:

- connection reference such as `dolthub_public`
- repo name such as `post-no-preference/earnings`
- branch or commit ref
- clone mode such as full or incremental when supported

Output:

- `dataset_ref` or `directory_ref` representing the checked-out repository state

#### 3. `dolt_dump_csv`

Materializes the Dolt tables as CSV artifacts.

Typical config:

- export format, initially `csv`
- selected tables or `all_tables`
- artifact sink for raw files
- file naming strategy

Output:

- `directory_ref` for the dumped CSV bundle
- metadata manifest describing table names, paths, and row counts when available

This node is the typed equivalent of:

`dolt dump -r csv`

#### 4. `load`

Loads the dumped CSV files into a target engine such as ClickHouse.

Typical config:

- target connection such as `clickhouse_market_data`
- target database such as `raw_stock`
- table mapping strategy
- write mode such as `replace`, `append`, or `merge`
- schema inference or explicit schema mapping

Suggested table mapping for this example:

- `balance_sheet_assets.csv -> raw_stock.dolthub_balance_sheet_assets`
- `cash_flow_statement.csv -> raw_stock.dolthub_cash_flow_statement`
- `earnings_calendar.csv -> raw_stock.dolthub_earnings_calendar`

Output:

- one or more `table_ref` values for the loaded raw tables

#### 5. `sql_transform`

Builds curated or analytics-ready tables inside ClickHouse.

Typical config:

- engine set to `clickhouse`
- source table references from the previous node
- SQL text, templated SQL, or named workload reference
- materialization target such as `staging`, `intermediate`, or `mart`

Examples:

- normalize column names
- cast numeric fields
- union or join statements across earnings-related tables
- build a final earnings calendar table for querying

#### 6. `table_output`

Declares the final sink tables the workflow is responsible for producing.

Typical config:

- target connection
- target database and table names
- persistence contract such as temporary, staging, or durable
- metadata labels such as dataset owner or domain

Examples:

- `analytics.earnings_calendar_curated`
- `analytics.company_financials_quarterly`

#### 7. `quality_check`

Optional guardrail node that verifies the load or transform succeeded before declaring the run healthy.

Examples:

- row count above zero
- required columns present
- primary key uniqueness expectations
- no nulls in required fields

## How Inputs Should Work In The Platform

Inputs should be split across three layers:

### 1. Workflow Definition

The saved workflow should contain the semantic structure:

- which source node to use
- which tables to export
- which engine to load into
- which sink tables to produce

### 2. Backend-Managed Connections

The workflow should reference connections by ID rather than embedding secrets.

Examples:

- `dolthub_public`
- `clickhouse_market_data`
- `s3_raw_landing`

The Rust backend resolves these connection references at runtime.

### 3. Run Parameters

Some values should be overridable at run time.

Examples:

- repo branch or commit
- selected table subset
- target dataset suffix such as `dev` or `prod`
- backfill date or partition range

## How Sinks Should Work In The Platform

Stitchly should support at least two sink classes.

### Artifact Sinks

Use these when you want raw files preserved.

Examples:

- local filesystem path
- managed run artifacts
- object storage such as S3-compatible buckets

For the DoltHub example, the CSV dump node should usually write to a raw artifact sink first, even if the data will later be loaded into ClickHouse.

### Table Sinks

Use these when you want queryable data in an engine.

Examples:

- ClickHouse tables
- Postgres tables
- DuckDB-managed outputs

For the DoltHub example, the main durable sink is likely a set of ClickHouse raw tables plus curated analytics tables.

## Recommended V1 Approach

For a first implementation, this flow should probably use dedicated typed nodes such as `dolt_repo_source`, `dolt_dump_csv`, and `load`.

That is better than relying on a generic shell-command node because typed nodes are easier to validate, safer to sandbox, easier to observe, and much easier to retarget later if the execution strategy changes.

If we need a very early prototype before those nodes exist, we could temporarily model the Dolt steps with a custom code node or an internal-only process node, but that should not be the preferred long-term platform shape.
