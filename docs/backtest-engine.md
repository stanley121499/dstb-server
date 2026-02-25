# Backtest engine spec

## Purpose

Define the **authoritative** behavior of the backtest engine so results are:

- Deterministic
- Comparable across runs
- Transferable to Phase 2 live trading

## Inputs

Each run must capture:

- Strategy parameter payload (see `12-strategy-orb-atr.md`)
- Date range
- Data source settings (yfinance symbol, fetch interval)
- Execution assumptions (fees, slippage, order type model)

## Candle model

Each candle must contain:

- timestamp (UTC)
- open, high, low, close (numbers)
- volume (number, may be 0 or missing)

All numbers must be validated:

- No `NaN`
- High >= max(open, close)
- Low <= min(open, close)
- High >= Low

Invalid candles are either:

- rejected (preferred), or
- skipped with a logged data-quality warning

## Execution model (Phase 1)

We will start with a simplified but explicit model that can be upgraded later.

### Fees

Fees are applied per fill:

- fee = notional * (feeBps / 10_000)

### Slippage

Slippage is applied per fill as a price adjustment:

- For buy fills: fillPrice = rawPrice * (1 + slippageBps / 10_000)
- For sell fills: fillPrice = rawPrice * (1 - slippageBps / 10_000)

### Order type approximation

We will approximate ORB triggers as follows:

- `stop_breakout`:
  - Long: if candle high reaches trigger, assume a fill at trigger (then apply slippage).
  - Short: if candle low reaches trigger, assume a fill at trigger (then apply slippage).
- `close_confirm`:
  - Use candle close as the raw fill price.

This is not perfect, but it is explicit and consistent.

## Portfolio model

### Equity

- Equity starts at `initialEquity` (default: 10,000).
- Equity changes on trade exits (realized PnL).
- Optionally track mark-to-market equity each bar (for more accurate drawdown).

### Position

At most one position at a time (Phase 1 default).

Position contains:

- direction (long/short)
- entry timestamp + entry price
- quantity
- initial stop level + current stop level
- fees paid (entry and exit)

### Sizing modes

#### fixed_notional

- quantity = notional / entryPrice

#### fixed_risk_pct

Let:

- `riskPctPerTrade` = percent of equity to risk
- `riskDollars` = equity * (riskPctPerTrade / 100)
- `stopDistance` = abs(entryPrice - stopPrice)

Then:

- quantity = riskDollars / stopDistance

If stopDistance is 0 or invalid: skip trade and log an error event.

## Strategy evaluation loop

For each bar:

1. Update indicators (ATR) if enough history.
2. Determine session boundaries in `America/New_York` and opening range candles.
3. If opening range completed for the session, compute OR levels (orHigh/orLow/orMid).
4. If flat range (orHigh == orLow) -> skip session.
5. If in a position:
   - Update trailing stop (if enabled)
   - Check stop-loss and take-profit triggers
   - Check time-based exit rule (if enabled)
6. If not in a position:
   - Check filters (ATR filter)
   - Check entry triggers (stop_breakout or close_confirm)
   - If entry triggers, compute stop/TP levels, size trade, create position

## Trigger ordering (intrabar ambiguity)

With candle data (OHLC), multiple levels can be touched in one bar (e.g., TP and SL).

We must define an ordering rule. Default:

- For long positions:
  - If both TP and SL are touched in the same bar, assume SL is hit first (conservative).
- For short positions:
  - Same conservative rule.

This must be documented because it materially affects results.

## Outputs

### Trades

Each trade record must include:

- runId
- session date (NY local date)
- direction
- entry time/price, exit time/price
- quantity
- fees (entry/exit/total)
- realized PnL (dollars) and R-multiple
- exit reason (stop, take_profit, time_exit, session_end, manual)

### Equity curve

Store either:

- per-bar equity (large), or
- compressed series (e.g., per hour/day), plus per-trade equity

### Metrics

At minimum:

- total return
- CAGR (optional for non-daily data)
- max drawdown
- number of trades
- win rate
- profit factor
- avg win, avg loss
- average R, median R

## Bias avoidance (must-haves)

- **No lookahead**:
  - Opening range levels only become available after the opening window ends.
  - ATR must be computed only from prior/current bars, never future bars.
- **Deterministic session mapping**:
  - Always compute session boundaries in `America/New_York`.
  - Never hard-code UTC offsets.







