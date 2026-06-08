# 00 Finance Workflow Ideas

## Purpose

Capture a realistic first-pass list of finance and market-data workflows that Stitchly could support as it grows into a stronger data-ingestion platform.

The goal is not to lock in a roadmap yet. The goal is to pressure-test which workflows are most useful and which node families unlock the most surface area.

## Selection Principles

- prefer real data sources used by quants, technical traders, and research teams
- include both free and paid sources
- bias toward workflows that force reusable ingestion, normalization, and market-data nodes
- keep the workflows close to what a small fund, prop desk, or serious retail quant might actually run

## Candidate Workflow Table

| # | Workflow | Main output | Realistic sources | Source tier | Candidate nodes |
|---|---|---|---|---|---|
| 1 | Point-in-time fundamentals warehouse | normalized 10-Q, 10-K, 20-F financial facts with filing-date history and restatements | SEC EDGAR, Nasdaq Data Link SF1, Polygon Financials | free + paid | `schedule_trigger`, `rest_source`, `bulk_zip_source`, `xbrl_parser`, `entity_match`, `point_in_time_version`, `table_schema`, `table_output` |
| 2 | Daily EOD equity factor mart | adjusted OHLCV, returns, liquidity, and simple factor tables by symbol and trade date | Alpaca stocks, Polygon stocks, Alpha Vantage | free + paid | `schedule_trigger`, `rest_source`, `symbol_universe_source`, `corporate_actions_adjust`, `feature_calc`, `quality_check`, `table_output` |
| 3 | Intraday stock bars lake | 1m, 5m, or 15m bar tables partitioned by session and symbol | Alpaca Market Data, Polygon stocks | free + paid | `schedule_trigger`, `rest_source`, `websocket_source`, `checkpoint`, `bar_resample`, `late_data_reconcile`, `table_output` |
| 4 | Tick and NBBO replay store | raw trades, quotes, and NBBO snapshots for slippage and microstructure research | Databento equities, Polygon flat files | paid | `file_source`, `s3_source`, `archive_extract`, `tick_parser`, `quote_normalize`, `partition_writer`, `table_output` |
| 5 | Options chain and IV surface builder | chain snapshots, strikes, expiries, Greeks, and implied-vol surfaces by timestamp | Polygon options, Databento options, Tradier option chains | paid + account-based | `schedule_trigger`, `rest_source`, `occ_symbol_parser`, `chain_expand`, `underlying_join`, `greeks_calc`, `surface_builder`, `table_output` |
| 6 | Unusual options flow monitor | daily and intraday option-flow signals such as premium skew, sweep activity, and unusual volume | Cboe DataShop Option Sentiment, Cboe Open-Close, Cboe Option Trades, Polygon options trades | paid | `file_source`, `rest_source`, `flow_classifier`, `notional_calc`, `signal_threshold`, `alert_webhook`, `table_output` |
| 7 | Earnings event study pack | event windows, pre/post earnings returns, IV crush labels, and filing-linked datasets | SEC EDGAR, Nasdaq Data Link Zacks earnings datasets, Alpaca news | free + paid | `schedule_trigger`, `filing_source`, `earnings_calendar_source`, `event_window_sampler`, `join_market_data`, `label_builder`, `table_output` |
| 8 | Futures continuous contract engine | front-month and back-adjusted continuous futures curves with roll metadata | CME DataMine, Databento futures and options-on-futures | paid | `file_source`, `contract_calendar`, `root_symbol_map`, `roll_rule`, `back_adjust`, `session_calendar`, `table_output` |
| 9 | Macro and positioning regime store | revision-aware macro series and positioning tables for cross-asset regime models | FRED, ALFRED, Nasdaq Data Link CFTC COT | free + paid | `schedule_trigger`, `rest_source`, `revision_aware_fetch`, `frequency_align`, `series_standardize`, `regime_classifier`, `table_output` |
| 10 | Corporate actions and symbol master | effective-dated splits, dividends, mergers, renames, and symbol crosswalks | Alpaca Corporate Actions, SEC EDGAR, Polygon reference data | free + paid | `rest_source`, `reference_match`, `effective_date_version`, `rename_merge_resolver`, `backfill_repair`, `table_output` |

## Why These Are Good Early Targets

### High leverage workflows

The best early workflows are the ones that force reusable primitives:

- finance APIs almost always require auth, retries, pagination, and rate-limit handling
- market data almost always requires symbol normalization and effective-dated reference tables
- options data quickly forces us to support chain expansion, Greeks, and time-aware joins
- filing and macro workflows force point-in-time correctness instead of naive latest-state joins

### Strong first-wave candidates

If we want the next nodes to unlock the most product surface, the strongest first candidates are:

1. point-in-time fundamentals warehouse
2. daily EOD equity factor mart
3. options chain and IV surface builder

These three together pressure-test:

- API ingestion
- table schema creation
- multi-table outputs
- symbol master logic
- corporate actions adjustments
- point-in-time joins
- quantitative transform nodes

## Likely Node Families To Build Next

### Core ingestion

- `rest_source`
- `websocket_source`
- `file_source`
- `s3_source`
- `archive_extract`
- `checkpoint`

### Market-data normalization

- `symbol_universe_source`
- `occ_symbol_parser`
- `root_symbol_map`
- `reference_match`
- `corporate_actions_adjust`
- `effective_date_version`

### Quant transforms

- `feature_calc`
- `greeks_calc`
- `surface_builder`
- `event_window_sampler`
- `back_adjust`
- `regime_classifier`

### Platform guardrails

- `quality_check`
- `alert_webhook`
- `late_data_reconcile`
- `backfill_repair`

## Realistic Source Pool

- SEC EDGAR APIs: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`
- FRED and ALFRED API: `https://fred.stlouisfed.org/docs/api/fred/overview.html`
- Alpaca Market Data: `https://docs.alpaca.markets/us/docs/about-market-data-api`
- Alpaca Historical Stock Data: `https://docs.alpaca.markets/us/v1.1/docs/historical-stock-data-1`
- Alpaca Corporate Actions: `https://docs.alpaca.markets/us/reference/corporateactions-1`
- Polygon options overview: `https://polygon.io/docs/options/getting-started`
- Polygon stocks overview: `https://polygon.io/docs/rest/stocks/overview`
- Databento docs: `https://databento.com/docs`
- Tradier market data: `https://docs.tradier.com/docs/market-data`
- Tradier option chains: `https://docs.tradier.com/reference/brokerage-api-markets-get-options-chains`
- Nasdaq Data Link data organization: `https://docs.data.nasdaq.com/docs/data-organization`
- CME DataMine: `https://www.cmegroup.com/market-data/datamine-historical-data/index.html`
- Cboe DataShop products: `https://datashop.cboe.com/data-products`
- Cboe Option Sentiment: `https://datashop.cboe.com/option-sentiment`
- Alpha Vantage API documentation: `https://www.alphavantage.co/documentation/`

## Next Step

Once we decide which two or three workflows matter most, we should map them into:

1. required source nodes
2. required transform nodes
3. required sink and schema behaviors
4. minimal end-to-end demo workflows
