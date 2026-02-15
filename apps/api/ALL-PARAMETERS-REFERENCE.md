# Complete Parameter Override Reference

This file documents **ALL** available parameter overrides for grid search configuration.

Copy any of these into your `grid-config.json` file's `overrides` array to test different values.

---

## Session Parameters

### `session.openingRangeMinutes`
**Type:** `number` (integer, ≥ 1)  
**Description:** Opening range duration in minutes  
**Guidance:** Lower = more trades, Higher = better confirmation  
**Industry Range:** 15-90 minutes  
**Example Values:** `[15, 30, 60, 90]`

```json
{
  "path": "session.openingRangeMinutes",
  "values": [15, 30, 60],
  "description": "Opening range duration (minutes)"
}
```

---

## Entry Parameters

### `entry.entryMode`
**Type:** `"stop_breakout" | "close_confirm"`  
**Description:** Entry trigger mechanism  
**Guidance:**  
- `stop_breakout` = Fill immediately when trigger price is touched (more trades, more whipsaws)
- `close_confirm` = Wait for bar close above/below trigger (fewer trades, better confirmation)

**Example Values:** `["stop_breakout", "close_confirm"]`

```json
{
  "path": "entry.entryMode",
  "values": ["stop_breakout", "close_confirm"],
  "description": "Entry trigger mechanism"
}
```

### `entry.breakoutBufferBps`
**Type:** `number` (≥ 0)  
**Description:** Entry buffer beyond OR level in basis points  
**Guidance:** 0 = no buffer, 5-15 reduces false breakouts  
**Industry Range:** 0-20 bps  
**Example Values:** `[0, 5, 10, 15]`

```json
{
  "path": "entry.breakoutBufferBps",
  "values": [0, 5, 10, 15],
  "description": "Entry buffer beyond OR level (bps)"
}
```

### `entry.maxTradesPerSession`
**Type:** `number` (integer, ≥ 1)  
**Description:** Maximum trades allowed per session  
**Guidance:** Lower = more selective, Higher = more opportunities  
**Industry Range:** 1-5 trades  
**Example Values:** `[1, 2, 3]`

```json
{
  "path": "entry.maxTradesPerSession",
  "values": [1, 2, 3],
  "description": "Max trades per session"
}
```

### `entry.directionMode`
**Type:** `"long_only" | "short_only" | "long_short"`  
**Description:** Trade direction filter  
**⚠️ NOTE:** Currently hardcoded to `"long_short"` in the backtest engine  
**Example Values:** `["long_only", "short_only", "long_short"]`

```json
{
  "path": "entry.directionMode",
  "values": ["long_only", "short_only", "long_short"],
  "description": "Trade direction (currently hardcoded to long_short)"
}
```

---

## ATR Parameters

### `atr.atrLength`
**Type:** `number` (integer, ≥ 1)  
**Description:** ATR calculation period in bars  
**Guidance:** 14 is industry standard, lower = more reactive to recent volatility  
**Industry Range:** 10-20 bars  
**Example Values:** `[10, 14, 20]`

```json
{
  "path": "atr.atrLength",
  "values": [10, 14, 20],
  "description": "ATR calculation period (bars)"
}
```

### `atr.atrFilter.enabled`
**Type:** `boolean`  
**Description:** Enable/disable ATR filter  
**Guidance:** When enabled, skips entries when ATR is outside min/max range  
**Example Values:** `[true, false]`

```json
{
  "path": "atr.atrFilter.enabled",
  "values": [true, false],
  "description": "Enable ATR filter"
}
```

### `atr.atrFilter.minAtrBps`
**Type:** `number` (integer, ≥ 0)  
**Description:** Minimum ATR in basis points  
**Guidance:** Skips entries when volatility is too low  
**Industry Range:** 30-100 bps  
**Example Values:** `[30, 50, 100]`

```json
{
  "path": "atr.atrFilter.minAtrBps",
  "values": [30, 50, 100],
  "description": "Min ATR in basis points"
}
```

### `atr.atrFilter.maxAtrBps`
**Type:** `number` (integer, ≥ 0)  
**Description:** Maximum ATR in basis points  
**Guidance:** Skips entries when volatility is too high  
**Industry Range:** 300-1000 bps  
**Example Values:** `[300, 500, 1000]`

```json
{
  "path": "atr.atrFilter.maxAtrBps",
  "values": [300, 500, 1000],
  "description": "Max ATR in basis points"
}
```

---

## Risk Management - Sizing

