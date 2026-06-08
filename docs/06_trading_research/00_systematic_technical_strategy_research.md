# 00 Systematic Technical Strategy Research

## Purpose

Capture a first structured direction for what was previously called `2d` trading.

The better name is:

`Systematic Technical Strategy Research`

This is the workflow class focused on:

- ingesting underlying market data
- structuring it into research-ready tables
- computing indicators and feature packs
- generating rule-based strategy signals
- evaluating those signals through realistic backtests
- ranking which strategies and parameter sets work best for which symbols, grains, and regimes

This doc is intentionally about the technical-strategy side only. It does not yet try to cover the more options-heavy and dashboard-heavy quant side that should later live in a separate workflow doc.

## Problem Framing

The naive version of the idea is:

- take many symbols or pairs
- apply many indicator-driven strategies
- sweep parameter combinations
- evaluate which setup would have performed best
- use the resulting dataset to design or optimize future strategies

A simple example is:

- `BTCUSD`
- strategy family: `ema_cross`
- parameters: fast and slow window combinations
- output: buy and sell signals plus backtest metrics

The broader goal is not just to ask:

- which EMA windows worked best on `BTCUSD`

The broader goal is to answer:

- which strategy family worked best on which symbols
- at which grain
- during which market regime
- under which cost assumptions

## Real Research Shape

This should not be treated as a flat `symbol x strategy` matrix.

The real research surface is closer to:

`symbol x venue x grain x strategy_family x parameter_set x regime x cost_model x evaluation_window`

Examples of dimensions that materially change outcomes:

- `BTCUSD` on one venue versus another
- `1d` versus `1h` versus `15m`
- trending versus choppy or high-volatility regimes
- fee-free assumptions versus realistic fees and slippage

This matters because the wrong data model will make the system look simpler than it is and later create painful rewrites.

## Workflow Class

Canonical research shape:

`schedule_trigger or manual_trigger -> source_extract -> normalize_market_data -> feature_calc -> signal_generate -> strategy_backtest -> strategy_rank -> table_output`

Possible workflow variants:

- batch historical rebuilds
- incremental daily or hourly updates
- strategy re-ranking after new data arrives
- offline ML-assisted parameter search

## What This Workflow Produces

At minimum, this workflow class should eventually produce:

- normalized price and volume tables
- indicator and feature tables
- signal tables
- backtest result tables
- strategy ranking tables
- selection tables for candidate live strategies

Later expansions may also produce:

- regime labels
- forward-return label tables
- ML training datasets
- strategy metadata and experiment registries

## Recommended Research Layers

This workflow should be modeled as layers rather than one giant dataset.

### 1. Base market data

Provider-shaped historical data from sources such as:

- Polygon
- Alpaca
- Databento
- Binance or other crypto venues later

Examples:

- bars
- trades
- quotes

### 2. Normalized market data

Durable standardized tables where:

- timestamp semantics are consistent
- column names are normalized
- venue and provider details are preserved where needed
- symbol identity is stable

### 3. Features and indicators

Research-ready derived tables such as:

- EMA and SMA families
- RSI
- ATR
- VWAP
- rolling volatility
- breakout levels
- volume features

### 4. Signal tables

Tables that store strategy outputs such as:

- buy or sell state
- entry or exit events
- long or flat state
- short or flat state
- confidence or score if applicable

### 5. Backtest result tables

Tables that evaluate strategy behavior under explicit assumptions:

- entry timing
- exit timing
- fees
- slippage
- position sizing
- stop or take-profit rules

### 6. Ranking and selection tables

Tables that answer:

- which strategy family ranked highest
- which parameter set was strongest
- which setups were robust rather than lucky
- which candidates deserve promotion to monitoring or paper trading

## Core Considerations Before Building

### 1. Define the unit of truth

We need to be explicit about whether we are evaluating:

- indicators
- signals
- full strategies
- or production-ready tradable systems

These are not the same thing.

An indicator table should not be confused with a tradable result table.

### 2. Lock execution semantics

Backtests are meaningless if signal timing is ambiguous.

We should decide early how v1 interprets:

- signal generated at bar close
- execution at same close versus next open
- intrabar fills versus bar-based fills
- long-only versus long-short handling

