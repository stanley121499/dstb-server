# DSTB LLM Wiki — log

Append-only timeline. Newest entries at the **bottom** (or top — stay consistent; this file uses **bottom** append).

---

## [2026-04-07] ingest | Phase 5 behavior editor + self-service analysis (raw + wiki)

- **Raw:** `raw/2026-04-07-phase5-behavior-editor-implementation.md`
- **Wiki:** added `wiki/sources/phase5-behavior-implementation.md`; updated `wiki/synthesis/v3-planning-document-set.md`, `wiki/entities/dstb-dashboard.md`, `index.md`
- **Notes:** Canonical record of Phase 5: bot `POST /behavior/test-run` + `reanalyze-ruleset`, `BehaviorSupabaseSync` extensions, migrations (single active ruleset + P&L RPC), dashboard analyzers/rulesets/compare + Monaco + API proxy env; watchlist for long jobs, compare semantics, symbol alignment, Phase 6 still out of scope.

## [2026-04-07] query | Phase 3 dashboard + bot trade_candles (implementation)

- **Question:** Ship v3 Phase 3 trade analytics and charts in repo.
- **Output filed:** none — recorded in code + this log; updated `wiki/entities/dstb-dashboard.md`, `wiki/synthesis/v3-planning-document-set.md`
- **Notes:** `dashboard/`: `lightweight-charts`, `/trades/[id]`, `/analytics` (+ compare `view`), `NavBar` link. Bot: optional `IExchangeAdapter.fetchTradeCandleBundlesForRange`, `BitunixAdapter` / `PaperTradingAdapter`, `OrderExecutor.executeExit` passes bundles into `closePosition`. Tests: `src/exchange/__tests__/tradeExitChartCandles.unit.test.ts`. Interval helper adds `4h` in `src/utils/interval.ts`.

## [2026-04-07] ingest | Dashboard Phase 2 status + post-phases polish backlog

- **Raw:** `raw/2026-04-07-dashboard-phase2-status-and-updates.md`, `raw/2026-04-07-post-phases-polish-backlog.md`
- **Wiki:** added `wiki/sources/dashboard-phase2-status.md`, `wiki/sources/post-phases-polish-backlog.md`, `wiki/entities/dstb-dashboard.md`, `wiki/concepts/post-phases-dashboard-polish.md`; updated `wiki/synthesis/v3-planning-document-set.md`, `wiki/concepts/supabase-v3-migration.md`, `wiki/overview.md`, `index.md`
- **Notes:** Phase 2 dashboard in `dashboard/` recorded as plan-complete for dev; spec-rich polish deferred to post–Phase 6 backlog; synthesis UI row and migration concept status refreshed.

## [2026-04-07] ingest | deploy/runtime Supabase notes + bot_logs integration plan

- **Raw:** `raw/2026-04-07-deploy-runtime-supabase-notes.md`, `raw/2026-04-07-bot-logs-gap-and-integration-plan.md`
- **Wiki:** added `wiki/sources/deploy-runtime-supabase-notes.md`, `wiki/sources/bot-logs-gap-and-integration-plan.md`; updated `wiki/synthesis/v3-planning-document-set.md`, `wiki/concepts/supabase-v3-migration.md`, `wiki/overview.md`, `index.md`
- **Notes:** Raw deploy note’s “empty `bot_logs` expected” superseded by gap doc status + `TradingBot.persistThought` in code; synthesis table updated for Phase 1 partial delivery.

## [2026-04-07] ingest | v3 planning raw files + behavior CSV exports

- **Raw:** `raw/2026-04-07-phase-plan-v3.md`, `raw/2026-04-07-schema-design-v3.md`, `raw/2026-04-07-architecture-plan-v3.md`, `raw/2026-04-07-behavior-system-design.md`, `raw/2026-04-07-dashboard-spec.md`, `raw/3.0_Behavior_Backtest_01 - 1) BEHAVIOR-RAW DATA.csv`, `raw/3.0_Behavior_Backtest_01 - 2) BEHAVIOR-ENVIRONMENT-OVERVIEW (1).csv`
- **Wiki:** added `wiki/sources/v3-phase-rollout-plan.md`, `wiki/sources/v3-supabase-schema-design.md`, `wiki/sources/behavior-backtest-csv-3-0.md`, `wiki/synthesis/v3-planning-document-set.md`, `wiki/concepts/supabase-v3-migration.md`; updated `wiki/overview.md`, `index.md`
- **Notes:** v3 set is forward-looking (Supabase + Next dashboard + sandboxed behavior); contrasts with current SQLite/CLI system documented in `raw/docs/`.

