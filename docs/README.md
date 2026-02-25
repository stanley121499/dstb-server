# DSTB Trading Bot — Documentation

**Version:** 2.0 (Stable CLI System)
**Last Updated:** February 2026

---

## 📚 Documentation Index

| # | Document | Description |
|---|----------|-------------|
| [00](./glossary.md) | Glossary | Key terms and definitions |
| [12](./strategy-orb-atr.md) | ORB-ATR Strategy | Opening Range Breakout + ATR spec |
| [14](./backtest-engine.md) | Backtest Engine | How the backtest simulation works |
| [30](./architecture.md) | Architecture | System overview, components, data flow |
| [31](./strategy-plugin-guide.md) | Strategy Plugin Guide | How to create and test strategies |
| [32](./deployment-guide.md) | Deployment Guide | Running the bot on Windows / Linux / Cloud |
| [33](./cli-reference.md) | CLI Reference | All available `bot` commands |
| [34](./monitoring-setup.md) | Monitoring Setup | Telegram, Google Sheets, Email |
| [37](./exchange-error-handling.md) | Exchange Error Handling | Bitunix circuit breaker and retry logic |
| [38](./bitunix-adapter-reference.md) | Bitunix Adapter Reference | Verified API endpoints and data contracts |
| [credentials](./monitoring-credentials-setup.md) | Monitoring Credentials | Setting up API keys and service accounts |

---

## 🚀 Quick Start

**New to the project? Read in this order:**

1. **[Architecture](./architecture.md)** — How the system works end-to-end
2. **[Deployment Guide](./deployment-guide.md)** — Get the bot running
3. **[CLI Reference](./cli-reference.md)** — Control the bot from the terminal
4. **[Strategy Plugin Guide](./strategy-plugin-guide.md)** — Add new strategies
5. **[Monitoring Setup](./monitoring-setup.md)** — Connect alerts and dashboards

---

## 🗂️ Project Structure

```
dstb-server/
├── src/
│   ├── cli/           # CLI command handlers
│   ├── core/          # TradingBot engine, StateManager, Logger
│   ├── data/          # Yahoo Finance, Binance candle fetchers
│   ├── domain/        # strategyParams schema (Zod)
│   ├── exchange/      # Bitunix adapter, PaperTradingAdapter
│   ├── backtest/      # Deterministic backtest engine + strategy support files
│   ├── monitoring/    # Telegram, Google Sheets, Email alerters
│   ├── strategies/    # Strategy plugins (orb-atr, sma-crossover)
│   └── utils/         # interval helpers, hash utilities
├── configs/           # JSON bot configuration files
├── data/              # SQLite database + schema
├── logs/              # Rotating log files
└── docs/              # This folder — source of truth
```

---

## 🎯 Current Status

| Component | Status |
|-----------|--------|
| Core TradingBot engine | ✅ Complete |
| Strategy plugin system | ✅ Complete |
| ORB-ATR strategy | ✅ Complete |
| SMA-Crossover strategy | ✅ Complete |
| Bitunix exchange adapter | ✅ Complete |
| Paper Trading adapter | ✅ Complete |
| SQLite state management | ✅ Complete |
| CLI (`bot` command) | ✅ Complete |
| Backtest engine | ✅ Complete |
| Telegram alerter | ✅ Complete |
| Google Sheets reporter | ✅ Complete |
| Email alerter | ✅ Complete |
| Monorepo / frontend | ❌ Removed (Feb 2026) |
| Supabase database | ❌ Removed (replaced with SQLite) |

---

## 📖 Documentation Principles

- **This folder is the source of truth.** Code implements what docs specify.
- If code and docs conflict → fix the code, or update docs with clear reasoning.
- All major changes require a doc update.

---

## 🔗 External Resources

- [Bitunix API Docs](https://openapidoc.bitunix.com/doc/)
- [Luxon Docs](https://moment.github.io/luxon/)
- [SQLite Docs](https://www.sqlite.org/docs.html)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Google Sheets API](https://developers.google.com/sheets/api)
