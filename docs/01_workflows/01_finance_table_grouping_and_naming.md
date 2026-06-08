# 01 Finance Table Grouping And Naming

## Purpose

Define how finance workflows should group, name, and publish workflow-local tables so they stay readable and scalable as Stitchly adds:

- multiple sources such as Polygon, Alpaca, Databento, SEC, and FRED
- multiple grains such as daily, 1h, 15m, 5m, 1m, and tick
- enrichments such as indicators, factors, IV surfaces, and event labels
- combined datasets spanning many symbols or multiple upstream providers

## Decision Summary

- keep the current workflow-local schemas: `runs`, `staging`, `tables`, and `outputs`
- do not add provider-specific or grain-specific schemas in v1
- encode table meaning in a predictable tag-based table name
- make grain mandatory for time-series tables
- keep source-specific tables separate until we intentionally build a merged or canonical table
- avoid per-symbol or per-date physical tables because they do not scale

## Schema Fit

The existing workflow-local DuckDB schema set is still the right starting point.

### `runs`

Use for workflow-local run mirrors, execution summaries, and debugging tables.

Do not use this schema for finance datasets.

### `staging`

Use for provider-shaped landing data:

- raw API pulls
- flat-file loads
- lightly parsed payloads before canonicalization

Typical finance examples:

- `staging.equity_bars__1m__polygon__multi_symbol__raw`
- `staging.options_trades__tick__databento__multi_symbol__raw`
- `staging.fundamentals__filing__sec__entity__raw`

### `tables`

Use for durable workflow-owned internal tables:

- normalized source tables
- canonical or composite tables
- enriched feature tables
- reference and symbology tables
- joined datasets used by downstream steps

Typical finance examples:

- `tables.equity_bars__1m__polygon__multi_symbol__normalized`
- `tables.equity_bars__1d__composite__multi_symbol__adjusted`
- `tables.reference_symbols__asof__composite__universe__canonical`
- `tables.equity_features__1d__composite__multi_symbol__features_core`

### `outputs`

Use for published workflow products:

- downstream-facing marts
- strategy-ready signal tables
- user-facing export tables or views

Typical finance examples:

- `outputs.equity_signals__1d__composite__multi_symbol__breakout_v1`
- `outputs.earnings_event_windows__event__composite__multi_symbol__final`

## Recommendation On New Schemas

We should not add new schemas yet.

Schemas should express lifecycle and ownership boundaries, not every finance concept. If we add schemas like `polygon`, `features`, `reference`, `options`, or `daily`, we will create a taxonomy that gets harder to maintain as workflows grow.

For v1, the split should remain:

- `staging` for landed or raw-ish data
- `tables` for durable internal working data
- `outputs` for published workflow outputs

If we later need more separation, it should be because of a real retention, permission, or publication boundary, not just because a dataset has a different grain or provider.

## Naming Grammar

Recommended table name pattern:

`<domain>_<dataset>__<grain>__<source>__<scope>__<variant>`

The schema already tells us lifecycle. The table name should tell us what the data is.

### 1. `domain`

The business area or asset family.

Examples:

- `equity`
- `options`
- `futures`
- `macro`
- `filings`
- `reference`

### 2. `dataset`

The actual data family.

Examples:

- `bars`
- `trades`
- `quotes`
- `nbbo`
- `fundamentals`
- `chain`
- `surface`
- `actions`
- `symbols`
- `features`
- `signals`
- `event_windows`

### 3. `grain`

The observation grain or time shape.

Examples:

- `tick`
- `snapshot`
- `event`
- `filing`
- `asof`
- `1m`
- `5m`
- `15m`
- `1h`
- `1d`

For finance tables, grain should be mandatory unless the table is a purely static lookup.

### 4. `source`

The provider or source family.

Examples:

- `polygon`
- `alpaca`
- `databento`
- `sec`
- `fred`
- `cboe`
- `tradier`
- `composite`

Use `composite` only when the table is intentionally merged or canonicalized across multiple upstream feeds.

### 5. `scope`

The shape of the entity set inside the table.

Examples:

- `multi_symbol`
- `single_symbol`
- `universe`
- `entity`
- `contract`
- `series`

For market data, `multi_symbol` should be the default. We should not create one physical table per ticker.

