---
title: "DSTB Server — wiki overview"
type: overview
updated: 2026-04-07
sources: 2
tags: [dstb, overview]
---

# DSTB Server — wiki overview

This vault implements the **LLM Wiki** pattern for the `dstb-server` repository: curated **raw** sources under `raw/`, synthesized **wiki** pages here, and navigation via [[../index|index.md]] plus [[../log|log.md]].

## What the project is

A **CLI-first cryptocurrency trading bot** with plugin strategies, Bitunix (and paper) execution, SQLite state, backtesting, and monitoring (Telegram, Google Sheets, email). See the repository `README.md` for commands and safety notes.

## Where things live

| Kind | Location |
|------|----------|
| Wiki (this layer) | `dstb-docs/wiki/` |
| Raw markdown + HTML doc archive | `raw/docs/` (migrated from former repo `docs/`) |
| New sources to ingest | `raw/` (besides `raw/docs/` if you want separation) |
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

## Forward-looking plans (v3)

A **Supabase + dashboard + sandboxed behavior** roadmap lives in `raw/2026-04-07-*.md` (phase plan, schema, architecture, behavior system, dashboard spec). The wiki summarizes it under [[synthesis/v3-planning-document-set|v3 planning document set]] and [[concepts/supabase-v3-migration|Supabase v3 migration (concept)]]. **Current shipped code** remains SQLite + CLI-first unless/until those phases are implemented.

## Next steps for the wiki

- Add entity pages for major subsystems (`TradingBot`, exchange adapters, backtest engine) as you ingest or refactor.
- Run periodic **lint** passes (see `CLAUDE.md`) to catch orphans and stale claims vs code.
