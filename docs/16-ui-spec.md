# React UI spec (Phase 1 + Phase 2-ready)

## Purpose

Define the UI screens and behaviors so implementation is straightforward and consistent with the backend contracts.

## Navigation (recommended)

- Backtests
  - Parameter Sets
  - Run Backtest
  - Backtest Results
  - Compare Runs
- (Phase 2) Live Bots
  - Bots List
  - Bot Detail (status/logs/position)

## Screen: Parameter Sets

### List

- Display parameter sets (name, symbol default, interval default, last updated)
- Actions:
  - Create new
  - Duplicate
  - Delete (soft delete recommended)

### Editor (create/edit)

Form must map 1:1 to the parameter schema in `12-strategy-orb-atr.md`.

Selection rules:

- **Single-select** where values are mutually exclusive:
  - Entry mode (`stop_breakout` OR `close_confirm`)
  - Direction mode
  - Sizing mode
  - Stop mode
- **Multi-toggle** for independent features that can run together:
  - ATR filter (on/off)
  - Take profit (on/off + settings)
  - Trailing stop (on/off + settings)
  - Time exit (on/off + settings)

Recommended sections:

- **Instrument**
  - Symbol: BTC-USD / ETH-USD
  - Effective interval selector
- **Session**
  - Timezone fixed to `America/New_York` (Phase 1)
  - Session start fixed to 09:30 (Phase 1)
  - Opening range minutes: 5/15/30/60
- **Entry**
  - Direction mode
  - Entry mode
  - Breakout buffer (bps)
  - Max trades per session
- **ATR**
  - ATR length
  - ATR filter (enable + min/max ATR bps)
- **Risk**
  - Sizing mode (fixed notional vs fixed risk pct)
  - Risk % per trade or notional value
  - Stop mode + ATR stop multiple
  - TP mode + TP R multiple
  - Trailing stop mode + ATR trail multiple
  - Time exit settings
- **Execution realism**
  - Fee bps
  - Slippage bps

Default values (recommended):

- Initial equity: 10,000
- Fee: 10 bps
- Slippage: 10 bps

Validation requirements:

- Disallow invalid combos (e.g., sizingMode fixed_risk_pct requires a stop distance)
- Disallow negative bps values
- Ensure `openingRangeMinutes` aligns with interval (e.g., 15 minutes with 1h bars is not meaningful; warn user)

## Screen: Run Backtest

Inputs:

- Choose parameter set OR inline parameters
- Symbol and interval (if not fixed by param set)
- Date range (UTC)
- Initial equity

UX requirements:

- “Run” triggers `POST /v1/backtests`
- If async, show progress status and allow refresh
- Save run and navigate to results

## Screen: Backtest Results

Must show:

- Summary metrics table
- Equity curve chart
- Drawdown chart (optional initially)
- Trades table with filters
- Raw run config (JSON viewer) for reproducibility

## Screen: Compare Runs

Inputs:

- Select multiple backtest runs

Outputs:

- Metrics comparison table
- Overlay equity curves
- Table of “best run” by chosen metric

## Phase 2: Live Bots (future screens)

### Bots list

- Bot name, symbol, interval, status, last heartbeat
- Start/stop actions

### Bot detail

- Current position (if any)
- Recent orders/fills
- Live logs stream
- Current parameter set (read-only by default)