### 6. `variant`

The processing stage, enrichment pack, or output flavor.

Examples:

- `raw`
- `normalized`
- `adjusted`
- `canonical`
- `features_core`
- `enriched_iv`
- `joined_earnings`
- `breakout_v1`
- `final`

This is the tag that tells us how far the table is from the original source and what special logic was applied.

## Naming Rules

- use lowercase snake case only
- separate major tag groups with double underscores
- keep names stable and descriptive rather than short and cryptic
- do not encode symbol tickers in the table name
- do not encode dates or partitions in the table name
- do not use vague suffixes such as `final_table`, `new`, or `v2`
- do not hide multi-source merges behind a single-provider name

## Grain Rules

Different grains should almost always live in separate tables.

Examples:

- `tables.equity_bars__1m__polygon__multi_symbol__normalized`
- `tables.equity_bars__5m__polygon__multi_symbol__normalized`
- `tables.equity_bars__1d__composite__multi_symbol__adjusted`

This is better than mixing grains in one table because:

- partitioning stays cleaner
- downstream joins stay predictable
- retention and refresh policies can differ by grain
- users can tell from the name what they are querying

### What not to do

Avoid table names like:

- `tables.stock_data`
- `tables.polygon_prices`
- `tables.aapl_5m_bars`

These names hide either the grain, the scope, or both.

## Source Rules

Provider differences matter in finance, so the naming should preserve them.

### Raw and landed layers

Keep source-specific tables separate in `staging`.

Examples:

- `staging.equity_bars__1m__polygon__multi_symbol__raw`
- `staging.equity_bars__1m__alpaca__multi_symbol__raw`

### Normalized internal layers

It is fine to keep source-specific normalized tables in `tables` when provider semantics still matter.

Examples:

- `tables.options_chain__snapshot__polygon__multi_symbol__normalized`
- `tables.options_chain__snapshot__tradier__multi_symbol__normalized`

### Canonical or merged layers

Only use `composite` after explicit merge rules are applied.

Examples:

- `tables.equity_bars__1d__composite__multi_symbol__adjusted`
- `tables.reference_symbols__asof__composite__universe__canonical`

## Enrichment Rules

Enrichments should build from stable base tables and make the enrichment family obvious in the final tag.

Examples:

- `tables.equity_features__1d__composite__multi_symbol__features_core`
- `tables.equity_features__15m__composite__multi_symbol__features_intraday`
- `tables.options_surface__snapshot__polygon__multi_symbol__enriched_iv`

Avoid stuffing every indicator name into the table name. Prefer a stable pack name such as:

- `features_core`
- `features_intraday`
- `signal_breakout_v1`

The exact list of computed columns can live in documentation or table metadata.

## Combined Table Rules

### Multi-symbol data

Multi-symbol should be the normal shape for market datasets.

Use:

- `multi_symbol`

Avoid:

- one table per ticker
- one table per watchlist
- one table per date bucket

### Cross-source tables

If a table combines providers into one canonical set, use `composite` as the source tag.

### Cross-domain joins

If a table joins different data families, the `dataset` and `variant` tags should explain the purpose.

Examples:

- `tables.equity_event_windows__event__composite__multi_symbol__joined_earnings`
- `outputs.equity_signals__1d__composite__multi_symbol__macro_overlay_v1`

## Example Naming Map

| Schema | Example table | What it tells us |
|---|---|---|
| `staging` | `equity_bars__1m__polygon__multi_symbol__raw` | raw 1-minute equity bars from Polygon across many symbols |
| `staging` | `fundamentals__filing__sec__entity__raw` | raw filing-shaped fundamentals from SEC at filing grain |
| `tables` | `equity_bars__1m__polygon__multi_symbol__normalized` | normalized internal table that still preserves Polygon as source |
| `tables` | `equity_bars__1d__composite__multi_symbol__adjusted` | canonical daily bars merged across sources and adjusted |
| `tables` | `reference_symbols__asof__composite__universe__canonical` | durable symbol master or crosswalk table |
| `tables` | `options_surface__snapshot__polygon__multi_symbol__enriched_iv` | options IV surface snapshot derived from Polygon chain data |
| `tables` | `equity_features__15m__composite__multi_symbol__features_intraday` | intraday technical features across many symbols |
| `outputs` | `equity_signals__1d__composite__multi_symbol__breakout_v1` | published daily breakout signal product |
| `outputs` | `earnings_event_windows__event__composite__multi_symbol__final` | published event-study output table |

