---
title: "Multi-timeframe bots — Phase 6 gap"
type: concept
updated: 2026-04-08
sources: 0
tags: [dstb, trading-bot, v3]
---

# Multi-timeframe bots (Phase 6 note)

The v3 [Phase Rollout Plan](../../raw/2026-04-07-phase-plan-v3.md) lists **multi-timeframe bot support** under Phase 6 operational enhancements.

## Current engine

[`TradingBot`](../../../src/core/TradingBot.ts) drives one primary candle stream from `config.interval` (single subscription / pacing loop). Strategies may **fetch** additional history in `initializeStrategy()` (e.g. higher timeframes from the exchange), but there is **no** first-class multi-interval WebSocket fan-in.

## Meaning for operators

- **Today:** Prefer a single bar interval per bot row; encode HTF context via extra fetches inside the strategy if the adapter supports it.
- **Future:** A dedicated design would add either multiple coordinated subscriptions or a first-class “auxiliary intervals” config with merged bar scheduling.

## Links

- [[../synthesis/v3-planning-document-set|v3 planning document set]]
- [[../entities/dstb-trading-bot|Trading bot entity]]
