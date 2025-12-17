# Phase 2: Live trading (exchange/broker selection + adapter spec)

## Purpose

Phase 2 adds live trading. This document prevents guesswork by defining:

- How we choose an exchange (“broker”) for Malaysia
- The adapter interface for live trading
- The recommended implementation order (paper trading first)

## Terminology

For crypto, we integrate with an **exchange** (spot exchange), not a traditional stock broker.

## Goals (Phase 2)

- Run the same ORB + ATR strategy logic as Phase 1, but on live data.
- Start/stop bots from the UI.
- Persist bot state, orders, fills, and logs.

## Non-goals (Phase 2 initial)

- Multi-exchange smart routing.
- Futures/margin/leverage trading in the first iteration.

## Malaysia context (important)

You are in Malaysia, so “most convenient” has two interpretations:

- **Compliance-first convenience**: use an exchange licensed/recognized locally.
- **Engineering convenience**: best API + liquidity + ecosystem (may carry regulatory/availability risk).

This project should be explicit about which interpretation is being chosen for production.

## Recommended exchange choice (default)

### Default recommendation (compliance-first, chosen for this project)

We will start with **Luno** for Phase 2.

Rationale:

- Commonly referenced as a Malaysia-friendly, SC-licensed exchange with local deposit methods ([Datawallet](https://www.datawallet.com/crypto/best-crypto-exchanges-in-malaysia?utm_source=openai))

If we need alternatives later (still compliance-first), commonly referenced options include:

- Tokenize ([MoneySchool](https://www.moneyschool.my/how-to-buy-crypto-legally-malaysia/?utm_source=openai))
- SINEGY ([Fintech News Malaysia](https://fintechnews.my/regulated-crypto-exchanges-malaysia/?utm_source=openai))
- HATA Digital ([RinggitPlus](https://ringgitplus.com/en/blog/the-experts-corner/the-beginners-guide-to-buying-cryptocurrency-safely-in-malaysia.html?utm_source=openai))
- MX Global ([99Bitcoins](https://99bitcoins.com/buy-bitcoin/malaysia/?utm_source=openai))

Note: Binance is referenced publicly as not permitted to operate in Malaysia ([Webopedia](https://www.webopedia.com/crypto/exchanges/malaysia/?utm_source=openai)).

### Engineering-first alternatives (if compliance is not the priority)

Some globally popular exchanges accessible to Malaysians are often listed, e.g., Bybit ([Datawallet](https://www.datawallet.com/crypto/best-crypto-exchanges-in-malaysia?utm_source=openai)).

If you choose this route, document the risk explicitly in the implementation and deployment notes.

## Adapter interface (authoritative)

Implement an exchange adapter layer so we can swap exchanges without changing strategy code.

### Modules

- `MarketDataAdapter`
  - fetch recent candles (and optionally stream candles)
- `TradingAdapter`
  - place/cancel orders
  - fetch balances/positions
  - fetch order/fill status

### Minimum required capabilities (Spot)

- Authenticate via API keys
- Place market/limit orders (at least market for v1 live)
- Query open orders
- Query fills/trades
- Query balances

## Paper trading first (recommended for 10-day build)

To meet your 10-day timeline, Phase 2 should be implemented in this order:

1. **PaperTradingAdapter**
   - Uses real live candles, but simulates fills using the same fee/slippage model as backtests.
2. **One real exchange adapter**
   - Start with **Luno**.
3. Expand to more exchanges if needed.

This reduces risk and allows UI/bot lifecycle to be built without waiting on exchange quirks.

## Secrets and key management

- Store API keys only on the backend (Render).
- Never expose keys to the frontend.
- Prefer sub-accounts or restricted API keys:
  - Spot trading only
  - No withdrawals
  - IP allowlist if supported

## What we still must decide before “real money” trading

- Whether to stay spot-only or add futures later.
- Spot-only vs futures.
- Fee model (maker/taker) and how to model it.
- Minimum order sizes and symbol mapping.
- Rate limit strategy and retry/idempotency behavior.


