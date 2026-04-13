---
title: "Source summary — post-phases polish backlog"
type: source-summary
updated: 2026-04-07
sources: 2
tags: [dstb, dashboard, backlog, ux]
---

# Source summary: post-phases polish backlog

**Raw path:** [`raw/2026-04-07-post-phases-polish-backlog.md`](../../raw/2026-04-07-post-phases-polish-backlog.md)

## Summary

**When:** After **Phase 6** (or a dedicated polish sprint) — **not** required to mark Phase 2 complete against the phase plan. Aligns the product with the **richer** [dashboard spec](../../raw/2026-04-07-dashboard-spec.md).

## Thematic buckets

- **Dashboard UI:** structured strategy forms (vs JSON textarea), Save & Restart, version **diff** viewer, one-click **restore** as new version, trade log **multi-select** bots, CSV export. **Trade detail** (`/trades/[id]`) is **shipped** (Phase 3); remaining items are richer spec/UX.
- **Auth / data / observability:** version attribution (“who”), Unicode policy, E2E login testing pattern.
- **Infra / docs:** Vercel runbook wiki page, RLS review for dashboard queries, Realtime coverage audit for Phase 3+.

## Suggested order (non-binding)

Post–Phase 6 prioritize Save & Restart, structured forms, version diff, then CSV / multi-select by demand. **E2E / CI:** see [[e2e-testing-v3-backlog|E2E testing backlog]].

## Cross-references

- [[dashboard-phase2-status|Phase 2 status]] (what shipped)
- [[../concepts/post-phases-dashboard-polish|Concept: post-phases dashboard polish]]
- [[v3-phase-rollout-plan|Phase plan v3]]