## [2026-04-07] ingest | raw/docs/README.md (documentation index)

- **Raw:** `dstb-docs/raw/docs/README.md`
- **Wiki:** added `wiki/overview.md`, `wiki/sources/raw-docs-readme.md`, `wiki/concepts/documentation-index.md`, `wiki/entities/dstb-trading-bot.md`; created `index.md`, `log.md`, `raw/README.md`, `raw/assets/`
- **Notes:** First formal ingest after migrating former repo `docs/` → `dstb-docs/raw/docs/`; top-level `docs/README.md` is now a pointer stub.

## [2026-04-07] meta | Vault bootstrap (LLM Wiki pattern)

- **Raw:** *(n/a — structural)*
- **Wiki:** established `CLAUDE.md` schema at repo root; defined folder conventions under `dstb-docs/`
- **Notes:** Obsidian vault remains `dstb-docs/`; agent maintains wiki + index + log per schema.

## [2026-04-07] ingest | patch raw/docs/README.md (paths after vault move)

- **Raw:** `dstb-docs/raw/docs/README.md` (project tree + principles lines)
- **Wiki:** refreshed [[wiki/sources/raw-docs-readme|source summary]] migration section
- **Notes:** Aligns archived README with `dstb-docs/` layout; no semantic spec change.

## [2026-04-07] ingest | Phase 3 summary + heartbeat ops + E2E backlog (full wiki pass)

- **Raw:** `raw/2026-04-07-phase3-implementation-summary.md`, `raw/2026-04-07-bot-heartbeat-vs-candle-interval.md`, `raw/2026-04-07-e2e-testing-v3-backlog.md` (re-read `phase-plan-v3` for rollout summary refresh)
- **Wiki:** `wiki/sources/phase3-implementation-summary.md`, `wiki/sources/bot-heartbeat-vs-candle-interval.md`, `wiki/sources/e2e-testing-v3-backlog.md`; updated `v3-phase-rollout-plan.md`, `dashboard-phase2-status.md` (raw stale on Phase 3 routes), `post-phases-polish-backlog.md`, `v3-planning-document-set.md`, `supabase-v3-migration.md`, `overview.md`, `entities/dstb-dashboard.md`, `index.md` (heartbeat link → `bot-heartbeat-vs-candle-interval`)
- **Notes:** Phase 1–3 marked shipped on main path; Phase 2 status **raw** still defers `/trades/[id]` — superseded by Phase 3 summary; heartbeat fixed via chunked `waitForNextCandle`; E2E layered backlog for future CI.

## [2026-04-07] ingest | Phase 4 behavior Supabase implementation (raw + wiki)

- **Raw:** `raw/2026-04-07-phase4-behavior-supabase-implementation.md`
- **Wiki:** added `wiki/sources/phase4-behavior-implementation.md`; updated `wiki/synthesis/v3-planning-document-set.md`, `wiki/entities/dstb-dashboard.md`, `index.md`
- **Notes:** Canonical record of shipped Phase 4 (migration `20260407140000_behavior_phase4.sql`, `BehaviorSupabaseSync`, `isolated-vm` runner, `behavior:backfill-supabase`, `BehaviorBot` Supabase hook, dashboard `/behavior` + cycle chart); watchlist covers long backfills, multiple active rulesets, in-memory `/behavior` pagination, Node `--no-node-snapshot`, Phase 5/6 still out of scope.

## [2026-04-08] ingest | v3 Phase 6 — environments, backtest HTTP, logs, LLM, ops (repo implementation)

- **Raw:** none (implementation recorded in repo only; plan aligned with `raw/2026-04-07-phase-plan-v3.md` Phase 6 + `raw/2026-04-07-dashboard-spec.md` §12–13)
- **Wiki:** added `wiki/concepts/multi-timeframe-bots-gap.md`; updated `wiki/entities/dstb-dashboard.md`, `wiki/synthesis/v3-planning-document-set.md`, `index.md`
- **Notes:** Dashboard: `/behavior/environments` pipeline, `derived_params` Zod + shared `insertConfigAndFirstVersion`, `/api/behavior/run-backtest` + `/api/behavior/generate-analyzer`, `/logs` + Realtime `bot_logs` migration `20260408120000_realtime_bot_logs.sql`. Bot: `src/backtest/runBacktestWithYahoo.ts`, `POST /behavior/run-backtest`, optional `BOT_AUTO_RESTART*`, `equityAlertJob` + env thresholds. Multi-timeframe live subscription deferred — see gap concept.
