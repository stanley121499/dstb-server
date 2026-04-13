---
title: "DSTB Server — wiki overview"
type: overview
updated: 2026-04-08
sources: 6
tags: [dstb, overview]
---

# DSTB Server — wiki overview

This vault implements the **LLM Wiki** pattern for the `dstb-server` repository: curated **raw** sources under `raw/`, synthesized **wiki** pages here, and navigation via [[../index|index.md]] plus [[../log|log.md]].

## What the project is

A **cryptocurrency trading bot** with plugin strategies, Bitunix (and paper) execution, backtesting, and monitoring (Telegram, Google Sheets, email). **Ops state** increasingly lives in **Supabase** with a **Next.js dashboard** under `dashboard/`; legacy **CLI + SQLite** docs remain in `raw/docs/` for parts not yet reconciled. See the repository `README.md` for commands and safety notes.

## Where things live

| Kind | Location |
|------|----------|
| Wiki (this layer) | `dstb-docs/wiki/` |
| Raw markdown + HTML doc archive | `raw/docs/` (migrated from former repo `docs/`) |
| New sources to ingest | `raw/` (besides `raw/docs/` if you want separation) |
| Dashboard (Phase 2) | `dashboard/` — see [[entities/dstb-dashboard|DSTB dashboard]] |
| Agent rules | Repo root `CLAUDE.md` |

## Reading order (from doc index)

Aligned with [raw/docs/README.md](../raw/docs/README.md):

1. [Architecture](../raw/docs/architecture.md) — end-to-end system
2. [Deployment](../raw/docs/deployment-guide.md)
3. [CLI reference](../raw/docs/cli-reference.md)
4. [Strategy plugin guide](../raw/docs/strategy-plugin-guide.md)
5. [Monitoring](../raw/docs/monitoring-setup.md)

## Doc index parity

The legacy index table in `raw/docs/README.md` still lists numbered doc aliases (e.g. `12` → ORB-ATR). On disk, filenames are descriptive (`strategy-orb-atr.md`, etc.). Use [[concepts/documentation-index|documentation index]] for a wiki-side map.

## Forward-looking plans (v3) and phased delivery

Roadmap: `raw/2026-04-07-*.md` → [[synthesis/v3-planning-document-set|v3 planning document set]], [[concepts/supabase-v3-migration|Supabase v3 migration]]. **Phase 1** (Postgres, bot server, Realtime, `bot_logs`): [[sources/deploy-runtime-supabase-notes|deploy/runtime]], [[sources/bot-logs-gap-and-integration-plan|bot_logs]]. **Phase 2** (dashboard): [[sources/dashboard-phase2-status|status]], [[entities/dstb-dashboard|entity]]. **Phase 3** (trade detail + analytics): [[sources/phase3-implementation-summary|implementation summary]]; **ops:** [[sources/bot-heartbeat-vs-candle-interval|heartbeat vs bar interval]] (long-interval bots need chunked sleep for `last_heartbeat`). **Phase 6** (environment pipeline + backtest + logs + optional LLM): [[entities/dstb-dashboard|dashboard entity]] (routes); **multi-timeframe live bots** gap: [[concepts/multi-timeframe-bots-gap|multi-timeframe bots gap]]. **E2E backlog:** [[sources/e2e-testing-v3-backlog|E2E testing v3 backlog]]. **Post–Phase 6 polish** (richer spec UX): [[concepts/post-phases-dashboard-polish|polish concept]], [[sources/post-phases-polish-backlog|backlog source]]. `raw/docs/` may still describe SQLite-first flows in places.

## Next steps for the wiki

- Add entity pages for major subsystems (`TradingBot`, exchange adapters, backtest engine) as you ingest or refactor.
- Run periodic **lint** passes (see `CLAUDE.md`) to catch orphans and stale claims vs code.
