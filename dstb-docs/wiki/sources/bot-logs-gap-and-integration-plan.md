---
title: "Source summary — bot_logs gap and integration plan"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, supabase, bot_logs, operations]
---

# Source summary: `bot_logs` gap and integration plan

**Raw path:** [`raw/2026-04-07-bot-logs-gap-and-integration-plan.md`](../../raw/2026-04-07-bot-logs-gap-and-integration-plan.md)

## Summary

Argues that empty **`bot_logs`** was an **implementation gap**, not a spec waiver: v3 phase plan, architecture, schema, and dashboard all assume structured rows in Postgres. Documents prior state (`insertBotLog` only on `SupabaseStateStore`, **not** on `BotStateStore`; `Logger` disk-only; no call sites).

## Ordered integration plan (from raw)

1. Add **`insertBotLog`** to **`BotStateStore`**; Supabase implements; in-memory no-op.
2. **`TradingBot`** hooks: fire-and-forget after durable events (`bot_start`, `bot_stop`, trades, errors, etc.), bounded metadata.
3. Optional: **`Logger` → `bot_logs`** remote sink with rate limit.
4. **`BotManager` / server** control-plane events.
5. Operational notes: async, RLS/service role, CLI in-memory quiet.

## Implementation status (wiki check vs code)

**Done in repo:** `BotStateStore.insertBotLog`, `InMemoryBotStateStore` no-op, **`TradingBot.persistThought()`** calling `insertBotLog` for session lifecycle, strategy warmup/HOLD (throttled), entry/exit intents and blocks, external close, loop errors — see `src/core/TradingBot.ts`. Optional items from raw (**Logger bridge**, **BotManager** rows) may remain.

## Cross-references

- [[deploy-runtime-supabase-notes|Deploy / runtime / Supabase notes]] — older paragraph on “empty `bot_logs` expected” is **superseded** by this doc’s status section + code above
- [[v3-supabase-schema-design|Schema v3]] (`bot_logs` DDL)
- [[../concepts/supabase-v3-migration|Supabase v3 migration]]
