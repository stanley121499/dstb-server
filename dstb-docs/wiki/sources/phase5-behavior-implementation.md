---
title: "Source summary — Phase 5 behavior editor + self-service analysis"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, phase-5, behavior, dashboard, isolated-vm, supabase]
---

# Source summary: Phase 5 (v3) — behavior editor (implemented)

**Raw path:** [`raw/2026-04-07-phase5-behavior-editor-implementation.md`](../../raw/2026-04-07-phase5-behavior-editor-implementation.md)

## One-line summary

Dashboard analyzer + ruleset CRUD (Monaco, test run, batch reanalysis proxy), bot `POST /behavior/*` behind `BEHAVIOR_API_SECRET`, migrations for single active ruleset + trades P&L RPC, ruleset compare with **Realized P&L (matched by date)** fuzzy join — with explicit **watchlist** and **Phase 6** follow-ons.

## Notable facts (from raw)

- **Bot HTTP:** `src/server/behaviorHttpHandlers.ts` + `BehaviorSupabaseSync.testRunAnalyzer` / `reanalyzeRulesetForAllCycles`.
- **Migrations:** `20260407150000_behavior_ruleset_single_active.sql`, `20260407150100_trades_pnl_by_exit_date_fn.sql`.
- **Dashboard routes:** `/behavior/analyzers`, `/behavior/rulesets`, `/behavior/rulesets/compare`; prompt at `dashboard/public/behavior-analyzer-prompt.md`.
- **Phase 6** (environments UI, etc.) **not** in this delivery.

## Open questions / follow-ups

- See raw **§6 Watchlist** and **§7 Planned follow-on**.

## Cross-references

- [[v3-phase-rollout-plan|Phase plan v3]] · [[phase4-behavior-implementation|Phase 4 implementation]] · [Dashboard spec (raw)](../../raw/2026-04-07-dashboard-spec.md)
- [[../entities/dstb-dashboard|Dashboard entity]] · [[../synthesis/v3-planning-document-set|v3 synthesis]]
