# 01 Derivatives And Volatility Strategy Research

## Purpose

Capture a first structured direction for what was previously called `3d` trading.

The better name is:

`Derivatives And Volatility Strategy Research`

This is the workflow class focused on:

- ingesting underlying and options market data
- structuring chain, quote, trade, and surface data into research-ready tables
- building volatility and event dashboards
- generating candidate option positions and strategy structures
- evaluating payoff behavior under realistic assumptions
- ranking which symbols, structures, and parameter sets are strongest under different scenarios

This doc is intentionally the derivatives-heavy complement to `00_systematic_technical_strategy_research.md`.

## Why This Name Is Better Than `3d`

`3d` is a useful shorthand, but it is too loose for product and engineering docs.

`Derivatives And Volatility Strategy Research` is better because it makes the scope clearer:

- `derivatives` means options contracts, structures, and position design
- `volatility` means realized vol, implied vol, skew, term structure, and event-driven volatility behavior
- `strategy research` means we are not only building dashboards, but also evaluating trades, structures, and repeatable decision rules

## How This Differs From Technical Strategy Research

The technical-strategy workflow is primarily about:

- price and volume data on the underlying instrument
- indicators and rules on bars
- signal generation and backtests on the underlying itself

This workflow adds a new layer of complexity:

- options contracts and expiries
- strike selection
- delta and moneyness
- IV levels and skew
- multi-leg structures
- event-sensitive entry and exit logic

So this is not just “technical trading but harder.” It is a different research surface with different tables, nodes, and evaluation logic.

## Problem Framing

The naive version of the idea is:

- ingest options and underlying data
- build dashboards for realized versus implied volatility, earnings setups, and directional opportunities
- test position structures such as long calls, long puts, vertical spreads, straddles, or strangles
- find which structure would have made the most money on which symbol

Simple examples include:

- which earnings straddle setup worked best on `AAPL`
- which delta-based call spread performed best on `SPY`
- which symbols showed the best realized-versus-implied volatility dislocations

The broader goal is not just to ask:

- which option structure made the most money once

The broader goal is to answer:

- which structure works best for which symbols
- under which volatility regime
- at which tenor
- at which delta or strike distance
- around which event types
- under which liquidity and cost assumptions

## Real Research Shape

This should not be treated as a flat `symbol x position` matrix.

The real research surface is closer to:

`underlying x option_contract_or_structure x tenor x delta_bucket x event_window x vol_regime x cost_model x exit_rule x evaluation_window`

Examples of dimensions that materially change outcomes:

- weekly versus monthly expiry
- at-the-money versus 25-delta structures
- pre-earnings versus post-earnings entry
- low-IV versus high-IV regimes
- quoted mid assumptions versus realistic fill assumptions

This matters because a poor data model will hide the true dimensionality of options research and create a hard ceiling very early.

## Workflow Class

Canonical research shape:

`schedule_trigger or manual_trigger -> source_extract -> normalize_underlying_data -> normalize_options_chain -> greeks_calc -> surface_builder -> event_enrich -> opportunity_screen -> position_generate -> position_backtest -> strategy_rank -> dashboard_publish -> table_output`

Possible workflow variants:

- historical earnings-event rebuilds
- intraday volatility dashboard refreshes
- overnight opportunity scans
- parameterized position-structure sweeps
- ML-assisted ranking of candidate trades

## What This Workflow Produces

At minimum, this workflow class should eventually produce:

- normalized underlying market tables
- normalized options chain and quote tables
- volatility and surface tables
- event overlay tables
- candidate position tables
- payoff and backtest result tables
- ranking tables
- dashboard-ready tables

Later expansions may also produce:

- scenario grids
- portfolio exposure tables
- hedge recommendations
- ML ranking datasets
- production candidate trade tables

## Recommended Research Layers

This workflow should be modeled as layers rather than one giant option scanner table.

### 1. Underlying market and reference data

Base tables for:

- spot or underlying bars
- corporate actions where relevant
- symbol master or reference mappings
- earnings calendars or other catalysts

### 2. Options chain, quote, and trade data

Provider-shaped and normalized data such as:

- option chains
- quote snapshots
- option trades
- open interest
- volume

### 3. Derived options analytics

Research-ready derived tables such as:

- Greeks
- implied volatility
- realized volatility
- IV versus RV spreads
- term structure
- skew and smile views
- relative richness or cheapness metrics

### 4. Event and regime overlays

Context layers such as:

- earnings windows
- macro event windows
- high-volatility or low-volatility regimes
- trend or directional bias regimes
- session and calendar effects

### 5. Opportunity and dashboard tables

Tables that support workflows such as:

- RV versus IV dashboarding
- earnings-volatility screens
- directional idea screens
- unusual skew or term-structure shifts

### 6. Position design tables

Tables that define or enumerate candidate structures such as:

- long call
- long put
- vertical spread
- straddle
- strangle
- calendar spread

### 7. Backtest and payoff evaluation tables

Tables that answer:

- what the payoff would have been
- how the position behaved through time
- which structures were robust
- whether edge survived realistic transaction assumptions

### 8. Ranking and publication tables

Tables that support:

- structure ranking
- candidate trade selection
- dashboard publication
- downstream monitoring

