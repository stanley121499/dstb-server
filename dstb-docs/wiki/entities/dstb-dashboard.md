---
title: "Entity — DSTB Next.js dashboard"
type: entity
updated: 2026-04-08
sources: 6
tags: [dstb, dashboard, nextjs, supabase]
---

# Entity: DSTB Next.js dashboard

**Location:** `dashboard/` (monorepo) · **Stack:** Next.js App Router, Supabase Auth + client/server helpers, shadcn-style UI, Zod validation for strategy params.

## Role

Web UI for **Stanley/Darren**: bot grid, config editing with version history, trade log, **Phase 3** trade charts and analytics, **Phase 4** behavior results, **Phase 5** behavior analyzers/rulesets/compare, **Phase 6** environment pipeline + logs + optional in-dashboard LLM codegen — backed by **Supabase** (same project as bot server). Primary data path: Supabase with RLS; **Phase 5–6** add **server-only** Route Handlers that proxy to the bot HTTP API (`BEHAVIOR_API_BASE_URL` + `BEHAVIOR_API_SECRET`) for `isolated-vm` / Yahoo backtests (never exposed to the browser). Multi-timeframe `trade_candles` rows are written by the **bot server** on position exit (`OrderExecutor` → `closePosition`). Behavior **`behavior_raw_cycles` / `behavior_results`** are written by **`behavior:live`** / **`behavior:backfill-supabase`** and updated in bulk by bot **`POST /behavior/reanalyze-ruleset`**.

## Routes (Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6)

| Path | Purpose |
|------|---------|
| `/login` | Email/password |
| `/` | Bot grid |
| `/config/[id]` | Edit config + versions sidebar |
| `/config/new` | Create config |
| `/trades` | Paginated trades + filters |
| `/trades/[id]` | Trade detail: Lightweight Charts (15m/1h/4h), SL/TP lines, config snapshot + metadata |
| `/analytics` | P&L analytics: equity (per bot + aggregate), aggregate drawdown %, daily P&L bars, stats cards |
| `/analytics?view=compare` | Strategy / config comparison table (same filters) |
| `/behavior` | Phase 4: behavior results by ruleset; filters; dynamic columns from `behavior_results.columns`; paginated (in-memory slice after fetch — see Phase 4 raw watchlist) |
| `/behavior/[rawCycleId]` | Phase 4: 15m candle chart + PDH/PDL/session open from `behavior_raw_cycles` |
| `/behavior/analyzers`, `/behavior/analyzers/new`, `/behavior/analyzers/[id]` | Phase 5: analyzer list, create, detail (Monaco, prompt MD, Test Run → `/api/behavior/test-run`) |
| `/behavior/rulesets`, `/behavior/rulesets/new`, `/behavior/rulesets/[id]` | Phase 5: ruleset list, create, edit (toggles, params JSON, Run analysis, Set active) |
| `/behavior/rulesets/compare` | Phase 5: two rulesets, filters, label columns, disagreement shading, **Realized P&L (matched by date)** (RPC on `trades`) |
| `/behavior/environments`, `/behavior/environments/new`, `/behavior/environments/[id]` | Phase 6: pipeline board, derived-params JSON → promote creates `configs`, retire disables config, backtest stats + trade table from `backtest_stats` |
| `/logs` | Phase 6: `bot_logs` filters + Realtime inserts (requires `bot_logs` on `supabase_realtime`) |
| `/api/behavior/test-run`, `/api/behavior/reanalyze-ruleset` | Phase 5: authenticated proxy to bot (session + server env) |
| `/api/behavior/run-backtest` | Phase 6: proxy to bot `POST /behavior/run-backtest` |
| `/api/behavior/generate-analyzer` | Phase 6: server LLM (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) → JSON `{ code }` for analyzer editor |

## Key files

- `dashboard/app/` — pages
- `dashboard/components/bot-grid.tsx`, `config-editor-form.tsx`, `trade-detail-chart.tsx`, `analytics-charts.tsx`, `behavior-cycle-chart.tsx`
- `dashboard/lib/tradeChart.ts`, `dashboard/lib/behaviorChart.ts`, `dashboard/lib/analytics/*`
- `dashboard/lib/supabase/server.ts`, `client.ts`
- `dashboard/app/actions/config.ts`
- `dashboard/lib/server/strategyParamsShared.ts`, `paramsValidation.ts`
- `dashboard/lib/environmentDerivedParams.ts`, `configInsertShared.ts` — Phase 6 derived params + shared config insert
- `dashboard/.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; Phase 5–6: `BEHAVIOR_API_BASE_URL`, `BEHAVIOR_API_SECRET`; Phase 6 optional: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
- `dashboard/public/behavior-analyzer-prompt.md` — LLM contract template for sandbox analyzers

## Realtime

Grid subscribes to **`configs`** and **`bots`**; migration `supabase/migrations/20260407130000_realtime_bots.sql` enables **`bots`** publication. Phase 4 adds **`behavior_results`** to Realtime publication (optional future: live subscriptions on `/behavior`). Phase 6 migration `supabase/migrations/20260408120000_realtime_bot_logs.sql` adds **`bot_logs`** for the `/logs` stream.

## Status and backlog

- **Shipped vs plan:** [[../sources/dashboard-phase2-status|Phase 2 status (source)]]; **Phase 3** charts/analytics: [[../sources/phase3-implementation-summary|implementation summary]]; **Phase 4** behavior: [[../sources/phase4-behavior-implementation|implementation summary]]; **Phase 5** editor/compare: [[../sources/phase5-behavior-implementation|implementation summary]]; **Phase 6** environments/backtest/logs/LLM proxy: see `dashboard/` routes above + bot `POST /behavior/run-backtest`; **multi-timeframe live bots:** deferred — [[../concepts/multi-timeframe-bots-gap|gap note]]
- **Post-phase UX polish:** [[../sources/post-phases-polish-backlog|Polish backlog (source)]], [[../concepts/post-phases-dashboard-polish|concept]]

## See also

- [[../concepts/supabase-v3-migration|Supabase v3 migration]]
- [[../synthesis/v3-planning-document-set|v3 planning document set]]
