---
title: "Source summary — bot last_heartbeat vs candle interval"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, ops, trading-bot, supabase]
---

# Source summary: bot `last_heartbeat` vs candle interval

**Raw path:** [`raw/2026-04-07-bot-heartbeat-vs-candle-interval.md`](../../raw/2026-04-07-bot-heartbeat-vs-candle-interval.md)

## Summary

**Symptom:** Dashboard showed heartbeat “4h ago” for healthy bots on **long bar** strategies. **Cause:** `updateHeartbeatIfNeeded()` ran only after strategy work; `waitForNextCandle()` slept the full interval, and unchanged-candle iterations could skip the heartbeat path — so `bots.last_heartbeat` tracked **candle cadence**, not `heartbeatIntervalMs` (~30s).

**Fix:** `waitForNextCandle()` sleeps in **chunks** of `min(heartbeatIntervalMs, interval)` and calls `updateHeartbeatIfNeeded()` each chunk while running. **File:** `src/core/TradingBot.ts` (`waitForNextCandle`).

## Verification

SQL on `bots.last_heartbeat`; dashboard Realtime “Xm ago”; logs if DB/RLS errors.

## Cross-references

- [[v3-phase-rollout-plan|Phase plan v3]] (Phase 1 heartbeat deliverable)
- `src/core/SupabaseStateStore.ts` — `updateBotHeartbeat`
