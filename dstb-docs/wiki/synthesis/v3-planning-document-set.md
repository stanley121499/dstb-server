---
title: "Synthesis — v3 planning document set (Supabase + dashboard)"
type: synthesis
updated: 2026-04-08
sources: 14
tags: [dstb, planning, supabase]
---

# Synthesis: v3 planning document set

This page ties together the **2026-04-07** planning markdown files in `dstb-docs/raw/` that describe a move from **CLI + SQLite + JSON configs** to **Supabase + Next.js dashboard + sandboxed behavior analyzers**.

## Raw documents (one line each)

| Raw file | Role |
|----------|------|
| [`2026-04-07-architecture-plan-v3.md`](../../raw/2026-04-07-architecture-plan-v3.md) | System diagram: dashboard ↔ Supabase ↔ bot server (Render) + backtest; principles (Supabase SOT, no local disk, Realtime control plane, `isolated-vm` analyzers). |
| [`2026-04-07-schema-design-v3.md`](../../raw/2026-04-07-schema-design-v3.md) | DDL-level schema: configs through behavior tables; RLS; Realtime; SQLite/JSON migration notes. |
| [`2026-04-07-phase-plan-v3.md`](../../raw/2026-04-07-phase-plan-v3.md) | Phased delivery 1–6, dependencies, Darren impact per phase. |
| [`2026-04-07-behavior-system-design.md`](../../raw/2026-04-07-behavior-system-design.md) | Problem (Sheets + hand-coded analyzers); solution (LLM → JS → Supabase → sandbox); helper API expectations. |
| [`2026-04-07-dashboard-spec.md`](../../raw/2026-04-07-dashboard-spec.md) | Next.js on Vercel, pages (`/`, `/config`, `/trades`, behavior routes), stack (Lightweight Charts, shadcn, RHF+Zod). |

## Implementation / ops notes (same date)

| Raw file | Role |
|----------|------|
| [`2026-04-07-deploy-runtime-supabase-notes.md`](../../raw/2026-04-07-deploy-runtime-supabase-notes.md) | Phase 1 runtime: server entry, Docker/Render, env, WS + `/health` fixes, seed behavior. |
| [`2026-04-07-bot-logs-gap-and-integration-plan.md`](../../raw/2026-04-07-bot-logs-gap-and-integration-plan.md) | Why `bot_logs` was empty; contract + hook plan; **status:** `persistThought` + `BotStateStore.insertBotLog` wired in code. |
| [`2026-04-07-dashboard-phase2-status-and-updates.md`](../../raw/2026-04-07-dashboard-phase2-status-and-updates.md) | Phase 2 dashboard **implemented** in `dashboard/`; routes, Realtime, encoding/testing caveats; Vercel = ops checkbox. |
| [`2026-04-07-post-phases-polish-backlog.md`](../../raw/2026-04-07-post-phases-polish-backlog.md) | Deferred UX/spec polish **after** Phase 6 (or polish sprint); not Phase 2 blockers. |
| [`2026-04-07-phase3-implementation-summary.md`](../../raw/2026-04-07-phase3-implementation-summary.md) | **Shipped** Phase 3: `trade_candles` pipeline, `/trades/[id]`, `/analytics`, compare view; known limitations. |
| [`2026-04-07-bot-heartbeat-vs-candle-interval.md`](../../raw/2026-04-07-bot-heartbeat-vs-candle-interval.md) | Ops: heartbeat was tied to candle sleep — **fixed** chunked wait in `TradingBot.waitForNextCandle`. |
| [`2026-04-07-e2e-testing-v3-backlog.md`](../../raw/2026-04-07-e2e-testing-v3-backlog.md) | **Backlog:** layered E2E (Supabase seed, server smoke, Playwright, optional golden path); not in original phase doc. |
| [`2026-04-07-phase4-behavior-supabase-implementation.md`](../../raw/2026-04-07-phase4-behavior-supabase-implementation.md) | **Shipped Phase 4 (repo):** migration + seed, sync service, `isolated-vm` runner, backfill CLI, `BehaviorBot` hook, dashboard `/behavior`; watchlist + follow-ons. |
| [`2026-04-07-phase5-behavior-editor-implementation.md`](../../raw/2026-04-07-phase5-behavior-editor-implementation.md) | **Shipped Phase 5 (repo):** bot behavior HTTP API, dashboard analyzer/ruleset/compare pages, P&L RPC + single-active ruleset migrations, env/proxy checklist; watchlist + Phase 6 pointers. |

## Implementation snapshot (2026-04-07)

