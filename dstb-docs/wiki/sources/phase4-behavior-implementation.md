---
title: "Source summary — Phase 4 behavior Supabase implementation"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, phase-4, behavior, supabase, isolated-vm, dashboard]
---

# Source summary: Phase 4 (v3) — behavior in Supabase (implemented)

**Raw path:** [`raw/2026-04-07-phase4-behavior-supabase-implementation.md`](../../raw/2026-04-07-phase4-behavior-supabase-implementation.md)

## One-line summary

Phase 4 behavior tables + migration seed, `BehaviorSupabaseSync` (native TypeScript analyzer + optional `isolated-vm` sandbox), `behavior:backfill-supabase` CLI, `BehaviorBot` live upserts when Supabase env is set, dashboard **`/behavior`** and cycle detail chart — with explicit **watchlist** (scale, Node flags, multiple active rulesets).

## Notable facts (from raw)

- **Migration:** `supabase/migrations/20260407140000_behavior_phase4.sql` — RLS, Realtime on `behavior_results`, seed `native_s2` analyzer + default ruleset.
- **Backfill** recomputes from **candles** (same pipeline as behavior backtest), **not** Google Sheets import.
- **Sheets** remain optional for live/backtest reporting.
- **Phase 5/6** (editor, environments UI) **not** in this delivery; `behavior_environments` table is forward-looking.

## Open questions / follow-ups

- See raw **§7 Watchlist** and **§8 Planned follow-on**.

## Cross-references

- [[v3-phase-rollout-plan|Phase plan v3]] · [[v3-supabase-schema-design|Schema design]] · [Behavior system design (raw)](../../raw/2026-04-07-behavior-system-design.md)
- [[phase3-implementation-summary|Phase 3 implementation]] (prior shipped phase)
- [[../entities/dstb-dashboard|Dashboard entity]] · [[../synthesis/v3-planning-document-set|v3 synthesis]]
