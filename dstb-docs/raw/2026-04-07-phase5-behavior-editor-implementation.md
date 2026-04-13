# Phase 5 (v3) — Behavior ruleset editor + self-service analysis (implemented)

**Date:** 2026-04-07  
**Status:** Shipped in repository (companion to Phase 4 raw note)  
**Related:** [Phase plan v3](./2026-04-07-phase-plan-v3.md) (Phase 5), [Dashboard spec](./2026-04-07-dashboard-spec.md) (§9–11), [Phase 4 behavior implementation](./2026-04-07-phase4-behavior-supabase-implementation.md)

This document is the **source of truth** for what Phase 5 adds on top of Phase 4: analyzer and ruleset management in the dashboard, authenticated bot HTTP endpoints for `isolated-vm` execution, ruleset comparison including fuzzy realized P&L, and operational items to watch.

---

## 1. Goals delivered (Phase 5 plan alignment)

1. **LLM-oriented workflow** — Prompt template at `dashboard/public/behavior-analyzer-prompt.md`, surfaced read-only on analyzer create/edit pages.
2. **Analyzer editor** — List, create, detail with Monaco, `param_defaults` / `param_schema` JSON, **Test Run** (via dashboard API proxy → bot), **Save** (bumps `version`), **Clone** (new slug).
3. **Ruleset builder** — List, create, edit with analyzer toggles, order (up/down), per-analyzer params JSON, notes, **Run analysis** (batch recompute on bot), **Set as active** (unset others first).
4. **Ruleset comparison** — Two rulesets, date/symbol filters, side-by-side label columns, disagreement highlighting, summary agreement rate, **Realized P&L (matched by date)** via trades aggregate (fuzzy join).
5. **Single active ruleset (DB)** — Partial unique index so at most one `behavior_rulesets.is_active = true` (when migration applied).

---

## 2. Code map (repository)

### Bot server (Node, same process as `/health`)

| Piece | Path / notes |
|-------|----------------|
| HTTP router | `src/server/behaviorHttpHandlers.ts` — `POST /behavior/test-run`, `POST /behavior/reanalyze-ruleset`; `Authorization: Bearer` or `X-Behavior-Api-Key` |
| Wire-up | `src/server/index.ts` — extends listener previously health-only; reads `BEHAVIOR_API_SECRET` |
| Sync / runner | `src/behavior/supabase/behaviorSupabaseSync.ts` — `fetchRulesetById`, `testRunAnalyzer`, `reanalyzeRulesetForAllCycles`; exports `buildSandboxInputSnapshot`, `RulesetAnalyzersSchema` |
| Raw row → input | `src/behavior/supabase/rawCycleToDailyInput.ts` — rebuild `DailyCycleInput` from `behavior_raw_cycles` |

