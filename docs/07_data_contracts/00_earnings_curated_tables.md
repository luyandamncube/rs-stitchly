# 00 Earnings Curated Tables

## Purpose

Document the first-pass curated table contracts for the DoltHub earnings dataset.

These contracts describe the `sql_transform` layer that normalizes provider-shaped `staging` tables into lineage-preserving `staging_curated` tables before durable merge into `tables`.

## Naming Pattern

For this layer, keep source lineage in the table name:

```text
staging_curated.earnings__<source_table>__snapshot__normalized
```

Durable `table_merge` targets may use cleaner logical names:

```text
tables.<source_table>
```

For recurring delta flows, use the same normalized shape but replace `snapshot` with `delta` when the upstream physical source is a delta table.

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

## Single-Table Source Overrides

When configuring `sql_transform` in single-table mode, use these source overrides:

```text
staging.earnings__balance_sheet_assets__snapshot
staging.earnings__balance_sheet_equity__snapshot
staging.earnings__balance_sheet_liabilities__snapshot
staging.earnings__cash_flow_statement__snapshot
staging.earnings__earnings_calendar__snapshot
staging.earnings__eps_estimate__snapshot
staging.earnings__eps_history__snapshot
staging.earnings__income_statement__snapshot
staging.earnings__rank_score__snapshot
staging.earnings__sales_estimate__snapshot
```

## Table Contracts

### `sales_estimate`

Single-table source override:

```text
staging.earnings__sales_estimate__snapshot
```

Target:

```text
staging_curated.earnings__sales_estimate__snapshot__normalized
```

SQL:

```sql
select
  date as estimate_date,
  act_symbol as symbol,
  period,
  period_end_date,
  consensus as sales_consensus,
  count as estimate_count,
  high as sales_high,
  low as sales_low,
  year_ago as sales_year_ago,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.sales_estimate
```

Merge key:

```json
["symbol", "estimate_date", "period", "period_end_date"]
```

### `rank_score`

Single-table source override:

```text
staging.earnings__rank_score__snapshot
```

Target:

```text
staging_curated.earnings__rank_score__snapshot__normalized
```

SQL:

```sql
select
  date as rank_date,
  act_symbol as symbol,
  rank as zacks_rank,
  value as value_score,
  growth as growth_score,
  momentum as momentum_score,
  vgm as vgm_score,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.rank_score
```

Merge key:

```json
["symbol", "rank_date"]
```

### `income_statement`

Single-table source override:

```text
staging.earnings__income_statement__snapshot
```

Target:

```text
staging_curated.earnings__income_statement__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  date as statement_date,
  period,
  sales as revenue,
  cost_of_goods as cost_of_revenue,
  gross_profit,
  selling_administrative_depreciation_amortization_expenses as selling_admin_da_expense,
  income_after_depreciation_and_amortization as operating_income_after_da,
  non_operating_income,
  interest_expense,
  pretax_income,
  income_taxes as income_tax_expense,
  minority_interest,
  investment_gains,
  other_income,
  income_from_continuing_operations,
  extras_and_discontinued_operations as discontinued_and_extraordinary_items,
  net_income,
  income_before_depreciation_and_amortization as income_before_da,
  depreciation_and_amortization,
  average_shares,
  diluted_eps_before_non_recurring_items,
  diluted_net_eps,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.income_statement
```

Merge key:

```json
["symbol", "statement_date", "period"]
```

### `eps_history`

Single-table source override:

```text
staging.earnings__eps_history__snapshot
```

Target:

```text
staging_curated.earnings__eps_history__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  period_end_date,
  reported as reported_eps,
  estimate as estimated_eps,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.eps_history
```

Merge key:

```json
["symbol", "period_end_date"]
```

### `eps_estimate`

Single-table source override:

```text
staging.earnings__eps_estimate__snapshot
```

Target:

```text
staging_curated.earnings__eps_estimate__snapshot__normalized
```

SQL:

```sql
select
  date as estimate_date,
  act_symbol as symbol,
  period,
  period_end_date,
  consensus as eps_consensus,
  recent as eps_recent,
  count as estimate_count,
  high as eps_high,
  low as eps_low,
  year_ago as eps_year_ago,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.eps_estimate
```

Merge key:

```json
["symbol", "estimate_date", "period", "period_end_date"]
```

### `earnings_calendar`

Single-table source override:

```text
staging.earnings__earnings_calendar__snapshot
```

Target:

```text
staging_curated.earnings__earnings_calendar__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  date as earnings_date,
  "when" as earnings_time_window,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.earnings_calendar
```

Merge key:

```json
["symbol", "earnings_date"]
```

