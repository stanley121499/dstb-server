---
title: "Entity — DSTB trading bot (product)"
type: entity
updated: 2026-04-07
sources: 1
tags: [dstb, product]
---

# Entity: DSTB trading bot

**Type:** Software system (repository `dstb-server`)

## Purpose

Algorithmic crypto trading via a **stable CLI**: multiple strategies as plugins, live or paper execution, persistent SQLite state, backtesting, and operational monitoring.

## Key subsystems (for future wiki expansion)

- **Core:** `src/core/` — `TradingBot`, `StateManager`, logging
- **Exchange:** `src/exchange/` — Bitunix adapter, paper trading
- **Strategies:** `src/strategies/` — plugin implementations
- **Backtest:** `src/backtest/`
- **CLI:** `src/cli/`
- **Monitoring:** `src/monitoring/`

## Sources

- Canonical detail: [raw/docs/architecture.md](../../raw/docs/architecture.md)
- Index hub: [raw/docs/README.md](../../raw/docs/README.md)

## See also

- [[../overview|Wiki overview]]
- [[../sources/raw-docs-readme|Source summary: doc README]]
