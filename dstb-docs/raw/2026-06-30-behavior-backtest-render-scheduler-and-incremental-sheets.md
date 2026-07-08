# Behavior backtest — Render daily scheduler, incremental Google Sheets, and ops decisions

**Date:** 2026-06-30 (implementation) · **Ingested:** 2026-07-08  
**Repository:** `https://github.com/stanley121499/dstb-server.git` (account: `stanley121499`)  
**Context:** Chat session configuring the S2 behavior backtest to update Darren's Google Sheet nightly at **12:00 AM GMT+8**, running on the existing Render web service.

---

## 1. Goal

- Run the S2 behavior backtest (`npm run behavior:backtest`) **every day at midnight GMT+8**.
- Write results to the Google Sheet tab `S2-BO-BEHAVIOR-BTC` (configurable via `BEHAVIOR_SHEET_TAB`).
- Historical range starts **2021-11-07** (not 2024).
- Avoid wiping the sheet on nightly runs; only add missing days.
- Avoid Binance API rate-limit bans when fetching candle data.

---

## 2. Decisions made

### 2.1 Scheduling platform: Render in-process scheduler (chosen)

| Option | Outcome |
|--------|---------|
| **GitHub Actions `schedule`** | Rejected for daily runs. US-hosted runners hit Binance HTTP 451 (geo-block). Yahoo Finance limited 15m data to ~60 days. Bybit returned HTTP 403 from US IPs. |
| **GitHub Actions `workflow_dispatch`** | Kept for **manual** one-off runs only (`.github/workflows/behavior-backtest.yml`). |
| **Render in-process scheduler** | **Chosen.** `src/server/behaviorBacktestJob.ts` runs inside the existing web service started by `npm run start`. Runs on startup and at each midnight GMT+8. |

**Rationale:** Render service was already deployed; non-US region (Singapore) can reach Binance; no extra Render cron service needed.

### 2.2 Render region

- Default Render US region also received Binance HTTP 451.
- **Manual ops decision:** change Render service region to **Singapore** so Binance kline API is reachable.

### 2.3 Data source: Binance (reverted)

During GitHub Actions experimentation the data source was temporarily switched to Yahoo Finance and Bybit. Once scheduling moved to Render (Singapore), the backtest reverted to **`fetchBinanceCandles`** in `src/data/binanceDataSource.ts`.

### 2.4 Logging visibility on Render

- `Logger` (`src/core/Logger.ts`) writes to **files only**, not stdout.
- Render log stream shows **stdout/stderr** only.
- **Fix:** `behaviorBacktestJob.ts` logs via `console.log` / `console.error` in addition to the file logger so job progress appears in Render dashboard logs.

### 2.5 Google Sheet header alignment

`BehaviorSheetsReporter.HEADER_ROW` and `rowToArray()` were updated to match Darren's required **40-column** sequence. Removed leading `Entry Date` / `UID` columns and trailing stats columns that were not in the spec.

**Important behavior:** `bulkWrite()` **clears** the sheet (`A:AZ`) before rewriting. This caused data loss when early GH Actions runs only wrote a single day. Incremental mode (below) avoids calling `bulkWrite` on nightly runs.

### 2.6 Historical start date

- Initially defaulted to `2024-01-01` / `2024-11-07` in various places.
- **Corrected to `2021-11-07`** in `behaviorBacktestData.ts` and the GH Actions workflow default.

### 2.7 Incremental sheet updates (2026-06-30)

**Problem:** Nightly full backfill from 2021-11-07 fetched ~4.5 years of 15m candles every night → Binance HTTP **418** ("Way too much request weight used, IP banned") on 2026-06-26.

**Solution:**

1. On each run, **read the last date** from column E (`Date (dd/mm/yyyy)`) via `BehaviorSheetsReporter.readLastRowDate()`.
2. If sheet has data → fetch only `(lastDate + 1 day)` through yesterday → **`appendRows()`** (no clear).
3. If sheet is empty → full backfill from `BEHAVIOR_BACKTEST_START` → **`bulkWrite()`** + dashboard tab refresh.
4. If sheet is already up to date → exit early ("nothing to do").
5. `--full` CLI flag forces full backfill regardless.

### 2.8 Binance rate limiting

