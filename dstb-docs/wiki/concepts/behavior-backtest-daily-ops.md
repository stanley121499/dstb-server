---
title: "Concept — Behavior backtest daily ops (Render + Google Sheets)"
type: concept
updated: 2026-07-20
sources: 1
tags: [dstb, behavior, backtest, render, google-sheets, ops]
---

# Concept: Behavior backtest daily ops

Canonical ops reference for the **S2 behavior backtest → Google Sheets** nightly pipeline on Render. Implementation detail: [[../sources/behavior-backtest-render-scheduler|source summary]] · raw: [`raw/2026-06-30-behavior-backtest-render-scheduler-and-incremental-sheets.md`](../../raw/2026-06-30-behavior-backtest-render-scheduler-and-incremental-sheets.md).

## What runs where

| Layer | Mechanism |
|-------|-----------|
| **Schedule** | In-process on the Render web service (`npm run start`) — not a separate cron job |
| **Trigger times** | Server startup + every **midnight GMT+8** |
| **Analysis** | `npm run behavior:backtest` → `runBehaviorBacktest.ts` |
| **Output** | Google Sheet tabs: raw `S2-BO-BEHAVIOR-BTC`, overview `BEHAVIOR-OVERVIEW-DASHBOARD`, audit `BEHAVIOR-SYNC-LOG` |

GitHub Actions workflow exists for **manual** runs only (US runners cannot reach Binance).

## Incremental vs full

| Mode | When | Sheet write |
|------|------|-------------|
| **Incremental** | Sheet has data; default nightly path | `appendRows()` — does **not** clear; then refreshes dashboard from **all** sheet rows; appends sync-log row |
| **Full** | Empty sheet, `--full` flag, or first deploy | `bulkWrite()` — **clears** then rewrites; refreshes dashboard tab; appends sync-log row |
| **Up to date** | Last row date ≥ yesterday | Still refreshes dashboard from the full sheet (heals stale overview); appends sync-log row |

Incremental reads column **E** (`Date dd/mm/yyyy`), parses last row, fetches `(lastDate + 1)` through yesterday.

## Sync log tab (`BEHAVIOR-SYNC-LOG`)

Append-only audit history for Darren’s cross-check. Each successful backtest path appends one row (never clears):

| Col | Field |
|-----|--------|
| A | Ran At (GMT+8) |
| B | Mode (`incremental` / `full` / `up_to_date`) |
| C | Rows Written |
| D | Dashboard Refreshed (`YES` / `NO`) |
| E | Last Raw Date |
| F | Raw Row Count |
| G | Notes |

Created automatically if missing (`BehaviorSyncLogReporter`). Optional env: `BEHAVIOR_SYNC_LOG_TAB`.

## Required Render configuration

- **Region:** Singapore (or other non-US) for Binance API access
- **Env:** `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` (secret file path)
- **Optional:** `BEHAVIOR_SHEET_TAB`, `BEHAVIOR_DASHBOARD_TAB`, `BEHAVIOR_SYNC_LOG_TAB`, `BEHAVIOR_BACKTEST_START` (`2021-11-07`), `BEHAVIOR_PAIR` (`BTC-USD`)
- **Disable:** `BEHAVIOR_BACKTEST_DISABLED=true`

## Reliability notes

- Render **free tier** spin-down pauses the scheduler; redeploy or keep-alive on `/health` restores it. Missed days are backfilled incrementally on next successful run.
- Binance **rate limits:** full backfills throttle pagination (300ms); nightly incremental runs are lightweight.

## Distinction from Supabase backfill

[[../sources/phase4-behavior-implementation|Phase 4]] `behavior:backfill-supabase` writes to Postgres, not Darren's Google Sheet. Both use similar candle/analysis pipeline but serve different consumers.

## See also

- [[../entities/dstb-trading-bot|DSTB trading bot]] — server subsystem map
- [[../sources/behavior-backtest-render-scheduler|Source summary]]