### Supabase migrations (apply after Phase 4)

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/20260407150000_behavior_ruleset_single_active.sql` | `CREATE UNIQUE INDEX ... ON behavior_rulesets (is_active) WHERE (is_active = true)` |
| `supabase/migrations/20260407150100_trades_pnl_by_exit_date_fn.sql` | RPC `trades_realized_pnl_by_symbol_exit_utc_date(p_from, p_to)` for compare view; `GRANT EXECUTE` to `authenticated` |

### Dashboard (Next.js)

| Piece | Path / notes |
|-------|----------------|
| Bot proxy env | `dashboard/.env.example` — `BEHAVIOR_API_BASE_URL`, `BEHAVIOR_API_SECRET` (server-only, never `NEXT_PUBLIC_*`) |
| API routes | `dashboard/app/api/behavior/test-run/route.ts`, `reanalyze-ruleset/route.ts` — require Supabase session; forward to bot with Bearer secret |
| Helper | `dashboard/lib/behaviorBotApi.ts` |
| Analyzer UI | `dashboard/app/behavior/analyzers/*`, `dashboard/components/behavior-analyzer-detail-client.tsx`, `behavior-analyzer-new-client.tsx` |
| Ruleset UI | `dashboard/app/behavior/rulesets/*`, `dashboard/components/behavior-ruleset-editor-client.tsx` |
| Compare | `dashboard/app/behavior/rulesets/compare/page.tsx` |
| Nav / links | `dashboard/components/shell/NavBar.tsx` (B. Analyzers, B. Rulesets); cross-links on `dashboard/app/behavior/page.tsx` |
| UI primitive | `dashboard/components/ui/textarea.tsx` |
| Deps | `@monaco-editor/react`, `monaco-editor` (dashboard workspace) |

### Root env hint

- `.env.example` — documents `BEHAVIOR_API_SECRET` for the **bot** process (must match dashboard server secret on Vercel).

### Tests

| Test | Path |
|------|------|
| Behavior API auth | `src/server/__tests__/behaviorHttpHandlers.unit.test.ts` (Vitest include: `src/server/__tests__/**/*.test.ts`) |
| Raw cycle parsing | `src/behavior/supabase/__tests__/rawCycleToDailyInput.unit.test.ts` |

---

## 3. Environment and deployment checklist

1. **Bot (e.g. Render)**  
   - Set `BEHAVIOR_API_SECRET` to a long random string.  
   - Same `PORT` serves `GET /health` and `POST /behavior/*`.  
   - If using sandbox analyzers, keep `NODE_OPTIONS=--no-node-snapshot` when required for `isolated-vm` (see Phase 4 note).

2. **Dashboard (e.g. Vercel)**  
   - `BEHAVIOR_API_BASE_URL` — origin of bot **without** trailing slash (e.g. `https://your-service.onrender.com`).  
   - `BEHAVIOR_API_SECRET` — **identical** to bot; available only to server (Route Handlers), never exposed to the browser bundle.

3. **Supabase**  
   - Apply migrations `20260407150000` and `20260407150100` after Phase 4 migration.  
   - If **multiple** rows already have `is_active = true`, the unique partial index migration **fails** until data is cleaned (leave exactly one active, or all false then set one in dashboard).

---

## 4. API contracts (summary)

### Bot: `POST /behavior/test-run`

JSON body (snake_case, aligned with handler):

- `raw_cycle_id` (uuid, required)  
- `analyzer_id` (uuid, optional if `draft_sandbox_code` provided)  
- `code_override` (optional) — unsaved sandbox edits against a saved analyzer  
- `draft_sandbox_code` (optional) — run sandbox without a saved row; sandbox only; no `mark_tested`  
- `execution_mode_override` (optional)  
- `params_override` (optional object)  
- `mark_tested` (optional boolean) — updates `behavior_analyzers.tested` when `analyzer_id` present  

Response: `{ ok: true, result: { mode, label|columns, details } }` (handler wraps sync output).

### Bot: `POST /behavior/reanalyze-ruleset`

- `ruleset_id` (uuid, required)  
- `symbol`, `from`, `to` (optional filters; dates `YYYY-MM-DD`)  
- `batch_size` (optional)

Response: `{ ok: true, processed, total_cycles }`.

If `BEHAVIOR_API_SECRET` is empty on the bot, behavior routes return **503** with a JSON error (health still works).

---

## 5. Ruleset comparison — fuzzy P&L (product semantics)

- **Column title:** "Realized P&L (matched by date)".  
- **Join:** `trades.symbol` = cycle symbol and UTC calendar date of `trades.exit_time` = `behavior_raw_cycles.cycle_date` (implemented via RPC over the selected date range).  
- **Empty cell** — no matching exits that day; **expected** if bots were idle, not a bug.  
- **Not** a FK to `behavior_raw_cycles`; a future improvement is `behavior_cycle_id` (or similar) on `trades` when the environment pipeline matures (Phase 6 direction).

If the RPC is missing (migration not applied), the compare page surfaces the error and points at migration `20260407150100`.

---

## 6. Watchlist (keep an eye on)

| Topic | Notes |
|-------|--------|
| **Long reanalysis** | Full history can take minutes; UI returns when the HTTP request completes. Optional future: job id, polling, or lean on Realtime `behavior_results` inserts for progress. |
| **Compare scale** | Large date ranges × wide column keys → heavy HTML table; may need virtualization or export later. |
| **Agreement metric** | Summary treats "agree" as identical string values for the **union** of column keys across rows; cycles with missing results appear as empty strings — can look "agreed" if both sides lack data for the same keys. Interpret cautiously. |
| **Symbol consistency** | Fuzzy P&L assumes `trades.symbol` aligns with `behavior_raw_cycles.symbol` formatting; mixed conventions (e.g. `BTCUSDT` vs `BTC-USD`) will reduce matches without code changes. |
| **Security** | Shared secret gates bot endpoints; rotate if leaked. Dashboard never sends the secret to the client. |
| **Typecheck noise** | Root `npm run typecheck` may still report pre-existing errors outside Phase 5 paths; dashboard `next build` is the practical gate for UI. |

---

## 7. Planned follow-on (not Phase 5)

- **Phase 6** per phase plan: environment pipeline UI, backtest button on environments, optional in-dashboard LLM code generation, operational alerts, log viewer, etc.  
- **Stricter trade–behavior linkage:** `behavior_cycle_id` on `trades` when promotions from environments to live are first-class.  
- **Param UI:** Auto-forms from JSON Schema (`param_schema`) instead of raw JSON text areas.  
- **Drag-and-drop** ruleset ordering (optional; up/down shipped for v1).

---

## 8. Related documents

- [Phase Rollout Plan v3](./2026-04-07-phase-plan-v3.md)  
- [Dashboard spec](./2026-04-07-dashboard-spec.md)  
- [Phase 4 behavior Supabase implementation](./2026-04-07-phase4-behavior-supabase-implementation.md)  
- [Behavior system design](./2026-04-07-behavior-system-design.md)  
- [Deploy / runtime notes](./2026-04-07-deploy-runtime-supabase-notes.md)  

---

*This file is raw source material for the LLM Wiki; agent-maintained summaries may live under `dstb-docs/wiki/sources/`.*