## Core Considerations Before Building

### 1. Define the unit of truth

We need to be explicit about whether we are evaluating:

- a single option contract
- a chain snapshot
- a structure template
- a specific instantiated position
- or a full trade plan with entry and exit rules

These are not the same thing.

### 2. Lock quote and fill semantics

Options research becomes noisy quickly if fill assumptions are vague.

We should decide early how v1 interprets:

- bid, ask, or mid entry
- slippage above or below mid
- same-snapshot fills versus next-snapshot fills
- open or close exits
- missing or stale quotes

### 3. Treat liquidity as first-class

Options opportunities that look good on paper can disappear once liquidity is considered.

The workflow should be able to incorporate:

- bid-ask spread
- quote freshness
- open interest
- volume
- minimum liquidity thresholds

### 4. Treat tenor and moneyness as first-class

The same directional view can behave very differently depending on:

- days to expiry
- delta bucket
- strike distance
- implied volatility level at entry

So these should be first-class dimensions in both naming and evaluation.

### 5. Treat event timing as first-class

Much of the edge here depends on:

- earnings timing
- macro timing
- pre-event entry
- post-event unwind
- volatility crush behavior

This makes event overlays far more important here than in pure technical strategy research.

### 6. Model position lifecycle realistically

We need to be explicit about:

- entry rule
- adjustment rule if any
- exit rule
- time stop
- profit-taking
- expiration handling

Later phases may also need to consider assignment and early exercise behavior, but that does not need to be in v1.

### 7. Avoid combinatorial explosion

The structure search space can explode across:

- symbols
- expiries
- strikes
- structure types
- parameter sets
- exit rules

So v1 should likely generate a constrained candidate set first, then evaluate those candidates, rather than brute-forcing every possible contract combination.

## Recommended V1 Scope

The v1 version should stay narrow.

Recommended first boundary:

- start with liquid US equity or ETF options
- one main options provider
- one event type such as earnings
- two or three structure families at most
- snapshot or end-of-day research before full intraday complexity

Good starter structure families:

- `long_call`
- `long_put`
- `call_spread`
- `put_spread`
- `straddle`

Good starter workflow themes:

- directional calls and puts
- vertical spread ranking
- earnings straddle research
- IV versus RV opportunity screens

This is enough to pressure-test the platform without immediately exploding into every possible multi-leg options strategy.

## Candidate Table Families

Using the naming convention from `../01_workflows/01_finance_table_grouping_and_naming.md`, this workflow would naturally produce tables like:

- `staging.options_chain__snapshot__polygon__multi_symbol__raw`
- `tables.options_chain__snapshot__polygon__multi_symbol__normalized`
- `tables.options_surface__snapshot__derived__multi_symbol__iv_surface_core`
- `tables.options_regimes__event__derived__multi_symbol__earnings_overlay_v1`
- `tables.options_screens__snapshot__derived__multi_symbol__rv_iv_opportunities_v1`
- `tables.options_positions__snapshot__derived__multi_symbol__call_spread_candidates_v1`
- `tables.options_backtests__event__derived__multi_symbol__earnings_straddle_v1`
- `tables.options_rankings__event__model__multi_symbol__selection_v1`
- `outputs.options_dashboards__snapshot__model__multi_symbol__rv_iv_monitor_v1`

Equivalent directional examples:

- `tables.options_positions__snapshot__derived__multi_symbol__long_call_candidates_v1`
- `tables.options_backtests__snapshot__derived__multi_symbol__directional_calls_v1`
- `outputs.options_signals__snapshot__model__multi_symbol__candidate_trades_v1`

## Candidate Nodes This Workflow Would Force

### Ingestion and normalization

- `rest_source`
- `websocket_source`
- `checkpoint`
- `occ_symbol_parser`
- `chain_expand`
- `quote_normalize`
- `event_calendar_source`

### Research transforms

- `greeks_calc`
- `surface_builder`
- `realized_vol_calc`
- `vol_regime_label`
- `opportunity_screen`
- `position_generate`
- `scenario_grid`

### Evaluation and ranking

- `position_backtest`
- `event_window_sampler`
- `parameter_sweep`
- `strategy_rank`
- `experiment_compare`

### Publication and monitoring

- `dashboard_materialize`
- `table_schema`
- `table_output`
- `quality_check`
- `alert_webhook`

## What This Is Not

This workflow class is not yet meant to cover:

- institutional portfolio optimization across large books
- full market-making or volatility-arbitrage infrastructure
- high-frequency options execution systems
- broker-integrated live trade routing

Those may eventually grow from this foundation, but they should not define the first version.

## Open Questions

- Should v1 start with earnings-event strategies or simpler directional structures first?
- Should we focus on US equity options first, or later include crypto options as a separate track?
- How much of the volatility surface should be materialized versus derived on demand?
- Do we store only structure-level summaries, or also path-level PnL through the life of each position?
- How do we rank strategies when payoffs are asymmetric and sample sizes are small?

## Recommended Next Step

After this doc, the next useful follow-on would be a concrete workflow design that narrows this into:

1. one asset family
2. one options provider set
3. one starter structure pack
4. one minimal table graph
5. one first-pass node list
