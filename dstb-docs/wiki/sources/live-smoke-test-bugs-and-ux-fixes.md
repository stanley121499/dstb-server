---
title: "Live smoke test — bugs and UX fixes (2026-04-13)"
type: source
updated: 2026-04-13
sources: 1
tags: [dstb, dashboard, bot, ux, bugfix, loading]
---

# Source: Live smoke test — bugs and UX fixes

**Raw file:** `raw/2026-04-13-live-smoke-test-bugs-and-ux-fixes.md`  
**Date:** 2026-04-13  
**Type:** Post-deployment session (bug identification + fix + UX polish)

---

## Summary

Post-v3-deployment smoke test of the live Vercel dashboard and Render bot server. Found two critical bugs causing the dashboard to show permanently stale "Running" status for dead/disabled bots, and added comprehensive loading state UX across all routes.

---

## Bugs fixed

### 1. `TradingBot.stop()` never updated `bots.status`

`stop()` set `isRunning = false` and disconnected the exchange but never called `stateManager.updateBotStatus(this.id, "stopped")`. After any crash or config disable, `bots.status` remained `"running"` indefinitely in Supabase.

**Fix:** `stop()` now calls `await this.stateManager.updateBotStatus(this.id, "stopped")` as its first action (try/catch so DB failure doesn't block shutdown).

**File:** `src/core/TradingBot.ts`

### 2. Bot card derived status from `bots.status` only — ignored `configs.enabled` and heartbeat age

A disabled config with a stale "running" bot record showed a green dot + "Running". A crashed bot with a 1h-old heartbeat showed "Running 2" in the header count.

**Fix:** Added `effectiveStatus(enabled, botStatus, heartbeatStale)`:
- `enabled === false` → `"disabled"` (card dims to 60% opacity, grey dot)
- `status === "running" && heartbeat > 5 min stale` → `"unresponsive"` (amber dot + amber text)
- Otherwise: passthrough `bots.status`

**File:** `dashboard/components/bot-grid.tsx`

---

## Loading state UX additions

### Route-level `loading.tsx` skeleton screens

Next.js Suspense fallbacks shown immediately on link click before server component fetch resolves. Each skeleton matches the real page's visual layout using `Skeleton` shimmer components.

| Route | File |
|-------|------|
| `/` (Bots) | `dashboard/app/loading.tsx` |
| `/trades` | `dashboard/app/trades/loading.tsx` |
| `/logs` | `dashboard/app/logs/loading.tsx` |
| `/analytics` | `dashboard/app/analytics/loading.tsx` |
| `/behavior` | `dashboard/app/behavior/loading.tsx` |
| `/config/*` | `dashboard/app/config/loading.tsx` |

### NavBar pending link indicator

`NavBar.tsx` tracks `pendingHref` state. Clicked link shows a pulsing beacon dot + slight opacity dim until `usePathname()` changes. Fires `navigationStart` DOM event for the progress bar.

### Top navigation progress bar

`NavigationProgress.tsx` — 3px fixed primary-coloured bar at viewport top. Pulses on `navigationStart`, fades out on pathname change. Included via `AppShell.tsx`.

### Bot toggle per-switch loading state

`pendingToggles: Set<string>` in `BotGrid`. Switch is `disabled` + `opacity-50` during the Supabase `.update()` call. Prevents double-clicks and gives immediate confirmation.

---

## Open issues resolved (2026-04-14)

### ETH Live Bot v3 crash loop — root cause found and fixed
The entire **server** was crashing, not just the bot. `TelegramAlerter.startPolling()` called `void this.pollOnce()` inside `setInterval`. When Render could not reach Telegram's API (`149.154.166.110:443` ETIMEDOUT + IPv6 ENETUNREACH), `pollOnce()` threw a `TypeError: fetch failed` that was never caught. Node.js 22 treats unhandled promise rejections as fatal and killed the process every ~1 minute.

**Fix (2026-04-14):** Added `.catch()` to the `void this.pollOnce()` call in `startPolling()`. Network failures now log a `telegram_poll_failed` WARN and continue instead of crashing.

**File:** `src/monitoring/TelegramAlerter.ts`

**Notes:**
- Symbol mapping (`ETH-USD` → `ETHUSDT`) was confirmed correct via `bitunixSymbolMapper.ts` — not the cause.
- Zero ERROR rows in `bot_logs` because `BotManager` logs crash events via its own server logger (Render console), not `persistThought`/Supabase.
- Bot can be re-enabled once the fixed server is deployed to Render.

### ORB BTC 15m reconcile storm — root cause found and fixed
The storm was a **consequence of the same server crash loop**. Each server restart ran `reconcilePositions()` at startup, which found the exchange position and created a new DB row. Then `syncPositionWithExchange()` on the first main loop iteration saw the exchange return "flat" (API lag) and immediately closed it, creating a trade. With ~1 restart/second, 50+ trades accumulated in 4 minutes.

**Fixes (2026-04-14):**

1. **Reconcile grace period** (`src/core/TradingBot.ts`): `reconcilePositions()` now sets `reconcileCreatedAtMs` when it creates a DB position from exchange. `syncPositionWithExchange()` skips closing any position within `RECONCILE_GRACE_PERIOD_MS` (60s) of a reconcile-create, preventing the immediate create→close cycle caused by exchange API lag. Grace flag is cleared once the period expires.

2. **Pre-insert uniqueness guard** (`src/core/SupabaseStateStore.ts`): `createPosition` now checks for an existing open position before inserting. If one exists it returns the existing ID with a `WARN` log instead of attempting a duplicate insert that would fail with a DB constraint error. (`positions(bot_id)` already has `UNIQUE (bot_id)` so the DB would reject it anyway — this makes the failure path explicit and clean.)

3. **Migration** (`supabase/migrations/20260414120000_positions_created_at.sql`): Added `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` to `positions` table for debugging and potential future age-based guards.

---

## Commits

| Commit | Description |
|--------|-------------|
| `44a8ef2` | feat: add loading skeletons, nav pending state, bot toggle UX, TradingBot.stop() status fix, effectiveStatus() dashboard card |
| *(pending)* | fix: TelegramAlerter unhandled rejection crash, reconcile storm guard, createPosition duplicate guard |

---

## See also

- [[../../entities/dstb-dashboard|DSTB dashboard entity]]
- [[../../entities/dstb-trading-bot|DSTB trading bot entity]]
- [[../../concepts/post-phases-dashboard-polish|Post-phases dashboard polish]]