### `risk.sizingMode`
**Type:** `"fixed_risk_pct" | "fixed_notional"`  
**Description:** Position sizing method  
**Guidance:**  
- `fixed_risk_pct` = Risk fixed % of current equity per trade (scales with account)
- `fixed_notional` = Trade fixed dollar amount regardless of equity

**Example Values:** `["fixed_risk_pct", "fixed_notional"]`

```json
{
  "path": "risk.sizingMode",
  "values": ["fixed_risk_pct", "fixed_notional"],
  "description": "Position sizing method"
}
```

### `risk.riskPctPerTrade`
**Type:** `number` (0-100)  
**Description:** Risk per trade as % of equity  
**Guidance:** Professionals use 1-2%, never exceed 5%  
**Industry Range:** 0.5-3%  
**Example Values:** `[1, 2, 3]`

**⚠️ Only used when `sizingMode = "fixed_risk_pct"`**

```json
{
  "path": "risk.riskPctPerTrade",
  "values": [1, 2, 3],
  "description": "Risk per trade (%)"
}
```

### `risk.fixedNotional`
**Type:** `number` (≥ 0)  
**Description:** Fixed notional per trade in dollars  
**Guidance:** Used for testing strategy with consistent position sizes  
**Example Values:** `[500, 1000, 2000]`

**⚠️ Only used when `sizingMode = "fixed_notional"`**

```json
{
  "path": "risk.fixedNotional",
  "values": [500, 1000, 2000],
  "description": "Fixed notional per trade ($)"
}
```

---

## Risk Management - Stops

### `risk.stopMode`
**Type:** `"or_opposite" | "or_midpoint" | "atr_multiple"`  
**Description:** Stop loss placement method  
**Guidance:**  
- `or_opposite` = Place stop at opposite side of opening range
- `or_midpoint` = Place stop at midpoint of opening range
- `atr_multiple` = Place stop at N × ATR from entry

**Example Values:** `["or_opposite", "or_midpoint", "atr_multiple"]`

```json
{
  "path": "risk.stopMode",
  "values": ["or_opposite", "or_midpoint", "atr_multiple"],
  "description": "Stop loss placement method"
}
```

### `risk.atrStopMultiple`
**Type:** `number` (> 0)  
**Description:** Stop loss distance in ATR multiples  
**Guidance:** Lower = tighter stop (more stops hit), Higher = more room (bigger losses)  
**Industry Range:** 1.5-3.0x ATR  
**Example Values:** `[1.5, 2.0, 2.5, 3.0]`

**⚠️ Only used when `stopMode = "atr_multiple"`**

```json
{
  "path": "risk.atrStopMultiple",
  "values": [1.5, 2.0, 2.5],
  "description": "Stop loss ATR multiple"
}
```

### `risk.trailingStopMode`
**Type:** `"disabled" | "atr_trailing"`  
**Description:** Trailing stop behavior  
**Guidance:**  
- `disabled` = Fixed stop, never moves
- `atr_trailing` = Stop trails price by N × ATR, locking in profits

**Example Values:** `["disabled", "atr_trailing"]`

```json
{
  "path": "risk.trailingStopMode",
  "values": ["disabled", "atr_trailing"],
  "description": "Trailing stop mode"
}
```

### `risk.atrTrailMultiple`
**Type:** `number` (> 0)  
**Description:** Trailing stop distance in ATR multiples  
**Guidance:** Must be ≥ atrStopMultiple, higher locks in more profit  
**Industry Range:** 2.0-4.0x ATR  
**Example Values:** `[2.0, 2.5, 3.0]`

**⚠️ Only used when `trailingStopMode = "atr_trailing"`**

```json
{
  "path": "risk.atrTrailMultiple",
  "values": [2.0, 2.5, 3.0],
  "description": "Trailing stop ATR multiple"
}
```

---

## Risk Management - Take Profit

### `risk.takeProfitMode`
**Type:** `"disabled" | "r_multiple"`  
**Description:** Take profit mechanism  
**Guidance:**  
- `disabled` = No take profit, rely on stops and time exits
- `r_multiple` = Exit at N × initial risk (R-multiple target)

**Example Values:** `["disabled", "r_multiple"]`

```json
{
  "path": "risk.takeProfitMode",
  "values": ["disabled", "r_multiple"],
  "description": "Take profit mode"
}
```

### `risk.tpRMultiple`
**Type:** `number` (> 0)  
**Description:** Take profit target as R-multiple of initial risk  
**Guidance:**  
- 2R = conservative (2:1 reward:risk)
- 3R = balanced
- 4R+ = aggressive

**Industry Range:** 2-5R  
**Example Values:** `[2, 3, 4, 5]`

**⚠️ Only used when `takeProfitMode = "r_multiple"`**