## Quant Extensions

The same naming convention should hold for quantitative research, feature engineering, labeling, and signal generation.

The main difference is that quant workflows produce more internally generated tables, so the `dataset`, `source`, and `variant` tags need a wider allowed vocabulary.

### Quant dataset tags

Useful additions include:

- `features`
- `labels`
- `signals`
- `factors`
- `risk`
- `predictions`
- `portfolio`
- `universe`

Examples:

- `tables.equity_features__1d__composite__multi_symbol__features_core`
- `tables.equity_labels__1d__composite__multi_symbol__fwd_returns_5d_v1`
- `tables.equity_factors__1d__composite__multi_symbol__cross_sectional_v1`
- `outputs.equity_signals__15m__derived__multi_symbol__breakout_v1`

### Quant source tags

For quant tables, `source` should mean origin family rather than only external vendor.

Recommended values:

- provider tags such as `polygon`, `alpaca`, `databento`, or `fred` for provider-born tables
- `composite` for intentionally merged or canonicalized multi-source tables
- `derived` for internally generated research tables
- `model` for model-produced predictions, scores, or signal outputs

Examples:

- `tables.equity_features__1d__derived__multi_symbol__features_core`
- `tables.equity_predictions__1d__model__multi_symbol__xgb_v1`
- `outputs.equity_signals__1d__model__multi_symbol__production_v1`

### Quant variant tags

The `variant` tag becomes especially important on the quant side because it tells us which feature pack, label definition, factor family, or signal recipe the table represents.

Useful examples:

- `features_core`
- `features_intraday`
- `mom_v1`
- `fwd_returns_5d_v1`
- `alpha_combo_v2`
- `risk_beta_v1`
- `production_v1`

Avoid placing every single indicator name into the table name. Prefer a stable pack or recipe name and keep the exact column list in metadata or documentation.

### Quant table examples

| Schema | Example table | What it tells us |
|---|---|---|
| `tables` | `equity_features__1d__composite__multi_symbol__features_core` | research-ready daily feature pack across many symbols |
| `tables` | `equity_labels__1d__composite__multi_symbol__fwd_returns_5d_v1` | forward-return labels for supervised learning |
| `tables` | `equity_factors__1d__derived__multi_symbol__alpha_combo_v2` | internally generated factor scores |
| `tables` | `equity_risk__1d__derived__multi_symbol__risk_beta_v1` | derived daily risk exposures or beta metrics |
| `tables` | `equity_predictions__1d__model__multi_symbol__xgb_v1` | model-generated prediction scores |
| `outputs` | `equity_signals__15m__model__multi_symbol__production_v1` | published signal table intended for downstream execution or monitoring |

### Quant schema fit

We still do not need extra schemas just because the data is more enriched or more generated.

The same split should hold:

- `staging` for landed source data
- `tables` for normalized, enriched, research, and generated internal tables
- `outputs` for strategy-ready or downstream-facing signal products

If the quant surface grows a lot, the better next step is likely a naming linter and metadata rules, not a new set of DuckDB schemas.

## Minimal Metadata We Should Preserve In Columns

The table name is not enough by itself. Finance tables should usually also carry:

- `source_provider`
- `symbol` or equivalent security identifier
- `event_ts`, `bar_start_ts`, or `trade_date`
- `as_of_ts` when point-in-time correctness matters
- `run_id` or load metadata when debugging ingest behavior

This lets us scale while keeping names stable.

## When We Should Revisit The Schema Set

We should reconsider extra schemas only if one of these becomes true:

- different data classes need different retention or cleanup rules
- outputs need a stronger publication boundary than `outputs`
- some finance datasets become shared across many workflows instead of workflow-local
- access control needs differ by dataset family

Until then, naming plus metadata is the cleaner approach.

## Next Step

This convention is a good candidate for product enforcement in:

- `table_schema` helpers
- `table_output` suggestions
- a naming linter for workflow-local tables
- future catalog or lineage views
