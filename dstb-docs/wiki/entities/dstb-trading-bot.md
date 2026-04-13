---
title: "Entity — DSTB trading bot (product)"
type: entity
updated: 2026-04-07
sources: 3
tags: [dstb, product]
---

# Entity: DSTB trading bot

**Type:** Software system (repository `dstb-server`)

## Purpose

Algorithmic crypto trading: multiple strategies as plugins, live or paper execution, backtesting, and monitoring. **Production-style** control uses **Supabase** + **`npm run start`** server; **[[dstb-dashboard|dashboard]]** for grid/config/trades. CLI and SQLite paths may still exist locally; see [[../concepts/supabase-v3-migration|migration concept]].

## Key subsystems (for future wiki expansion)

- **Core:** `src/core/` — `TradingBot`, `StateManager`, logging
- **Exchange:** `src/exchange/` — Bitunix adapter, paper trading
- **Strategies:** `src/strategies/` — plugin implementations
- **Backtest:** `src/backtest/`
- **CLI:** `src/cli/`
- **Server:** `src/server/` — BotManager, health, Realtime (with Supabase)
- **Monitoring:** `src/monitoring/`

## Sources

- Canonical detail: [raw/docs/architecture.md](../../raw/docs/architecture.md)
- Index hub: [raw/docs/README.md](../../raw/docs/README.md)

## See also

- [[../overview|Wiki overview]]
- [[dstb-dashboard|DSTB dashboard]]
- [[../sources/raw-docs-readme|Source summary: doc README]]