### 3. Model realistic costs

Even a simple technical research system needs:

- fees
- spread assumptions
- slippage assumptions
- borrow or funding considerations later where relevant

Without this, the system will overstate edge.

### 4. Prevent research bias

The workflow should explicitly guard against:

- lookahead bias
- survivorship bias
- data leakage
- parameter overfitting
- using future-derived regimes to explain past trades

### 5. Treat regime as first-class

The same strategy will often behave differently in:

- trending markets
- range-bound markets
- high-volatility periods
- low-volatility periods
- specific sessions or trading hours

So selection should eventually be conditional on regime, not just unconditional average performance.

### 6. Avoid one giant wide matrix

A huge materialized table with every strategy and parameter combination as columns will not scale well.

Prefer long-form experiment tables keyed by fields such as:

- `symbol`
- `venue`
- `grain`
- `strategy_id`
- `strategy_family`
- `parameter_set_id`
- `regime_id`
- `evaluation_window`
- `run_id`

## Recommended V1 Scope

The v1 version should stay narrow.

Recommended first boundary:

- one asset family such as `crypto` or `equity`
- one or two providers
- two or three grains at most, such as `1d`, `1h`, and `15m`
- three to five strategy families at most
- bar-based execution only

Good starter strategy families:

- `ema_cross`
- `breakout`
- `rsi_reversion`
- `trend_filter_pullback`

This is enough to pressure-test the platform without exploding the experiment space too early.

## Candidate Table Families

Using the naming convention from `01_finance_table_grouping_and_naming.md`, this workflow would naturally produce tables like:

- `staging.crypto_bars__1h__polygon__multi_symbol__raw`
- `tables.crypto_bars__1h__polygon__multi_symbol__normalized`
- `tables.crypto_features__1h__derived__multi_symbol__features_core`
- `tables.crypto_signals__1h__derived__multi_symbol__ema_cross_v1`
- `tables.crypto_backtests__1h__derived__multi_symbol__walkforward_v1`
- `tables.crypto_rankings__1d__derived__multi_symbol__strategy_selection_v1`
- `outputs.crypto_signals__1h__model__multi_symbol__candidate_live_v1`

Equivalent equity examples:

- `tables.equity_bars__1d__composite__multi_symbol__adjusted`
- `tables.equity_features__1d__derived__multi_symbol__features_core`
- `tables.equity_labels__1d__derived__multi_symbol__fwd_returns_5d_v1`
- `tables.equity_backtests__1d__derived__multi_symbol__walkforward_v1`
- `outputs.equity_strategy_rankings__1d__model__multi_symbol__selection_v1`

## Candidate Nodes This Workflow Would Force

### Ingestion and normalization

- `rest_source`
- `websocket_source`
- `checkpoint`
- `symbol_universe_source`
- `corporate_actions_adjust`
- `bar_resample`

### Research transforms

- `feature_calc`
- `indicator_pack`
- `signal_generate`
- `regime_label`
- `forward_return_label`

### Evaluation and ranking

- `strategy_backtest`
- `parameter_sweep`
- `walkforward_split`
- `strategy_rank`
- `experiment_compare`

### Publication and monitoring

- `table_schema`
- `table_output`
- `quality_check`
- `alert_webhook`

## What This Is Not

This workflow class is not yet meant to cover:

- options position design
- IV surface analysis
- earnings or volatility dashboards
- portfolio optimization across option structures
- multi-leg option payoff search

Those belong to the more derivatives-heavy workflow class that should be documented separately.

## Open Questions

- Should v1 start with crypto because symbols and sessions are simpler, or equity because later research depth is richer?
- How much of the experiment space should be materialized versus computed on demand?
- Do we store only summary metrics for each parameter sweep, or also every simulated trade?
- Should regime classification be rule-based first, ML-based later, or both from the start?
- How should candidate live strategies be promoted from `tables` into `outputs`?

## Recommended Next Step

After this doc, the next useful follow-on would be a concrete workflow design that narrows this into:

1. one asset family
2. one provider set
3. one starter strategy pack
4. one minimal table graph
5. one first-pass node list