```json
{
  "path": "risk.tpRMultiple",
  "values": [2, 3, 4],
  "description": "Take profit R-multiple"
}
```

---

## Risk Management - Time Exits

### `risk.timeExitMode`
**Type:** `"disabled" | "bars_after_entry" | "session_end"`  
**Description:** Time-based exit mechanism  
**Guidance:**  
- `disabled` = No time-based exits
- `bars_after_entry` = Exit after N bars regardless of P&L
- `session_end` = Exit at specified time (e.g., before market close)

**Example Values:** `["disabled", "bars_after_entry", "session_end"]`

```json
{
  "path": "risk.timeExitMode",
  "values": ["disabled", "bars_after_entry", "session_end"],
  "description": "Time-based exit mode"
}
```

### `risk.barsAfterEntry`
**Type:** `number` (integer, ≥ 0)  
**Description:** Number of bars after entry to force exit  
**Guidance:** Used to limit trade duration  
**Example Values:** `[10, 20, 30, 50]`

**⚠️ Only used when `timeExitMode = "bars_after_entry"`**

```json
{
  "path": "risk.barsAfterEntry",
  "values": [10, 20, 30],
  "description": "Bars after entry to exit"
}
```

### `risk.sessionEndTime`
**Type:** `string` (HH:mm format)  
**Description:** Session end time in NY timezone  
**Guidance:** Exit all positions at this time daily  
**Common Values:** "15:00", "15:30", "16:00" (before US market close at 16:00)  
**Example Values:** `["15:00", "15:30", "16:00"]`

**⚠️ Only used when `timeExitMode = "session_end"`**

```json
{
  "path": "risk.sessionEndTime",
  "values": ["15:00", "15:30", "16:00"],
  "description": "Session end time (HH:mm NY)"
}
```

---

## Execution Costs

### `execution.feeBps`
**Type:** `number` (integer, ≥ 0)  
**Description:** Trading fee in basis points  
**Guidance:**  
- Binance spot: ~10 bps (0.1%)
- Binance futures: ~5 bps (0.05%)
- Coinbase: ~50 bps (0.5%)

**Industry Range:** 5-50 bps  
**Example Values:** `[5, 10, 15, 20]`

```json
{
  "path": "execution.feeBps",
  "values": [5, 10, 15],
  "description": "Trading fee (bps)"
}
```

### `execution.slippageBps`
**Type:** `number` (integer, ≥ 0)  
**Description:** Slippage in basis points  
**Guidance:** Market impact and spread, varies by:  
- Liquidity (BTC has lower slippage than alts)
- Order size
- Market conditions (higher during volatile periods)

**Industry Range:** 2-20 bps  
**Example Values:** `[2, 5, 10]`

```json
{
  "path": "execution.slippageBps",
  "values": [2, 5, 10],
  "description": "Slippage (bps)"
}
```

---

## Example: Complete Grid Search

Here's an example testing multiple parameters across different dimensions:

```json
{
  "symbols": ["BTC-USD", "ETH-USD"],
  "intervals": ["5m", "15m", "1h"],
  "dateRange": {
    "start": "2025-01-01T00:00:00.000Z",
    "end": "2025-12-31T23:59:00.000Z"
  },
  "initialEquity": 10000,
  "baseParams": { ... },
  "overrides": [
    {
      "path": "session.openingRangeMinutes",
      "values": [15, 30, 60]
    },
    {
      "path": "entry.breakoutBufferBps",
      "values": [0, 5, 10]
    },
    {
      "path": "risk.riskPctPerTrade",
      "values": [1, 2, 3]
    },
    {
      "path": "risk.atrStopMultiple",
      "values": [1.5, 2.0, 2.5]
    },
    {
      "path": "risk.tpRMultiple",
      "values": [2, 3, 4]
    },
    {
      "path": "risk.atrTrailMultiple",
      "values": [2.0, 2.5, 3.0]
    }
  ]
}
```

**Total tests:** 2 symbols × 3 intervals × 3 × 3 × 3 × 3 × 3 × 3 = **4,374 tests**

---

## Tips for Effective Grid Search

1. **Start Small:** Test 2-3 parameters with 2-3 values each (~100-500 tests)
2. **Review Results:** Import to Google Sheets, sort by metrics
3. **Refine Ranges:** Focus on promising parameter ranges
4. **Add Dimensions:** Once you find good combinations, add more parameters
5. **Watch for Overfitting:** More parameters = higher risk of curve fitting
6. **Consider Correlation:** Some parameters interact (e.g., stop + TP + trail)
7. **Test Robustness:** Good parameters work across symbols and timeframes
