# Data: `yfinance` and intervals

## Phase 1 data source

We will use `yfinance` for historical data:

- BTC: `BTC-USD`
- ETH: `ETH-USD`

## Requirements

- The engine must support multiple bar intervals in the UI.
- The engine must be deterministic and reproducible:
  - Store the request parameters (symbol, interval, start/end, fetch timestamp).
  - Store a data checksum (or row count + first/last timestamps) for the fetched candles.

## Interval strategy (authoritative)

### Supported “effective intervals”

These are the intervals the backtest engine accepts:

- `1m`, `2m`, `5m`, `15m`, `30m`, `60m`, `90m`, `1h`, `1d`

The UI can present a subset for simplicity (recommended: 1m, 5m, 15m, 30m, 1h, 4h, 1d).

### Fetch vs resample rule

To ensure consistency across intervals, use this rule:

- **If the requested interval can be fetched directly from `yfinance`**, fetch it directly.
- **If the requested interval is not available or has insufficient history**, fetch a smaller “base interval” and resample up.

Resampling is only allowed from finer → coarser (never the reverse).

### Resampling definition

When resampling a base interval to a higher interval:

- Open: first open
- High: max high
- Low: min low
- Close: last close
- Volume: sum

All timestamps must be aligned to UTC boundaries for the target interval.

## Timestamp normalization and DST

Even though candles are in UTC (or can be treated as UTC), session logic must be applied in:

- `America/New_York` timezone (DST-aware)

Workflow:

1. Parse candle timestamps as UTC.
2. For each candle, compute its `America/New_York` local time.
3. Determine which candles belong to the session’s opening window (09:30 NY + `openingRangeMinutes`).
4. Convert any session boundary times back to UTC for comparisons.

Do not implement DST via hard-coded offsets.

## Data quality expectations and handling

### Missing candles

Define a strict policy for missing candles in the opening range:

- If the opening window is missing candles:
  - Option A (recommended for correctness): **skip that session** and log a “data_quality:missing_opening_range” event.
  - Option B: allow but flag reduced-quality.

We will default to Option A unless the client asks otherwise.

### Duplicates and out-of-order bars

- Deduplicate by timestamp (keep the latest row).
- Sort ascending by timestamp before any indicator or strategy logic.

### Warmup

ATR requires `atrLength` bars of warmup (plus 1 for prevClose).

- Before ATR is available, **no trades** can be taken.

## Phase 2 note (live data)

`yfinance` is not intended for live trading.

In Phase 2 we will add an exchange adapter (e.g., via a library like ccxt or direct exchange REST/WebSocket) for:

- Live candles
- Order placement and cancellation
- Positions/balances



