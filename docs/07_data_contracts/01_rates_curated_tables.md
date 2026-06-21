# 01 Rates Curated Tables

## Purpose

Document the first-pass curated table contracts for the DoltHub rates dataset.

These contracts describe the `sql_transform` layer that normalizes provider-shaped `staging` tables into lineage-preserving `staging_curated` tables before durable merge into `tables`.

## Naming Pattern

For this layer, keep source lineage in the table name:

```text
staging_curated.rates__<source_table>__<load_kind>__normalized
```

Durable `table_merge` targets may use cleaner logical names:

```text
tables.<source_table>
```

For U.S. Treasury rates, the durable logical table is:

```text
tables.us_treasury
```

## Shared Metadata Columns

Each transform should preserve the load metadata columns emitted by `load_to_duckdb`:

```sql
source_repo,
source_table,
batch_id,
ingested_at,
bundle_kind,
previous_commit,
current_commit,
delete_rows_present
```

## Table Contracts

### `us_treasury` Snapshot

Source:

```text
staging.rates__us_treasury__snapshot
```

Target:

```text
staging_curated.rates__us_treasury__snapshot__normalized
```

The snapshot source is wide: one row per curve date with one column per tenor.

SQL:

```sql
select
  date as curve_date,
  tenor,
  yield_pct,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from staging.rates__us_treasury__snapshot
unpivot (
  yield_pct for tenor in (
    "1_month",
    "2_month",
    "3_month",
    "6_month",
    "1_year",
    "2_year",
    "3_year",
    "5_year",
    "7_year",
    "10_year",
    "20_year",
    "30_year"
  )
)
```

Durable target:

```text
tables.us_treasury
```

Merge key:

```json
["curve_date", "tenor"]
```

### `us_treasury` Delta

Source:

```text
staging.rates__us_treasury__delta
```

Target:

```text
staging_curated.rates__us_treasury__delta__normalized
```

The delta source is already long: one row per changed curve date and tenor.

SQL:

```sql
select
  curve_date,
  tenor,
  yield_pct,
  change_op,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from staging.rates__us_treasury__delta
```

Durable target:

```text
tables.us_treasury
```

Merge key:

```json
["curve_date", "tenor"]
```

## Table Merge Config

For the bootstrap snapshot flow:

```json
{
  "merge_keys_by_table": {
    "rates__us_treasury__snapshot__normalized": ["curve_date", "tenor"]
  }
}
```

For the recurring delta flow:

```json
{
  "merge_keys_by_table": {
    "rates__us_treasury__delta__normalized": ["curve_date", "tenor"]
  }
}
```

If snapshot and delta normalized tables are merged together as a collection, configure both logical names:

```json
{
  "merge_keys_by_table": {
    "rates__us_treasury__snapshot__normalized": ["curve_date", "tenor"],
    "rates__us_treasury__delta__normalized": ["curve_date", "tenor"]
  }
}
```

## Notes

- Snapshot normalization converts the wide treasury curve into the same long shape used by deltas.
- The durable table should be logical: `tables.us_treasury`, not `tables.rates__us_treasury__snapshot__normalized` or `tables.rates__us_treasury__delta__normalized`.
- Delta rows should retain `change_op` so downstream merge behavior can distinguish inserts, updates, and deletes.