- **Phase 1:** Supabase + bot server + `bot_logs` wiring (see ops + bot_logs sources); **heartbeat UX:** [[../sources/bot-heartbeat-vs-candle-interval|chunked wait fix]].
- **Phase 2:** Next.js **`dashboard/`** matches phase-plan deliverables for local dev; full dashboard-spec polish is [[../concepts/post-phases-dashboard-polish|backlogged]]. Raw Phase 2 status file is **partially stale** on Phase 3 routes — see [[../sources/phase3-implementation-summary|Phase 3 summary]].
- **Phase 3:** Shipped per [[../sources/phase3-implementation-summary|implementation summary]]: `trade_candles` on exit, trade detail + analytics + compare; limitations (backfill, Sharpe approx, client-side strategy filter).
- **Phase 4:** Shipped per [[../sources/phase4-behavior-implementation|Phase 4 implementation raw]]: behavior tables + sync, sandbox runner + native S2 default, backfill CLI, dashboard behavior pages.
- **Phase 5:** Shipped per [[../sources/phase5-behavior-implementation|Phase 5 implementation raw]]: analyzer + ruleset editor, bot `POST /behavior/*`, compare view with fuzzy realized P&L.
- **Phase 6 (2026-04-08 repo):** Environments UI (`/behavior/environments`), promote/retire + linked `configs`, bot `POST /behavior/run-backtest` + Yahoo engine reuse, backtest trades in `behavior_environments.backtest_stats`, `/logs` + Realtime `bot_logs`, optional dashboard LLM route, bot equity-drop Telegram job + opt-in crash auto-restart. **Multi-timeframe live bot fan-in** not implemented — [[../concepts/multi-timeframe-bots-gap|gap note]].
- **Quality:** [[../sources/e2e-testing-v3-backlog|E2E backlog]] for future CI.

## Relation to the repository today

| Topic | Repo (evolving) | v3 plan |
|--------|------------------|---------|
| State | **Phase 1:** Supabase migrations + `SupabaseStateStore` / server path in use for managed deploy | Supabase Postgres |
| Configs | **`configs` table** + Realtime; disk JSON may coexist during migration | `configs` table + Realtime |
| UI | **Next.js `dashboard/`** — Phase 2 grid/config/trades + **Phase 3** detail/analytics/compare; Vercel optional | Richer spec items (forms, diffs, etc.) in [[../concepts/post-phases-dashboard-polish|polish backlog]] |
| Behavior analyzers | **Phase 4–5:** TS `BehaviorAnalyzer` + **`isolated-vm`** JS from DB; dashboard editor + ruleset builder + compare | JS in DB + sandbox runner + self-service rulesets (Phase 5 shipped) |
| `bot_logs` | **`TradingBot.persistThought`** → `insertBotLog` (see [[../sources/bot-logs-gap-and-integration-plan|source summary]]) | Dashboard **`/logs`** log stream (Realtime after Phase 6 migration) |

**`raw/docs/`** still documents the **CLI-first SQLite era** in places; **v3 raw notes** and **`supabase/`** describe the **current server + DB** path. Expect mixed docs until everything is reconciled.

## Cross-references

- [[../sources/v3-phase-rollout-plan|Source: Phase plan]]
- [[../sources/v3-supabase-schema-design|Source: Schema design]]
- [[../sources/behavior-backtest-csv-3-0|Source: Behavior CSV samples]]
- [[../sources/deploy-runtime-supabase-notes|Source: Deploy / runtime / Supabase]]
- [[../sources/bot-logs-gap-and-integration-plan|Source: bot_logs gap + integration]]
- [[../concepts/supabase-v3-migration|Concept: Supabase v3 migration]]
- [[../sources/dashboard-phase2-status|Source: Dashboard Phase 2 status]]
- [[../sources/post-phases-polish-backlog|Source: Post-phases polish backlog]]
- [[../entities/dstb-dashboard|Entity: Dashboard]]
- [[../sources/phase3-implementation-summary|Source: Phase 3 implementation]]
- [[../sources/bot-heartbeat-vs-candle-interval|Source: Heartbeat vs interval]]
- [[../sources/e2e-testing-v3-backlog|Source: E2E testing backlog]]
- [[../sources/phase4-behavior-implementation|Source: Phase 4 behavior implementation]]
- [[../sources/phase5-behavior-implementation|Source: Phase 5 behavior implementation]]
- [[../concepts/multi-timeframe-bots-gap|Concept: Multi-timeframe bots gap (Phase 6)]]
