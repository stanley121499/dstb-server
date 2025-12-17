# Glossary

## Trading terms

- **OHLCV**: Open, High, Low, Close, Volume candles.
- **Bar / Candle / Interval**: A time bucket for OHLCV (e.g., 1m, 5m, 1h).
- **ORB (Opening Range Breakout)**: Strategy that defines a price range during an “opening window,” then trades breakouts above/below that range.
- **Opening range (OR)**: The high/low formed during the configured opening window.
- **Breakout**: Price moving above OR high (long) or below OR low (short).
- **Stop-loss (SL)**: Exit to limit loss if trade moves against you.
- **Take-profit (TP)**: Exit to lock profit at a predefined level.
- **R (Risk unit)**: The amount risked per trade. If SL distance is \(D\) and size is \(Q\), then 1R is the planned loss at SL (including fees/slippage in realistic models).
- **ATR (Average True Range)**: Volatility indicator. Commonly used for stop distance, trailing stops, filters, or sizing.
- **Slippage**: Difference between expected fill price and actual fill price.
- **Fees**: Exchange/broker commissions. Must be included in realistic backtests.

## Time / session terms

- **NY open**: 9:30am in `America/New_York` time (DST-aware). This project anchors crypto “session open” to NY open.
- **DST**: Daylight Saving Time. NY is **EDT (UTC-4)** in summer and **EST (UTC-5)** in winter.

## Platform terms

- **Parameter set**: A named configuration for the strategy (ORB + ATR + risk + execution assumptions).
- **Backtest run**: A single execution of a parameter set over a historical date range producing trades + metrics.
- **Bot**: A live instance of a strategy parameter set trading an instrument in real time (Phase 2).
- **Exchange adapter**: Module that fetches live data and places/cancels orders on an exchange (Phase 2).


