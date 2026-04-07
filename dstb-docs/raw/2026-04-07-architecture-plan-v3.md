# Architecture Plan v3 — Supabase + Dashboard + Bot Server

**Date:** 2026-04-07
**Status:** Planning
**Supersedes:** Architecture v2 (CLI-first, SQLite, no UI)

---

## Context

Architecture v2 stripped the React frontend, Express API, and Supabase backend in favour of a simplified CLI-first system with SQLite. That decision was correct at the time — the project needed to stabilise the core trading engine without premature infrastructure.

Now the project is evolving toward **quant trading at scale**: 10-20+ bots running different strategy environments, a two-person team (coder + strategist) who both need visibility and control, and a behavior analysis pipeline that feeds new strategy candidates. The CLI + Telegram + JSON-files model cannot support this.

---

## Design Principles

1. **Supabase is the source of truth.** Configs, trades, positions, bot state, behavior data — all live in Supabase. The bot server is stateless and can restart from Supabase at any time.
2. **No persistent disk required.** Because Supabase holds all durable state, the bot server can run on ephemeral infrastructure (Render free/cheap tier). SQLite is removed.
3. **Config-driven control plane.** The dashboard writes configs to Supabase. The bot server subscribes to changes via Supabase Realtime and reacts. No direct API calls between dashboard and bot server.
4. **Sandboxed extensibility.** Behavior analysis rules are LLM-generated JavaScript functions stored in Supabase and executed in an `isolated-vm` sandbox. The strategist can iterate on rules without the coder.
5. **Incremental delivery.** Each phase delivers standalone value. No phase depends on a future phase to be useful.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     DASHBOARD                             │
│              (Next.js on Vercel — free)                   │
│                                                           │
│  ┌──────────┐  ┌───────────┐  ┌────────────────────────┐ │
│  │ Bot Grid │  │  Config   │  │  Trade Analytics       │ │
│  │ (status, │  │  Editor   │  │  (charts, P&L,         │ │
│  │  health) │  │  (forms)  │  │   "why did I lose")    │ │
│  └────┬─────┘  └─────┬─────┘  └──────────┬─────────────┘ │
│       │               │                    │               │
│  ┌────┴───────────────┴────────────────────┴─────────────┐│
│  │            Behavior Analyzer Editor                    ││
│  │  (paste LLM-generated code, test run, save,           ││
│  │   ruleset builder, re-analysis, comparison)           ││
│  └───────────────────────┬───────────────────────────────┘│
└──────────────────────────┼────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    SUPABASE (free tier)                    │
│                                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐   │
│  │ configs│ │ trades │ │  bots  │ │ behavior_raw_    │   │
│  │        │ │        │ │        │ │ cycles           │   │
│  └───▲────┘ └───▲────┘ └───▲────┘ └──────▲───────────┘   │
│      │          │          │              │               │
│  ┌───┴──┐  ┌───┴────┐  ┌──┴──────┐  ┌───┴────────────┐  │
│  │config│  │ trade  │  │  bot   │  │ behavior_      │  │
│  │versns│  │candles │  │  logs  │  │ analyzers/     │  │
│  └──────┘  └────────┘  └────────┘  │ rulesets/      │  │
│                                     │ results/       │  │
│                                     │ environments   │  │
│                                     └────────────────┘  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │  Supabase Realtime (config changes → bot server)   │   │
│  │  Supabase Auth (Stanley + Darren accounts)         │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                              ▼
┌───────────────────────┐    ┌─────────────────────────┐
│   BOT SERVER          │    │  BACKTEST ENGINE         │
│   (Render Web Svc)    │    │  (same process or       │
│                       │    │   triggered separately)  │
│  ┌─────────────────┐  │    │                          │
│  │   BotManager    │  │    │  Fetches raw cycles +    │
│  │   TradingBot×N  │  │    │  analyzer code from      │
│  │                 │  │    │  Supabase, runs in       │
│  │  Reads configs  │  │    │  isolated-vm sandbox     │
│  │  from Supabase  │  │    │                          │
│  │  Writes trades  │  │    └─────────────────────────┘
│  │  to Supabase    │  │
│  └─────────────────┘  │
│                       │
│  ┌─────────────────┐  │
│  │  /health HTTP   │  │
│  │  (UptimeRobot)  │  │
│  └─────────────────┘  │
│                       │
│  ┌─────────────────┐  │
│  │  Telegram       │  │
│  │  (critical      │  │
│  │   alerts only)  │  │
│  └─────────────────┘  │
└───────────────────────┘
```

---

## Key Architecture Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Database | Supabase (Postgres) | Free tier, Realtime subscriptions, Auth, Studio UI for direct access. Team has prior experience. |
| 2 | Bot ↔ DB communication | Direct via `@supabase/supabase-js` with service role key | No API layer needed. Simpler than Express/Hono middleware. |
| 3 | Bot control model | Config-driven via Supabase Realtime | Dashboard toggles `configs.enabled`. Bot server subscribes and reacts. No direct dashboard→bot API calls. |
| 4 | Dashboard hosting | Next.js on Vercel (free tier) | Zero-config deploys, server components can query Supabase directly, first-class Supabase auth integration. |
| 5 | Bot server hosting | Render Web Service | Binds to PORT for `/health` endpoint (UptimeRobot). No persistent disk needed — Supabase holds all state. |
| 6 | Persistent disk | Not required | Supabase is source of truth. Bot server is stateless. Logs go to `bot_logs` table. |
| 7 | SQLite | Removed after migration | Replaced entirely by Supabase. |
| 8 | Repo structure | Monorepo: `dashboard/` alongside existing `src/` | Single repo, clear boundaries. Dashboard deploys to Vercel, bot server deploys to Render. |
| 9 | Config versioning | Version history table + snapshot on each trade | Enables "which config version produced this trade" and A/B comparison. |
| 10 | Credentials (API keys) | Environment variables on Render | Configs store env var references (e.g. `"${BITUNIX_API_KEY}"`). Dashboard never sees real keys. |
| 11 | Candle context per trade | Multi-timeframe JSONB stored in `trade_candles` | Strategy determines which timeframes are relevant. Powers "why did I lose" chart view. |
| 12 | Behavior analysis code | LLM-generated JavaScript stored in Supabase, executed in `isolated-vm` sandbox | Strategist iterates on rules without coder. Sandbox prevents security/stability issues. |
| 13 | Telegram | Kept for critical alerts only | Not the primary management UI. Dashboard replaces that role. |
| 14 | Google Sheets (behavior) | Replaced by Supabase + dashboard | Behavior results live in `behavior_results` table. Dashboard renders them. |
| 15 | Health monitoring | `/health` HTTP endpoint on bot server | UptimeRobot pings it. Returns bot count, uptime, last heartbeat. |

---

## Data Flow: Live Trading

```
1. Dashboard: Darren creates/edits a config, sets enabled=true
2. Supabase Realtime: config change event fires
3. Bot Server: receives event, loads config, creates TradingBot instance
4. TradingBot: connects to Bitunix, fetches warmup candles, enters main loop
5. On each candle: strategy produces signal → risk check → order execution
6. On each trade: writes to Supabase (trades, positions, trade_candles, bot_logs)
7. On heartbeat: updates bots.last_heartbeat + bots.equity in Supabase
8. Dashboard: reads trades/positions/bots via Supabase client (Realtime for live updates)
9. Telegram: receives critical alerts only (crashes, position mismatches)
```

---

## Data Flow: Behavior Analysis

```
1. BehaviorBot runs daily: collects raw candle data → writes to behavior_raw_cycles (immutable)
2. Darren writes analysis rules in natural language
3. Darren pastes rules + prompt template into LLM → gets JavaScript code
4. Dashboard: Darren pastes code into Analyzer Editor → test runs against one day → saves to behavior_analyzers
5. Dashboard: Darren builds a ruleset selecting which analyzers to include + param overrides
6. Dashboard: "Run Analysis" → bot server fetches raw cycles + analyzer code → executes in isolated-vm sandbox → saves results to behavior_results
7. Dashboard: Darren reviews results, compares rulesets, identifies promising environments
8. Dashboard: Darren promotes environment → creates a config → pipeline: backtest → paper → live
```

---

## Migration Path from v2

1. Set up Supabase project and apply schema migrations.
2. Add `@supabase/supabase-js` to bot server dependencies.
3. Refactor `StateManager` to write to Supabase instead of SQLite.
4. Refactor `BotManager.startAll()` to read configs from Supabase `configs` table instead of `configs/strategies/*.json`.
5. Add Supabase Realtime subscription for config changes (start/stop bots reactively).
6. Add `/health` HTTP endpoint.
7. Remove `better-sqlite3` dependency and `data/bot-state.db`.
8. Remove `configs/strategies/` JSON files and `bot-stopped-state.json`.
9. Deploy to Render as Web Service.
10. Scaffold `dashboard/` Next.js app, deploy to Vercel.

---

## See Also

- [Schema Design](./2026-04-07-schema-design-v3.md)
- [Phase Rollout Plan](./2026-04-07-phase-plan-v3.md)
- [Behavior System Design](./2026-04-07-behavior-system-design.md)
- [Dashboard Specification](./2026-04-07-dashboard-spec.md)
