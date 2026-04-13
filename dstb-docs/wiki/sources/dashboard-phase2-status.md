---
title: "Source summary — Dashboard Phase 2 status and updates"
type: source-summary
updated: 2026-04-07
sources: 2
tags: [dstb, dashboard, phase-2, nextjs]
---

# Source summary: Dashboard Phase 2 — status and updates

**Raw path:** [`raw/2026-04-07-dashboard-phase2-status-and-updates.md`](../../raw/2026-04-07-dashboard-phase2-status-and-updates.md)

## Summary

**Phase 2 (phase plan):** Next.js app in **`dashboard/`** implements scaffold, Supabase Auth, **bot grid** (Realtime on `configs` + `bots`, enable toggle), **config editor** with **`config_versions`** + load-into-editor, **new config**, **paginated trade log** with query filters.

**Wiki note:** The raw file still states **`/trades/[id]`** is deferred and that the trades page has no row navigation — **that section is stale** after Phase 3 shipped. Use [[phase3-implementation-summary|Phase 3 implementation summary]] and [[../entities/dstb-dashboard|dashboard entity]] for current routes (`/trades/[id]`, `/analytics`, compare view).

**Vs dashboard spec:** Richer items (structured strategy forms, Save & Restart, version diff, multi-select bot filter) are **not** done; tracked in [[post-phases-polish-backlog|post-phases polish backlog]].

## Operator notes (from raw)

- Today P&L on home: server-side UTC aggregation from `trades`.
- Params: JSON textarea + Zod for `orb-atr`; risk fields separate.
- **2026-04-07 fixes:** mojibake in bot grid / login / trades copy → ASCII `-` / `...` for tooling safety; caveat on **automated login** vs React controlled inputs (hydration).

## Code pointers

- Routes under `dashboard/app/`; `bot-grid.tsx`, `config-editor-form.tsx`; actions in `app/actions/config.ts`; `dashboard/lib/supabase/*`; Realtime migration `supabase/migrations/20260407130000_realtime_bots.sql` (**`bots`** publication).
- Scripts: `npm run dashboard:dev`, `npm run dashboard:build`; deploy doc `dashboard/README.md`.

## Cross-references

- [[../entities/dstb-dashboard|Entity: DSTB dashboard]]
- [[phase3-implementation-summary|Phase 3 implementation summary]]
- [[post-phases-polish-backlog|Post-phases polish backlog (source)]]
- [[v3-phase-rollout-plan|Phase plan v3]]
- [Dashboard specification (raw)](../../raw/2026-04-07-dashboard-spec.md)
