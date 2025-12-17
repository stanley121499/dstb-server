# Architecture

## Guiding principle

The same **strategy logic** and **parameter model** must power both:

- Backtests (Phase 1)
- Live trading bots (Phase 2)

This prevents a “research vs production” mismatch.

## High-level components

### Backend (Node.js + TypeScript recommended)

- **API layer**: REST endpoints for parameter sets, backtest runs, results, and bot management.
- **Strategy engine**:
  - Indicator calculation (ATR, etc.)
  - ORB logic (session + opening range + entry/exit)
- **Backtest runner**:
  - Data loading and resampling
  - Trade simulation (fills, fees, slippage)
  - Metrics and reporting
- **Job orchestration**:
  - Long-running backtests or grid runs should execute in background jobs.
  - Job status and progress should be observable.
- **Persistence**: Supabase/Postgres (runs, parameters, trades, metrics, logs).

### Frontend (React)

- Parameter builder (forms with sensible defaults and validation)
- Run backtest / run grid
- Results explorer (equity curve, drawdown, trade list, comparisons)
- Phase 2: bot control panel (start/stop, status, logs, positions)

## Data flow (Phase 1)

1. User creates a parameter set in UI.
2. UI calls backend to run a backtest with:
   - Symbol(s)
   - Interval
   - Date range
   - Parameter set ID (or full param payload)
3. Backend loads candles from `yfinance`.
4. Backend normalizes timestamps to UTC and computes session windows using `America/New_York`.
5. Strategy runner produces:
   - Trades
   - Equity curve
   - Summary metrics
6. Backend stores run + artifacts in Supabase.
7. UI fetches run results and renders charts/tables.

## Data flow (Phase 2)

1. User starts a bot from UI using a saved parameter set.
2. Backend creates a bot instance and begins ingesting live candles via exchange adapter.
3. Strategy runner generates signals; execution module places orders.
4. Backend stores orders/fills/positions/logs in Supabase.
5. UI streams bot status and logs; user can stop/restart.

## Critical: timezone and DST handling

- Session anchor is **New York open**: 9:30am `America/New_York`.
- All session calculations must be done in `America/New_York` and then converted to UTC for candle alignment.
- DST must be handled automatically by using IANA timezone rules, not hard-coded offsets.

## Observability

- Structured logs for each run/bot with IDs
- Persisted run/bot events (start, stop, error, config) to Supabase
- (Later) metrics dashboard (counts, durations, errors)