Added **300ms delay** between paginated kline requests in `fetchBinanceCandles` (~400 weight/min, under Binance's 1200/min limit). Protects full backfills; incremental nightly runs only need a handful of requests.

### 2.9 DST-aware session labels

`BehaviorAnalyzer` and `utils.ts` updated with four DST variant tables (STD, US_DST, UK_DST, BOTH_DST). `getSessionVerboseLabel()` selects the correct verbose label per candle timestamp.

### 2.10 Render free tier reliability

Render free tier **spins down** after inactivity. Observed gap: no nightly runs **2026-06-19 through 2026-06-24** while instance was down. Manual redeploy restarts the scheduler (runs on startup). Paid plan or external keep-alive (e.g. UptimeRobot on `/health`) recommended for reliability.

### 2.11 Opt-out env var

`BEHAVIOR_BACKTEST_DISABLED=true` on Render skips starting the scheduler (`src/server/index.ts`).

### 2.12 Local Python scripts (not committed)

A standalone `scripts/behavior_populate.py` + `scripts/README_DARREN.md` exists locally as an alternative for Darren to run outside the server. Added to **`.gitignore`** (`scripts/`, `scripts.rar`) — not part of the Node/Render pipeline.

---

## 3. Implementation map

| Component | Path | Role |
|-----------|------|------|
| Daily scheduler | `src/server/behaviorBacktestJob.ts` | Startup run + midnight GMT+8 timeout; `lastRunDate` dedup |
| Server integration | `src/server/index.ts` | Calls `startBehaviorBacktestScheduler` unless disabled |
| Backtest entry | `src/behavior/scripts/runBehaviorBacktest.ts` | Full vs incremental logic; `--full`, `--dry-run`, `--verbose` |
| Data loading | `src/behavior/scripts/behaviorBacktestData.ts` | Binance candles, daily cycle inputs; default start `2021-11-07` |
| Sheets reporter | `src/behavior/reporter/BehaviorSheetsReporter.ts` | `readLastRowDate()`, `appendRows()`, `bulkWrite()`, 40-col header |
| Binance fetch | `src/data/binanceDataSource.ts` | Paginated klines + 300ms throttle |
| Manual GH workflow | `.github/workflows/behavior-backtest.yml` | `workflow_dispatch` only; comment notes Render handles daily schedule |
| Deploy notes | `DEPLOY-RENDER.md` | General Render deploy; **does not yet** document behavior scheduler (see wiki) |

---

## 4. Environment variables (Render)

| Variable | Required | Default / notes |
|----------|----------|-----------------|
| `GOOGLE_SHEETS_ID` | Yes | Spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes | Path to service account JSON (use Render secret file, e.g. `/etc/secrets/google-sa-key.json`) |
| `BEHAVIOR_SHEET_TAB` | No | `S2-BO-BEHAVIOR-BTC` |
| `BEHAVIOR_BACKTEST_START` | No | `2021-11-07` (full backfill start) |
| `BEHAVIOR_BACKTEST_END` | No | Today UTC |
| `BEHAVIOR_PAIR` | No | `BTC-USD` |
| `BEHAVIOR_BACKTEST_DISABLED` | No | Set `true` to disable scheduler |

Service account must have edit access to the spreadsheet.

---

## 5. Runtime behavior (daily ops)

```
Server start (Render deploy / restart)
  └─ behaviorBacktestJob: run immediately (reason: "startup")
  └─ schedule timeout → next midnight GMT+8 (+ 30s buffer)

Each run → runBehaviorBacktest()
  ├─ readLastRowDate() from sheet col E
  ├─ incremental: fetch missing days → appendRows()
  ├─ empty sheet: full backfill → bulkWrite() + dashboard refresh
  └─ up to date: exit

Midnight GMT+8 (= 16:00 UTC previous calendar day in winter; job uses GMT+8 date math)
  └─ runIfNeeded("scheduled midnight GMT+8") → reschedule
```

**CLI equivalents:**

```bash
npm run behavior:backtest              # incremental (default when sheet has data)
npm run behavior:backtest -- --full    # force full backfill
npm run behavior:backtest -- --dry-run # analyze only, no sheet write
```

---

## 6. Incidents and fixes (timeline)

| Date | Issue | Resolution |
|------|-------|------------|
| Early Jun 2026 | GH Actions Binance 451 | Abandoned scheduled GH Actions |
| Mid Jun 2026 | Sheet wiped to 1 row | Caused by `bulkWrite` + single-day GH run; fixed by full-range runs, then incremental append |
| Mid Jun 2026 | Scheduler logs invisible on Render | Added `console.log` in job |
| Mid Jun 2026 | Render US Binance 451 | Changed region to Singapore |
| 2026-06-18–24 | No nightly runs | Free tier spin-down; manual redeploy |
| 2026-06-26 | Binance 418 IP ban | Full nightly re-fetch; fixed by incremental updates + throttle |
| 2026-06-30 | Start date wrong (2024) | Corrected to `2021-11-07` |

---

## 7. Key commits (main branch)

- `9dd40e2` — In-process daily scheduler on Render; revert data source to Binance
- `01d4c88` — Sheet header 40-column alignment
- `de43d58` — Backtest job stdout logging for Render
- `e321dce` — Backtest start date `2021-11-07`
- `c4c4936` — Incremental sheet updates, Binance rate limiting, DST-aware session labels

---

## 8. Open questions / watchlist

1. **Dashboard tab on incremental runs:** `BehaviorDashboardReporter.write()` runs only on full `bulkWrite`, not on incremental append. Confirm whether Darren needs dashboard refreshed nightly or only on full rebuild.
2. **Free tier gaps:** Incremental mode catches up missing days on next successful run (fetches from `lastDate + 1` to yesterday). Long outages still work but may fetch multiple days in one run.
3. **`behaviorBacktestJob.ts` comment drift:** File comment still mentions default start `2024-11-07`; code default is `2021-11-07` in `behaviorBacktestData.ts`.
4. **`DEPLOY-RENDER.md`:** Does not document behavior scheduler env vars — wiki is canonical until deploy doc is updated.
5. **Supabase behavior backfill:** Phase 4 `behavior:backfill-supabase` is a separate pipeline; this doc covers **Google Sheets** nightly ops only.

---

## 9. Related but out of scope

- Phase 4/5 Supabase behavior tables and dashboard editor (`wiki/sources/phase4-behavior-implementation.md`, `phase5-behavior-implementation.md`).
- `scripts/behavior_populate.py` — local Python alternative; gitignored.
