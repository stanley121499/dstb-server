---
title: "Source summary — E2E testing v3 backlog"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, testing, ci, dashboard, supabase]
---

# Source summary: E2E testing — v3 backlog

**Raw path:** [`raw/2026-04-07-e2e-testing-v3-backlog.md`](../../raw/2026-04-07-e2e-testing-v3-backlog.md)

## Summary

Original v3 plans did not define **E2E** coverage. This raw note proposes a **layered** approach: (1) Supabase local/branch + seed, (2) bot server smoke (`/health`, optional heartbeat check), (3) Playwright/Cypress on dashboard (login, grid, toggle, trades → `/trades/:id`, analytics + compare), optional Realtime assertion, (4) optional full golden path (paper trade → `trade_candles` → chart). **CI:** PR = layers 1–2 + subset; nightly = broader. Calls out secrets, exchange mocking, deterministic time for analytics.

## Cross-references

- [[v3-phase-rollout-plan|Phase plan v3]] — suggests a future “Quality / E2E” subsection
- [[post-phases-polish-backlog|Post-phases polish]] — orthogonal UX backlog; may share CI budget
- [[phase3-implementation-summary|Phase 3 implementation summary]] — routes to test once layered E2E is built