If the source contains multiple event rows per symbol and date, include `earnings_time_window` in the merge key.

### `cash_flow_statement`

Single-table source override:

```text
staging.earnings__cash_flow_statement__snapshot
```

Target:

```text
staging_curated.earnings__cash_flow_statement__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  date as statement_date,
  period,
  net_income,
  depreciation_amortization_and_depletion,
  net_change_from_assets as net_change_in_operating_assets,
  net_cash_from_discontinued_operations,
  other_operating_activities,
  net_cash_from_operating_activities,
  property_and_equipment as capital_expenditures,
  acquisition_of_subsidiaries,
  investments,
  other_investing_activities,
  net_cash_from_investing_activities,
  issuance_of_capital_stock,
  issuance_of_debt,
  increase_short_term_debt as increase_in_short_term_debt,
  payment_of_dividends_and_other_distributions as dividends_and_distributions_paid,
  other_financing_activities,
  net_cash_from_financing_activities,
  effect_of_exchange_rate_changes,
  net_change_in_cash_and_equivalents,
  cash_at_beginning_of_period,
  cash_at_end_of_period,
  diluted_net_eps,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.cash_flow_statement
```

Merge key:

```json
["symbol", "statement_date", "period"]
```

### `balance_sheet_liabilities`

Single-table source override:

```text
staging.earnings__balance_sheet_liabilities__snapshot
```

Target:

```text
staging_curated.earnings__balance_sheet_liabilities__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  date as statement_date,
  period,
  notes_payable,
  accounts_payable,
  current_portion_long_term_debt,
  current_portion_capital_leases,
  accrued_expenses,
  income_taxes_payable,
  other_current_liabilities,
  total_current_liabilities,
  mortgages,
  deferred_taxes_or_income,
  convertible_debt,
  long_term_debt,
  non_current_capital_leases,
  other_non_current_liabilities,
  minority_interest,
  total_liabilities,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.balance_sheet_liabilities
```

Merge key:

```json
["symbol", "statement_date", "period"]
```

### `balance_sheet_equity`

Single-table source override:

```text
staging.earnings__balance_sheet_equity__snapshot
```

Target:

```text
staging_curated.earnings__balance_sheet_equity__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  date as statement_date,
  period,
  preferred_stock,
  common_stock,
  capital_surplus,
  retained_earnings,
  other_equity,
  treasury_stock,
  total_equity,
  total_liabilities_and_equity,
  shares_outstanding,
  book_value_per_share,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.balance_sheet_equity
```

Merge key:

```json
["symbol", "statement_date", "period"]
```

### `balance_sheet_assets`

Single-table source override:

```text
staging.earnings__balance_sheet_assets__snapshot
```

Target:

```text
staging_curated.earnings__balance_sheet_assets__snapshot__normalized
```

SQL:

```sql
select
  act_symbol as symbol,
  date as statement_date,
  period,
  cash_and_equivalents,
  receivables,
  notes_receivable,
  inventories,
  other_current_assets,
  total_current_assets,
  net_property_and_equipment,
  investments_and_advances,
  other_non_current_assets,
  deferred_charges,
  intangibles,
  deposits_and_other_assets,
  total_assets,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  bundle_kind,
  previous_commit,
  current_commit,
  delete_rows_present
from {{source}}
```

Durable target:

```text
tables.balance_sheet_assets
```

Merge key:

```json
["symbol", "statement_date", "period"]
```

## Table Merge Config

When `table_merge` receives these as a collection, the merge keys should be keyed by normalized logical table name:

```json
{
  "merge_keys_by_table": {
    "earnings__sales_estimate__snapshot__normalized": ["symbol", "estimate_date", "period", "period_end_date"],
    "earnings__rank_score__snapshot__normalized": ["symbol", "rank_date"],
    "earnings__income_statement__snapshot__normalized": ["symbol", "statement_date", "period"],
    "earnings__eps_history__snapshot__normalized": ["symbol", "period_end_date"],
    "earnings__eps_estimate__snapshot__normalized": ["symbol", "estimate_date", "period", "period_end_date"],
    "earnings__earnings_calendar__snapshot__normalized": ["symbol", "earnings_date"],
    "earnings__cash_flow_statement__snapshot__normalized": ["symbol", "statement_date", "period"],
    "earnings__balance_sheet_liabilities__snapshot__normalized": ["symbol", "statement_date", "period"],
    "earnings__balance_sheet_equity__snapshot__normalized": ["symbol", "statement_date", "period"],
    "earnings__balance_sheet_assets__snapshot__normalized": ["symbol", "statement_date", "period"]
  }
}
```
