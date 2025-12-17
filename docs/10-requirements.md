# Requirements

## Product requirements (Phase 1: Backtesting)

### R1. Run ORB + ATR backtests

- The system must run backtests for **BTC** and **ETH** using `yfinance` as the initial data source.
- The strategy must support **ORB anchored to New York open** with **correct DST handling**.
- The strategy must include **ATR** in the logic (configurable usage).

### R2. Parameter sets and grid testing

- The UI must allow users to create, save, and reuse **parameter sets**.
- The system must support:
  - Running a single backtest run
  - Running a **grid** of parameter combinations (batch)
- The system must persist both inputs and outputs for later comparison.

### R3. Results and analytics

The system must produce, at minimum:

- Trades list (entry/exit times, prices, fees, PnL, direction)
- Equity curve
- Summary metrics:
  - Total return
  - Max drawdown
  - Win rate
  - Profit factor
  - Average R
  - Number of trades

### R4. Execution realism (backtest)

Backtests must model:

- Fees (configurable)
- Slippage (configurable)
- A fill model (market/stop/limit assumptions) that is explicitly documented and consistent

### R5. Data intervals

- The UI must allow selecting multiple bar intervals (e.g., 1m/5m/15m/30m/1h/4h/1d).
- The engine must support intervals consistently using a documented approach:
  - Prefer fetching a base interval and resampling up where necessary.

### R6. Supabase persistence

- Supabase/Postgres is the system of record for:
  - Parameter sets
  - Backtest runs
  - Trades
  - Equity curve snapshots (or compressed series)
  - Logs/events
- Migrations must be provided as SQL migration files.

## Product requirements (Phase 2: Live trading)

### L1. Bot lifecycle management

- Create/start/stop/restart bots from the UI.
- Bots must be parameterized using the same parameter model as backtesting.

### L2. Live state visibility

- Bot status (running/stopped/error)
- Current position and unrealized PnL
- Recent orders and fills
- Logs/events stream

### L3. Exchange integration (future)

- Live trading will not use `yfinance`. It will use exchange APIs via an adapter layer.
- The adapter must support:
  - Candle ingestion (or tick aggregation into candles)
  - Order placement and cancellation
  - Balance/position queries

## Non-functional requirements

### NFR1. Determinism and reproducibility

- A backtest run must be reproducible:
  - Same data snapshot (or data checksum)
  - Same parameter set
  - Same engine version

### NFR2. Auditability

- Backtest and live trading actions must be traceable via logs and stored entities.

### NFR3. Security

- AuthN/AuthZ suitable for client usage.
- Phase 1 should use **Supabase Auth** (single-client) using **email + password**.
- Database access controlled with RLS where applicable.

#### Single-client scope (current)

- This project is **single-client** initially.
- RLS is **not required** for Phase 1 unless deployment requirements change.

### NFR4. Compatibility

- Development environment targets Windows 11 (PowerShell) for local work.


