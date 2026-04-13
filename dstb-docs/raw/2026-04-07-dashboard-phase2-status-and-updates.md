# Dashboard Phase 2 — implementation status and updates

**Date:** 2026-04-07  
**Audience:** human operators + next wiki ingest agent  
**Related:** [Phase Rollout Plan v3](./2026-04-07-phase-plan-v3.md) (Phase 2), [Dashboard Specification](./2026-04-07-dashboard-spec.md), [Deploy / runtime notes](./2026-04-07-deploy-runtime-supabase-notes.md)

---

## Purpose

This file captures **what exists in the repo today** for the Next.js dashboard (Phase 2), **recent fixes**, and **pointers for wiki maintenance**. It is a **raw source** for ingest; do not treat it as replacing the phase plan or dashboard spec.

Deferred UI polish that is **not** required to close Phase 2 against the phase plan lives in a separate raw file: [Post-phases polish backlog](./2026-04-07-post-phases-polish-backlog.md).

---

## Summary verdict

- **Against [Phase Rollout Plan v3](./2026-04-07-phase-plan-v3.md) Phase 2:** The dashboard **implements the listed deliverables in code** for local development: app scaffold, auth, bot grid with Realtime and enable toggle, config editor with `config_versions`, new config flow, paginated trade log with filters. **Production deploy to Vercel** is documented in `dashboard/README.md` but is an **operational** checkbox (not verifiable from code alone).
- **Against [Dashboard Specification](./2026-04-07-dashboard-spec.md):** Several **richer** behaviors are **not** implemented (structured strategy forms, Save & Restart, version diff viewer, multi-select bot filter, etc.). Those are tracked as **post-phases polish** in the backlog raw doc—not blockers for the phase plan’s Phase 2 wording.

---

## Application layout

| Route | Role |
|-------|------|
| `/login` | Email/password via Supabase Auth |
| `/` | Bot grid (home) |
| `/config/[id]` | Edit config + version history sidebar |
| `/config/new` | Create config (starts disabled per flow) |
| `/trades` | Paginated trade log with GET query filters |

**Explicitly deferred to Phase 3 (per plan/spec):** `/trades/[id]` trade detail and charts.

---

## Notable paths (codebase)

- **App:** `dashboard/app/page.tsx`, `dashboard/app/login/`, `dashboard/app/config/[id]/page.tsx`, `dashboard/app/config/new/page.tsx`, `dashboard/app/trades/page.tsx`
- **Components:** `dashboard/components/bot-grid.tsx`, `dashboard/components/config-editor-form.tsx`, shadcn UI under `dashboard/components/ui/`
- **Supabase:** `dashboard/lib/supabase/server.ts`, `dashboard/lib/supabase/client.ts`
- **Server actions:** `dashboard/app/actions/config.ts` (creates/updates `configs`, inserts `config_versions`)
- **Strategy params:** `dashboard/lib/server/strategyParamsShared.ts`, `dashboard/lib/server/paramsValidation.ts` (strict Zod for `orb-atr`; other strategies allow save with warning)
- **Defaults:** `dashboard/lib/defaultOrbParams.ts`
- **Env template:** `dashboard/.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Monorepo scripts:** root `package.json` — `npm run dashboard:dev`, `npm run dashboard:build`
- **Realtime (DB):** migration `supabase/migrations/20260407130000_realtime_bots.sql` — publication for `bots` (grid subscribes to `configs` and `bots` in `bot-grid.tsx`)

---

## Behavior notes (operators + testers)

1. **Bot grid:** Per-card enable switch writes `configs.enabled`. Realtime listens to **`configs`** and **`bots`** and triggers `router.refresh()` so equity/heartbeat/status stay fresh without full reload.
2. **Today P&amp;L:** Computed server-side on the home page from `trades` (UTC day aggregation keyed by bot id); passed into `BotGrid` as `todayPnlByBotId`.
3. **Config editor:** Strategy parameters are edited primarily as **JSON** in a textarea (with pretty-print). Risk fields (`maxDailyLossPct`, `maxPositionSizePct`) are separate inputs. Version sidebar lists `config_versions`; **"Load into editor"** copies a snapshot into the form (user must **Save** to persist a new version).
4. **Trades page:** Filters via query string (`bot`, `symbol`, `side`, `result`, `exitReason`, `from`, `to`, `page`). Page size 50. No row click navigation in Phase 2 (matches phase plan trade detail = Phase 3).

---

## Updates applied (2026-04-07)

### Mojibake / encoding fix (bot grid and related copy)

**Problem:** `dashboard/components/bot-grid.tsx` contained **corrupted UTF-8 sequences** displayed as `â€”`, `Â·`, etc., when the file was saved or interpreted with the wrong encoding.

**Change:** Replaced placeholder dashes with ASCII `"-"`, strategy line separators with **`strategy / symbol / interval`**, and empty-state copy to use a hyphen. For consistency and to reduce encoding risk in tooling, related punctuation in `dashboard/app/login/page.tsx`, `dashboard/app/login/LoginForm.tsx`, and `dashboard/app/trades/page.tsx` was normalized to ASCII (`-`, `...`).

**Wiki ingest hint:** If an entity page exists for the dashboard, note that **source files must remain UTF-8** and avoid pasting smart quotes/dashes from mis-encoded sources.

### Automated browser testing caveat

Filling login inputs with automation that sets the DOM value **without** React `onChange` can trigger a **hydration mismatch** on controlled components. Real typing (or character-by-character input) matches production behavior.

---

## Deployment checklist (Vercel)

Documented in `dashboard/README.md`:

- Vercel project root: `dashboard`
- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Add Vercel URL (and localhost) to Supabase **Authentication → URL configuration**
- Apply Supabase migrations (including Realtime publication for `bots`)

---

## Suggested wiki ingest actions (for the next agent)

Per [`CLAUDE.md`](../../CLAUDE.md) at repo root workflow:

1. **New source summary:** `wiki/sources/dashboard-phase2-status.md` linking to this raw file.
2. **Entity page (if missing):** `wiki/entities/dstb-dashboard.md` — routes, stack, env vars, key files, relation to Supabase RLS.
3. **Concept update:** [`wiki/concepts/supabase-v3-migration.md`](../wiki/concepts/supabase-v3-migration.md) or [`wiki/overview.md`](../wiki/overview.md) — state that **Phase 2 dashboard code exists** and where polish backlog lives.
4. **Synthesis touch:** [`wiki/synthesis/v3-planning-document-set.md`](../wiki/synthesis/v3-planning-document-set.md) — short "implementation status as of 2026-04-07" bullet pointing here.
5. **Index + log:** Add row to `dstb-docs/index.md` under Sources; append ingest entry to `dstb-docs/log.md`.

---

## Open questions (none blocking)

- Whether **Vercel** is deployed and which production URL is canonical.
- Whether `config_versions` (or audit) should later store **actor identity** (spec mentions "who made it"); schema may need a column if required.

---

## See also

- [Post-phases polish backlog](./2026-04-07-post-phases-polish-backlog.md)
- [Phase Rollout Plan v3](./2026-04-07-phase-plan-v3.md)
- [Dashboard Specification](./2026-04-07-dashboard-spec.md)
