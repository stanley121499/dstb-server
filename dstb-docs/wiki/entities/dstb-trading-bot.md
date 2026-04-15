---
title: "Entity — DSTB trading bot (product)"
type: entity
updated: 2026-04-13
sources: 4
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

## Bot status lifecycle (post 2026-04-13 fix)

| Event | Who writes `bots.status` |
|-------|--------------------------|
| Bot first start / `loadState()` | `updateBotStatus("running")` in `TradingBot.loadState()` |
| Heartbeat update | `updateBotStatus` not called; only `last_heartbeat` updated |
| `TradingBot.stop()` (crash or disable) | **`updateBotStatus("stopped")`** — added 2026-04-13 |
| `BotManager.stopBot()` (HTTP stop) | Calls `bot.stop()` (which now writes "stopped") + `setConfigEnabled(false)` |

**Before the 2026-04-13 fix**, `stop()` never wrote to `bots.status`, leaving it permanently "running" after crashes.

## Reconcile grace period (added 2026-04-14)

`reconcilePositions()` (called once at startup) now sets `reconcileCreatedAtMs` if it creates a DB position from the exchange snapshot. `syncPositionWithExchange()` skips closing that position for 60 seconds (`RECONCILE_GRACE_PERIOD_MS`), preventing the create→close cycle caused by exchange API lag returning "flat" milliseconds after reconcile saw an open position.

`SupabaseStateStore.createPosition` also does a pre-insert check and returns the existing position ID (with a WARN log) if an open position already exists for the bot, rather than hitting the DB `UNIQUE (bot_id)` constraint.

## Known resolved issues (2026-04-14)

### ETH Live Bot v3 crash loop — fixed
Root cause: `TelegramAlerter.startPolling()` used `void this.pollOnce()` inside `setInterval`. When Render could not reach Telegram's API (ETIMEDOUT), the unhandled rejection crashed the entire Node.js 22 process every ~1 minute. Fix: `.catch()` added to `pollOnce()` call in `startPolling()`. Bot can be re-enabled after Render redeploy.

### ORB BTC 15m reconcile storm — fixed
Root cause: same server crash loop. Each restart ran `reconcilePositions()` → created DB position → `syncPositionWithExchange()` saw exchange flat (API lag) → closed it. Fix: reconcile grace period (above) + pre-insert guard in `createPosition`.

→ See [[../sources/live-smoke-test-bugs-and-ux-fixes|source summary]] for full investigation details.

## Sources

- Canonical detail: [raw/docs/architecture.md](../../raw/docs/architecture.md)
- Index hub: [raw/docs/README.md](../../raw/docs/README.md)

## See also

- [[../overview|Wiki overview]]
- [[dstb-dashboard|DSTB dashboard]]
- [[../sources/raw-docs-readme|Source summary: doc README]]
