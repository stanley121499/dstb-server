# Architecture

**Version:** 2.0 (Stable)
**Last Updated:** February 2026

---

## Overview

DSTB is a CLI-first, plugin-based crypto trading bot that runs strategies against live exchange data. It replaces a previous monorepo with a React frontend, Express API, and Supabase backend.

**Key design decisions:**
- **No UI.** Monitoring is done via Telegram alerts and Google Sheets.
- **No cloud database.** SQLite is used locally for bot state — portable, fast, no dependencies.
- **Strategy plugins.** Strategies are self-contained TypeScript classes implementing `IStrategy`.
- **Multi-bot support.** Each bot runs its own virtual balance over a shared exchange account.

---

## Project Structure

```
src/
├── cli/           # `bot` CLI entry point and command handlers
├── core/
│   ├── TradingBot.ts       # Main bot lifecycle loop
│   ├── StateManager.ts     # SQLite read/write (bots, positions, trades, orders)
│   ├── OrderExecutor.ts    # Place/cancel/poll orders via exchange
│   ├── PositionManager.ts  # Track and update open positions
│   ├── RiskManager.ts      # Pre-trade checks and daily loss limits
│   ├── ConfigLoader.ts     # Load and validate JSON config files
│   └── Logger.ts           # Structured file + console logging
├── data/
│   ├── yahooFinance.ts     # Fetch historical OHLCV candles (Yahoo Finance API)
│   └── binanceDataSource.ts # Fetch OHLCV candles (Binance public API)
├── domain/
│   └── strategyParams.ts   # Zod schema for strategy parameter validation
├── exchange/
│   ├── IExchangeAdapter.ts      # Interface all adapters must implement
│   ├── BitunixAdapter.ts        # Live trading via Bitunix Futures API
│   ├── PaperTradingAdapter.ts   # Simulated exchange for testing
│   └── createAdapter.ts         # Factory to instantiate the correct adapter
├── backtest/
│   ├── runBacktest.ts           # Deterministic candle-based backtest engine
│   └── strategy/                # Backtest-specific ORB-ATR strategy internals
├── strategies/
│   ├── IStrategy.ts             # Strategy plugin interface
│   ├── factory.ts               # Resolve strategy name → instance
│   ├── orb-atr.ts               # Opening Range Breakout + ATR strategy
│   └── sma-crossover.ts         # SMA crossover strategy (example)
├── monitoring/
│   ├── TelegramAlerter.ts       # Send instant alerts to Telegram chat
│   ├── GoogleSheetsReporter.ts  # Push bot status to a Google Sheet
│   └── EmailAlerter.ts          # Send email alerts (SMTP)
└── utils/
    ├── interval.ts  # intervalToMinutes / intervalToMs
    └── hash.ts      # Candle fingerprinting
```

---

## Core Data Flow

```
Exchange WebSocket
       │
       ▼ candle
  TradingBot.ts
       │
       ├──► IStrategy.onCandle()  →  Signal (ENTRY / EXIT / HOLD)
       │
       ├──► RiskManager.preTradeCheck()
       │
       ├──► OrderExecutor.placeOrder()  →  BitunixAdapter
       │
       ├──► StateManager.saveTrade()    →  SQLite
       │
       └──► Monitoring (Telegram / Sheets / Email)
```

---

## Strategy Plugin Interface

```typescript
interface IStrategy {
  readonly name: string;
  readonly warmupPeriod: number;

  initialize(candles: readonly Candle[]): void;
  onCandle(candle: Candle, position: StrategyPosition | null): Signal;
  onFill(position: StrategyPosition): void;
  getState(): Record<string, unknown>;
}
```

All strategies live in `src/strategies/`. Register new ones in `src/strategies/factory.ts`.

---

## Exchange Adapter Interface

```typescript
interface IExchangeAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getBalance(): Promise<Balance>;
  getPositions(): Promise<Position[]>;
  getCandles(args): Promise<ExchangeCandle[]>;
  placeOrder(args): Promise<Order>;
  getOrder(orderId): Promise<Order>;
  cancelOrder(orderId): Promise<void>;
  subscribeToCandles(symbol, interval, cb): Promise<void>;
}
```

---

## State Management (SQLite)

Database lives at `data/bot-state.db`. Schema defined in `data/schema.sql`.

**Tables:**

| Table | Purpose |
|-------|---------|
| `bots` | Bot registry (config, equity, status) |
| `positions` | Open positions per bot |
| `trades` | Completed trade history |
| `orders` | Exchange orders placed by each bot |

---

## Multi-Bot Virtual Accounting

All bots share a single Bitunix exchange account but maintain virtual balances:

```
Exchange: 10,000 USDT
  Bot A (virtual): $5,200 allocated
  Bot B (virtual): $4,800 allocated
  Total virtual:   $10,000 ✓
```

A pre-trade check ensures no bot exceeds its allocated capital. Daily reconciliation detects drift.

---

## Error Handling

| Level | Trigger | Action |
|-------|---------|--------|
| CRITICAL | Position mismatch, daily loss limit, stuck order | Telegram + Email, bot may halt |
| WARNING | Reconnect success, high slippage, partial fill | Telegram only |
| INFO | Normal operation, candle received, trade logged | Log file only |

The Bitunix adapter implements automatic reconnect with exponential backoff and a circuit breaker that halts new orders after sustained failures.

---

## Config File Format

```json
{
  "name": "ORB BTC 15m",
  "strategy": "orb-atr",
  "exchange": "bitunix",
  "symbol": "BTCUSDT",
  "interval": "15m",
  "initialBalance": 5000,
  "riskManagement": {
    "maxDailyLossPct": 5,
    "maxPositionSizePct": 20
  },
  "params": {
    "session": "NY",
    "atrLength": 14,
    "openingRangeMinutes": 30,
    "entry": { "directionMode": "long_only" }
  },
  "bitunix": {
    "apiKey": "${BITUNIX_API_KEY}",
    "secretKey": "${BITUNIX_SECRET_KEY}",
    "testMode": false,
    "marketType": "futures"
  }
}
```

---

## See Also

- [CLI Reference](./cli-reference.md)
- [Strategy Plugin Guide](./strategy-plugin-guide.md)
- [Bitunix Adapter Reference](./bitunix-adapter-reference.md)
- [Deployment Guide](./deployment-guide.md)
