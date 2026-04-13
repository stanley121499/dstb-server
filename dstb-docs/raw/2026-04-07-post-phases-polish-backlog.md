# Post-phases polish backlog (dashboard + UX)

**Date:** 2026-04-07  
**Audience:** team + wiki ingest agent  
**When to use:** After **all planned phases** in [Phase Rollout Plan v3](./2026-04-07-phase-plan-v3.md) are complete (through Phase 6), or when explicitly scheduling a **polish sprint**. These items are **not** required to mark Phase 2 complete against the phase plan; they align the product with the **richer** [Dashboard Specification](./2026-04-07-dashboard-spec.md) and general UX hardening.

**Companion:** [Dashboard Phase 2 status and updates](./2026-04-07-dashboard-phase2-status-and-updates.md) describes what is already shipped.

---

## Dashboard UI / workflows

| Item | Spec reference (approx.) | Notes |
|------|---------------------------|--------|
| **Structured strategy parameter forms** | Dashboard spec — Config Editor, grouped fields (Session, Entry, ATR, Risk, Execution) | Today: JSON textarea + Zod for `orb-atr`. Polish: generate fields from shared schema or per-strategy forms. |
| **"Save &amp; Restart"** | Config Editor actions | Save then toggle `enabled` off/on (or explicit server action) to force bot server pick-up without manual toggle on grid. |
| **Version diff viewer** | Version history — "View expands param diff from previous" | Today: list + "Load into editor". Polish: side-by-side or inline diff between version N and N-1. |
| **Restore as one-click persisted rollback** | Spec "Restore loads that version" | Today: load into editor + user saves. Polish: optional "Restore this version" that writes a new `config_versions` row from snapshot. |
| **Trade log: multi-select bot filter** | Trade Log filters | Today: single bot or All. Polish: multiple `config_id` / bot selection. |
| **Trade row → detail** | Spec `/trades/:id` | **Phase 3** deliverable in plan; listed here only as reminder that polish pass may add deep links from table rows once detail exists. |
| **Export trades to CSV** | Spec optional | Not implemented; add if operators need extracts without Supabase Studio. |

---

## Auth, data, and observability polish

| Item | Notes |
|------|--------|
| **Version history attribution** | Spec mentions timestamp + **who** edited. Requires auth uid (or display name) stored on `config_versions` or joined from audit; UI column in sidebar. |
| **Consistent Unicode policy** | Prefer UTF-8 source files; avoid mojibake. If team standard is ASCII-only in UI strings for Windows editor safety, document in wiki and lint optionally. |
| **Login / controlled-input testing** | Document E2E pattern (slow type or Playwright `fill` with React-friendly events) to avoid false hydration failures. |

---

## Infrastructure / docs polish

| Item | Notes |
|------|--------|
| **Vercel runbook** | Single wiki page: env vars, Supabase redirect URLs, preview vs production branches, smoke test after deploy. |
| **RLS policy review for dashboard** | Confirm `authenticated` policies match all dashboard queries (including joins on `trades` → `configs`). |
| **Realtime coverage audit** | Grid uses `configs` + `bots`; confirm no other tables need publication for Phase 3+ pages. |

---

## Ordering suggestion (non-binding)

1. Phase 3 trade detail route and charts (plan-owned, not "polish").  
2. After Phase 6: run through this backlog; prioritize **Save &amp; Restart**, **structured forms for top strategies**, **version diff**, then **CSV** and **multi-select** as operator demand dictates.

---

## Wiki ingest hint

Create or extend `wiki/synthesis/` or `wiki/concepts/` with a short **"Polish backlog"** page that links to this raw file so it is not lost after Phase 2 ingest.

---

## See also

- [Dashboard Phase 2 status and updates](./2026-04-07-dashboard-phase2-status-and-updates.md)
- [Dashboard Specification](./2026-04-07-dashboard-spec.md)
- [Phase Rollout Plan v3](./2026-04-07-phase-plan-v3.md)
