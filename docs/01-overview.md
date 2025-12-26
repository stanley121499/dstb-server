# Overview

## Context

We are building a **server + React UI** so a client can easily:

- Run **backtests** on BTC/ETH using the **Opening Range Breakout (ORB)** strategy.
- Include **ATR**-based logic within the strategy (e.g., stops/trailing/filters/sizing).
- Manage **parameter sets** and compare results.

Later, the same system will also support **live trading**, controlled from the frontend (start/stop bots, edit parameters, monitor state and logs).

## Goals

### Phase 1: Backtesting platform

- Use `yfinance` as the initial data source for BTC/ETH.
- Allow the UI to select multiple bar intervals (with a clear engine plan for consistency).
- Implement ORB anchored to **New York open** (US equities session concept) with **daylight saving time (DST)** handled correctly.
- Provide realistic backtest options: fees, slippage, fill assumptions, risk sizing.
- Persist runs, params, trades, and key metrics in Supabase.

### Phase 2: Live trading **platform**

- Reuse the same strategy definition and parameter model from Phase 1.
- Add exchange adapters (likely not `yfinance`) for live candles + order placement.
- Add bot lifecycle management (start/stop/restart), status monitoring, audit logs, and alerting.

## Key design principle

**One strategy/parameter model** drives both backtest and live trading.

If backtest and live trading use different logic, results will not transfer and the UI will be confusing.

## Key constraints & requirements

- Crypto trades 24/7, so the “open” must be defined explicitly.
- The chosen “open” is **New York open**:
  - 9:30am in `America/New_York`
  - Must be DST-aware (EDT vs EST changes the UTC offset).
- `yfinance` data quality and available history depend on interval; resampling may be required.
- Database is Supabase (Postgres). We will maintain **migration files**.







