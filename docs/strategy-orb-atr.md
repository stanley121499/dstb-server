# Strategy Spec: ORB + ATR (NY Open, DST-aware)

## Purpose

This document defines the **exact strategy behavior** and all configurable options for:

- Backtesting (Phase 1)
- Live trading (Phase 2)

Any implementation must follow this spec so results transfer from backtest to live.

## Instruments (Phase 1)

- BTC (via `yfinance` symbol `BTC-USD`)
- ETH (via `yfinance` symbol `ETH-USD`)

## Session definition (critical)

Crypto trades 24/7. We define a “session” anchored to **New York open** to mimic the US equities opening session concept.

- **Session timezone**: `America/New_York`
- **Session start time**: 09:30 (9:30am NY time)
- **DST handling**: Must use IANA timezone rules (EDT vs EST changes UTC offset).

### Example conversions (for intuition only)

- During EDT (UTC-4): 09:30 NY ≈ 13:30 UTC
- During EST (UTC-5): 09:30 NY ≈ 14:30 UTC

Do not hard-code these conversions.

## Opening range definition

### Parameter: `openingRangeMinutes`

The opening range window begins at the session start (09:30 NY) and ends after `openingRangeMinutes`.

Common values to test:

- 5, 15, 30, 60

### Opening range levels

For each session day:

- `orHigh` = max High during opening window
- `orLow` = min Low during opening window
- Optional: `orMid` = (orHigh + orLow) / 2

## ATR definition

### Parameter: `atrLength`

Default common value: 14

### True range (TR)

For each bar \(t\):

- TR = max(
  - High - Low,
  - abs(High - prevClose),
  - abs(Low - prevClose)
)

### ATR smoothing

Use **Wilder’s smoothing** (industry standard):

- Initial ATR at t0: mean(TR over first `atrLength` bars)
- Subsequent ATR:
  - ATR[t] = (ATR[t-1] * (atrLength - 1) + TR[t]) / atrLength

## Entry logic (ORB)

### Parameter: `directionMode`

Options:

- `long_only`
- `short_only`
- `long_short`

### Parameter: `entryMode`

Options:

- `stop_breakout`:
  - Long entry triggers when price trades above `orHigh` (plus buffer).
  - Short entry triggers when price trades below `orLow` (minus buffer).
- `close_confirm`:
  - Long entry triggers when a bar **closes** above `orHigh` (plus buffer).
  - Short entry triggers when a bar **closes** below `orLow` (minus buffer).

### Parameter: `breakoutBufferBps`

Buffer in basis points (bps) applied to reduce noise.

- Long trigger: `orHigh * (1 + breakoutBufferBps / 10_000)`
- Short trigger: `orLow * (1 - breakoutBufferBps / 10_000)`

Common values to test:

- 0, 5, 10, 20

### Parameter: `maxTradesPerSession`

Common values:

- 1 (first valid breakout only)
- 2 (allow both directions, but never simultaneously)

### Conflict rule

- If a position is open, ignore new entries until the position is closed.

## Filters (optional, but supported)

### Parameter: `atrFilter`

Purpose: avoid trading in extremely low/high volatility regimes.

Options:

- disabled
- enabled: trade only if ATR is within a configured band.

Config:

- `minAtrBps` (ATR as bps of price)
- `maxAtrBps`

## Exits and risk management

### Position sizing

### Parameter: `sizingMode`

Options:

- `fixed_notional` (e.g., $1000 per trade)
- `fixed_risk_pct` (risk X% of equity per trade, based on stop distance)

### Stop loss

### Parameter: `stopMode`

Options:

- `or_opposite`:
  - Long stop at `orLow`
  - Short stop at `orHigh`
- `or_midpoint`:
  - Long stop at `orMid`
  - Short stop at `orMid`
- `atr_multiple`:
  - Long stop at `entryPrice - (atrStopMultiple * ATR)`
  - Short stop at `entryPrice + (atrStopMultiple * ATR)`

### Parameter: `atrStopMultiple`

Common values:

- 1.0, 1.5, 2.0

### Take profit

### Parameter: `takeProfitMode`

Options:

- `disabled`
- `r_multiple`:
  - TP at `entryPrice + (tpRMultiple * initialRisk)` for long
  - TP at `entryPrice - (tpRMultiple * initialRisk)` for short

### Parameter: `tpRMultiple`

Common values:

- 1.0, 2.0, 3.0

### Trailing stop (optional)

### Parameter: `trailingStopMode`

Options:

- `disabled`
- `atr_trailing`:
  - Long trailing stop = max(previousStop, close - (atrTrailMultiple * ATR))
  - Short trailing stop = min(previousStop, close + (atrTrailMultiple * ATR))

### Parameter: `atrTrailMultiple`

Common values:

- 1.0, 1.5, 2.0

### Time-based exit

### Parameter: `timeExitMode`

Options:

- `disabled`
- `bars_after_entry` (exit after N bars)
- `session_end` (exit at a configured session end time)

## Parameter schema (authoritative)

Implementations should treat this as the “contract” between UI, API, and engine.

### Defaults (Phase 1, recommended)

If the user does not know what to pick, these defaults are recommended as a conservative starting point:

- `initialEquity`: 10,000
- `execution.feeBps`: 10 (0.10% per fill)
- `execution.slippageBps`: 10 (0.10% per fill)

Notes:

- These are **simplified** realism knobs, intended for easy comparison across runs.
- Real fees/slippage vary by exchange and order type; Phase 2 will use an exchange-specific fee model.

```json
{
  "version": "1.0",
  "symbol": "BTC-USD",
  "interval": "5m",
  "session": {
    "timezone": "America/New_York",
    "startTime": "09:30",
    "openingRangeMinutes": 15
  },
  "entry": {
    "directionMode": "long_short",
    "entryMode": "stop_breakout",
    "breakoutBufferBps": 0,
    "maxTradesPerSession": 1
  },
  "atr": {
    "atrLength": 14,
    "atrFilter": {
      "enabled": false,
      "minAtrBps": 0,
      "maxAtrBps": 1000
    }
  },
  "risk": {
    "sizingMode": "fixed_risk_pct",
    "riskPctPerTrade": 0.5,
    "stopMode": "atr_multiple",
    "atrStopMultiple": 1.5,
    "takeProfitMode": "r_multiple",
    "tpRMultiple": 2.0,
    "trailingStopMode": "disabled",
    "atrTrailMultiple": 1.5,
    "timeExitMode": "disabled",
    "barsAfterEntry": 0,
    "sessionEndTime": "16:00"
  },
  "execution": {
    "feeBps": 10,
    "slippageBps": 10
  }
}
```

Notes:

- `symbol` is the data symbol in Phase 1. In Phase 2, symbol/exchange mapping will be added.
- `interval` is the effective interval for the backtest run (see data doc for resampling rules).
- `feeBps` and `slippageBps` are simplified realism controls (Phase 1).

## UI selection rules (authoritative)

These rules define when the UI should use single-select vs multi-select.

- **Single-select (mutually exclusive)**:
  - `entry.directionMode`
  - `entry.entryMode` (choose `stop_breakout` OR `close_confirm`)
  - `risk.sizingMode`
  - `risk.stopMode` (choose one stop model for initial stop placement)
- **Multi-toggle (can be active together)**:
  - Take profit (`risk.takeProfitMode` enabled/disabled + settings)
  - Trailing stop (`risk.trailingStopMode` enabled/disabled + settings)
  - Time exit (`risk.timeExitMode` enabled/disabled + settings)
  - ATR filter (`atr.atrFilter.enabled`)

If multiple exit mechanisms are enabled simultaneously:

- The first triggered exit in time closes the position.

## Edge cases (must be defined)

- If opening window has missing candles, decide:
  - Fail the session, or
  - Use available candles but flag reduced quality
- If `orHigh == orLow` (flat range), skip session.
- If ATR is unavailable (not enough history), skip until ATR warmup is complete.


