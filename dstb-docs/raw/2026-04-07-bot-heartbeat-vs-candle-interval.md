# Bot `last_heartbeat` vs candle interval (ops note)

**Date:** 2026-04-07  
**Symptom:** Dashboard bot grid shows heartbeat “4h ago” (or similar) for a bot whose strategy runs on a **4h** (or other long) bar, even though the process is healthy.

## Root cause (fixed in code)

`TradingBot` only called `updateHeartbeatIfNeeded()` **inside** the main loop **after** strategy work. The loop then called `waitForNextCandle()`, which slept the **entire** configured interval (e.g. 4 hours).

Additionally, when the latest candle was **unchanged** (`candle.timeUtcMs <= lastCandleTime`), the loop called `waitForNextCandle()` and **continued** without ever hitting the heartbeat step for that iteration.

So Supabase `bots.last_heartbeat` was updated at roughly **candle cadence**, not every `heartbeatIntervalMs` (default 30s).

## Fix

`waitForNextCandle()` was changed to sleep in **chunks** of `min(heartbeatIntervalMs, interval)` and call `updateHeartbeatIfNeeded()` after each chunk, while `this.isRunning` remains true. Operational liveness in the UI now reflects ~30s updates regardless of bar size.

**File:** [`src/core/TradingBot.ts`](../../src/core/TradingBot.ts) — method `waitForNextCandle`.

## Verification checklist

1. **Supabase:** `select id, last_heartbeat from bots order by last_heartbeat desc nulls last` — should advance every ~30s while bot runs.
2. **Dashboard:** Bot grid uses Realtime on `bots`; relative “Xm ago” should stay small.
3. **Render / logs:** If heartbeat stays stale, check process crash, DB RLS / service role, or `updateBotHeartbeat` errors in server logs.

## Related

- Phase 1 plan: heartbeat + equity on interval ([`2026-04-07-phase-plan-v3.md`](2026-04-07-phase-plan-v3.md)).
- [`SupabaseStateStore.updateBotHeartbeat`](../../src/core/SupabaseStateStore.ts).
