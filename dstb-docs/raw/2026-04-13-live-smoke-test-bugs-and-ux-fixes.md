# 2026-04-13 — Live smoke test: bugs found, status UX fixes, loading states

**Session type:** Post-deployment smoke test, bug identification, UX polish  
**Date:** 2026-04-13  
**Scope:** Live Vercel dashboard + Render bot server (post v3 deployment)

---

## 1. What was done

### 1a. Bot disable attempt (user-reported UX issue)
User tried to toggle off all bots from the dashboard. Visually the action appeared to do nothing — toggles showed no feedback and bot cards still showed green "Running" status with a "1h ago" heartbeat. Root cause: two independent bugs (see §2).

### 1b. Bots were already dead
Both ETH Live Bot v3 and ORB BTC 15m had last heartbeats ~1h before the toggle attempt. The `bots.status` column in Supabase was still `"running"` because the bot server's crash path never wrote `"stopped"` back to the table. The dashboard was showing completely stale status.

### 1c. ETH Live Bot v3 disabled via browser automation
The toggle click was confirmed successful (aria snapshot dropped `[checked]` state). The last bot logs visible were from `2026-04-13T16:12:53` UTC — about 85 minutes prior to the disable action.

---

## 2. Bugs found and fixed

### Bug A — `TradingBot.stop()` never updates `bots.status`

**File:** `src/core/TradingBot.ts`  
**Problem:** `stop()` set `this.isRunning = false`, fired a `bot_session_stop` log, and disconnected the exchange. It never called `stateManager.updateBotStatus(this.id, "stopped")`. After any crash or config disable, `bots.status` remained `"running"` indefinitely.  
**Fix:** Added `await this.stateManager.updateBotStatus(this.id, "stopped")` as the first action inside `stop()`, wrapped in try/catch so a DB failure doesn't block the rest of the shutdown sequence.

### Bug B — Dashboard bot card ignores `configs.enabled` and heartbeat staleness

**File:** `dashboard/components/bot-grid.tsx`  
**Problem:** The card derived status purely from `bots.status`. A disabled config with a stale "running" bot record showed a green dot and "Running" text. The "Running 2" header count included dead/disabled bots.  
**Fix:** Added `effectiveStatus(enabled, botStatus, heartbeatStale)` function:
- If `configs.enabled === false` → returns `"disabled"` (grey dot, card dims to 60% opacity)
- If `bot.status === "running"` AND heartbeat stale (>5 min) → returns `"unresponsive"` (amber dot + amber text)
- Otherwise falls through to `bot.status`

The "Running" counter in the header now only counts bots with `effectiveStatus === "running"`.

---

## 3. Loading / UX improvements

All routes had zero loading feedback. Clicking a nav link showed a blank screen until the Supabase fetch completed (1–3 seconds), making the app feel broken.

### 3a. Route-level `loading.tsx` skeleton screens
Created `loading.tsx` files for all major routes:

| File | Mirrors |
|------|---------|
| `dashboard/app/loading.tsx` | Bots grid (4 skeleton cards + header stats) |
| `dashboard/app/trades/loading.tsx` | Filter card + 12-row table |
| `dashboard/app/logs/loading.tsx` | Filter card + 15-row table |
| `dashboard/app/analytics/loading.tsx` | Filter card + 8 stat cards + 2 chart areas |
| `dashboard/app/behavior/loading.tsx` | Filter card + pagination controls + 10-row table |
| `dashboard/app/config/loading.tsx` | Two-column form + version history sidebar |

Next.js shows these Suspense fallbacks **immediately** on link click before the server component fetch resolves, eliminating the blank-screen gap.

### 3b. NavBar pending link indicator
`dashboard/components/shell/NavBar.tsx` — tracks which link was clicked via `pendingHref` state. Shows a small pulsing dot beacon next to the active link and dims it slightly until `usePathname()` changes (navigation complete). Fires a `navigationStart` custom DOM event for the progress bar.

### 3c. Top navigation progress bar
`dashboard/components/shell/NavigationProgress.tsx` — a 3px primary-coloured fixed bar at the very top of the viewport. Animates on `navigationStart` event, snaps to full width and fades out when the pathname changes. Included in `AppShell`.

### 3d. Bot toggle per-switch loading state
`dashboard/components/bot-grid.tsx` — `pendingToggles: Set<string>` tracks which config IDs are mid-update. The Switch is `disabled` and `opacity-50` while the Supabase call is in flight, preventing double-clicks and giving immediate visual confirmation that the action was received.

---

## 4. Remaining open issues (not fixed this session)

### Issue A — ETH Live Bot v3 crash loop (root cause unknown)
The bot was entering a rapid restart loop (start → 1 candle → `bot_session_stop` → auto-restart → repeat). Logs show `strategy_hold` signals firing normally on ETH-USD via Bitunix, so it's not a strategy logic error. The exact exception was not retrieved this session — ERROR-level logs need to be pulled to identify the cause (likely a Bitunix API error on ETH-USD symbol, possibly expecting `ETHUSDT` format). Bot is now disabled.

**Next steps:**
1. Pull `/logs?bot=ETH+Live+Bot+v3&level=ERROR` from the dashboard
2. Identify the failing exchange call
3. Fix the symbol format or exchange adapter error handling
4. Investigate whether `BOT_AUTO_RESTART` is set on Render with insufficient backoff delay (crash loop was restart-every-second)

### Issue B — ORB BTC 15m reconcile storm (50+ duplicate trades)
The BTC bot generated 50+ trades within a 4-minute window (16:00–16:04 UTC) all sharing the **exact same entry price** (71700.82) with varied exit prices and reasons (`reconcile_missing_exchange`, `exchange_closed_externally`). This is a state race condition:

**Likely cause:** `SupabaseStateStore.createPosition` has no application-level uniqueness guard. If the exchange reports a position as closed (possibly due to API lag), `reconcilePositions` in `TradingBot` closes the DB position with `closePosition`, then on the next loop creates a new `createPosition` for the same exchange position that may have reappeared. Without a DB-level unique constraint on `(bot_id, is_open=true)` or a cooldown, this loop repeats rapidly.

**Next steps:**
1. Add a unique partial index on `positions(bot_id)` WHERE open (or add application-level guard in `SupabaseStateStore.createPosition`)
2. Add a reconcile cooldown (`lastReconcileMs`) in `TradingBot` to prevent reconcile from running more than once per candle interval
3. Consider a `positions` table column `created_at` timestamp to detect and deduplicate rapid re-creation

---

## 5. Commits in this session

| Commit | Description |
|--------|-------------|
| `44a8ef2` | feat: add loading skeletons, nav pending state, bot toggle UX, `TradingBot.stop()` status fix, `effectiveStatus()` dashboard card |

---

## 6. Architecture notes

- **Bot server (Render):** Stateful Node.js process. `BotManager` subscribes to `configs` Realtime and restarts bots on config changes. `stopBotWithoutDisabling` calls `bot.stop()` but (before this fix) did not write `"stopped"` to DB.
- **Dashboard (Vercel):** Stateless Next.js. Bot grid subscribes to `configs` and `bots` Realtime for live refresh. Toggle writes directly to `configs.enabled` via `createBrowserSupabaseClient`.
- **Status lifecycle (post-fix):** Bot starts → `updateBotStatus("running")` on `loadState()` → heartbeat every N candles → `stop()` writes `"stopped"` → Realtime triggers dashboard `router.refresh()`.
