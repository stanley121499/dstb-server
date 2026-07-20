---
title: "Source summary — Behavior backtest Render scheduler + incremental Sheets"
type: source-summary
updated: 2026-07-20
sources: 1
tags: [dstb, behavior, backtest, render, google-sheets, ops]
---

# Source summary: Behavior backtest — Render daily scheduler + incremental Sheets

**Raw path:** [`raw/2026-06-30-behavior-backtest-render-scheduler-and-incremental-sheets.md`](../../raw/2026-06-30-behavior-backtest-render-scheduler-and-incremental-sheets.md)

## One-line summary

S2 behavior backtest runs **in-process on Render** at **midnight GMT+8** (and on startup); **incremental Google Sheets** updates read the last row date and append only missing days; Binance fetch throttled; full backfill from **2021-11-07** when sheet is empty.

## Notable facts (from raw)

- **Scheduler:** `src/server/behaviorBacktestJob.ts` — integrated in `src/server/index.ts`; opt out with `BEHAVIOR_BACKTEST_DISABLED=true`.
- **Incremental logic:** `runBehaviorBacktest.ts` → `readLastRowDate()` (col E) → fetch gap → `appendRows()` → `readAllBehaviorRows()` + dashboard `write()` → sync-log append; `--full` forces `bulkWrite()` + dashboard refresh + sync-log.
- **GH Actions:** `.github/workflows/behavior-backtest.yml` is **manual only**; daily schedule lives on Render.
- **Binance:** Singapore Render region required; 300ms pagination delay; nightly incremental = few requests (avoids 418 bans).
- **Logging:** `console.log` in job for Render stdout; file `Logger` alone is insufficient; sheet audit tab `BEHAVIOR-SYNC-LOG` (`BehaviorSyncLogReporter`).
- **Sheet:** 40-column header; `bulkWrite` clears sheet — never used on incremental nightly path.
- **Free tier:** spin-down caused missed runs (observed 2026-06-19–24); incremental catches up on next successful run.

## Open questions / follow-ups

- `DEPLOY-RENDER.md` not yet updated with scheduler env vars.
- Stale comment in `behaviorBacktestJob.ts` (says `2024-11-07`; code default is `2021-11-07`).

## Resolved (2026-07-20)

- Overview dashboard no longer refreshes on full runs only — incremental appends and “already up to date” paths recompute `BEHAVIOR-OVERVIEW-DASHBOARD` from the full raw sheet (`readAllBehaviorRows`).
- Append-only `BEHAVIOR-SYNC-LOG` tab records ran-at (GMT+8), mode, rows written, dashboard refresh, last raw date, and notes after every successful path.

## Cross-references

- [[../concepts/behavior-backtest-daily-ops|Behavior backtest daily ops]] — ops concept page
- [[phase4-behavior-implementation|Phase 4 Supabase behavior]] — separate Sheets vs Supabase backfill path
- [[../entities/dstb-trading-bot|Trading bot entity]]
- [Deploy Render (repo)](../../../DEPLOY-RENDER.md) · [GH workflow (repo)](../../../.github/workflows/behavior-backtest.yml)
