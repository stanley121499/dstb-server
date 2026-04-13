# Phase 4 (v3) — Behavior → Supabase — implementation record

**Date:** 2026-04-07  
**Status:** Implemented in repository (code + migration). Apply migration to Supabase before use.  
**Related planning:** [`2026-04-07-phase-plan-v3.md`](./2026-04-07-phase-plan-v3.md) (Phase 4), [`2026-04-07-schema-design-v3.md`](./2026-04-07-schema-design-v3.md), [`2026-04-07-behavior-system-design.md`](./2026-04-07-behavior-system-design.md), [`2026-04-07-dashboard-spec.md`](./2026-04-07-dashboard-spec.md) (`/behavior`).

This document is the **human/LLM source of truth** for what was built, how to run it, and what to watch next.

---

## 1. Goals delivered (Phase 4 scope)

- **Schema:** `behavior_analyzers`, `behavior_rulesets`, `behavior_raw_cycles`, `behavior_results`, `behavior_environments` (environments table created; no dashboard workflow yet — Phase 6).
- **Bot server:** Persist each **finalized** behavior daily cycle to Supabase and compute **ruleset results** (not only Google Sheets).
- **Sandbox:** Run user/DB-stored analyzer **JavaScript** in **`isolated-vm`** with documented helper surface (plus a **native** path for the existing TypeScript `BehaviorAnalyzer`).
- **Historical load:** CLI command that replays the **same candle pipeline as behavior backtest** into Supabase (no Google Sheets import required for backfill).
- **Dashboard:** `/behavior` results table + `/behavior/[rawCycleId]` chart context (15m + reference levels).

---

## 2. Database

**Migration file:** `supabase/migrations/20260407140000_behavior_phase4.sql`

- Creates all Phase 4 behavior tables, indexes, `updated_at` triggers (reuses existing `set_updated_at()` from Phase 1).
- **RLS:** `authenticated` read/write policies (aligned with Phase 1 style). Service role bypasses RLS for bot/CLI.
- **Realtime:** `ALTER PUBLICATION supabase_realtime ADD TABLE behavior_results;`
- **Seed (fixed UUIDs):**
  - Analyzer `s2_full_cycle`, `execution_mode = native_s2` (runs TypeScript `BehaviorAnalyzer`; `code` column is placeholder).
  - Ruleset **Default S2**, `is_active = true`, single analyzer entry.

**`behavior_analyzers.execution_mode`:** `sandbox` | `native_s2`

- **`native_s2`:** Host runs `BehaviorAnalyzer` and flattens `BehaviorRow` fields into `behavior_results.columns` (camelCase keys matching the row).
- **`sandbox`:** `code` must define `function analyze(input) { ... }` returning `{ label: string, details: object }`; executed in isolate.

---

## 3. Code map (repository)

| Area | Path(s) |
|------|---------|
| Supabase sync orchestration | `src/behavior/supabase/behaviorSupabaseSync.ts` |
| Native S2 column flattening | `src/behavior/sandbox/nativeS2Analyzer.ts` |
| Sandbox runner | `src/behavior/sandbox/SandboxedAnalyzerRunner.ts` |
| Helper implementations (host) | `src/behavior/sandbox/behaviorSandboxHelpers.ts` |
| Shared backtest candle loading | `src/behavior/scripts/behaviorBacktestData.ts` |
| Backtest script (Sheets) refactored | `src/behavior/scripts/runBehaviorBacktest.ts` |
| Live bot Supabase hook | `src/behavior/bot/BehaviorBot.ts` (`supabaseSync`), `src/cli/commands/behaviorLive.ts` |
| Backfill CLI | `src/cli/commands/behaviorBackfillSupabase.ts`, `src/cli/index.ts` (`behavior:backfill-supabase`) |
| Dependency | Root `package.json`: `isolated-vm` |
| Vitest | `src/behavior/sandbox/__tests__/SandboxedAnalyzerRunner.unit.test.ts`, `vitest.config.ts` include pattern |
| Dashboard | `dashboard/app/behavior/page.tsx`, `dashboard/app/behavior/[rawCycleId]/page.tsx`, `dashboard/components/behavior-cycle-chart.tsx`, `dashboard/lib/behaviorChart.ts`, `dashboard/components/shell/NavBar.tsx` |

---

## 4. How to run

### 4.1 Environment

- **Bot / backfill (service role):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (see root `.env.example`).
- **Backtest range (backfill):** `BEHAVIOR_BACKTEST_START`, `BEHAVIOR_BACKTEST_END`, `BEHAVIOR_PAIR` (defaults match legacy behavior backtest).
- **Dashboard:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (existing).

### 4.2 Commands

```bash
# Historical upsert (from repo root; set date env vars as needed)
npm run behavior:backfill-supabase

# Live bot (optional Supabase sync if service role env present)
npm run behavior:live -- --config <path>
```

**PowerShell example (2024-01-01 through yesterday):**

```powershell
$env:BEHAVIOR_BACKTEST_START = "2024-01-01"
$env:BEHAVIOR_BACKTEST_END = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
npm run behavior:backfill-supabase
```

### 4.3 Node + `isolated-vm`

Upstream **`isolated-vm`** notes: **Node 20+ may require** `NODE_OPTIONS=--no-node-snapshot`. If sandbox analyzers fail or tests hang, set that before running bot/backfill/tests.

---

## 5. Data flow (concise)

1. **`behavior_raw_cycles`:** One row per `(symbol, cycle_date)` — `candles` JSONB (`15m`, `4h` arrays in `{ t, o, h, l, c, v }` shape), `reference_levels` (`pdh`, `pdl`, `sessionOpen`).
2. **Active ruleset:** `behavior_rulesets.is_active = true` (first by `created_at` if multiple — **see watchlist**).
3. **`behavior_results`:** Upsert per `(raw_cycle_id, ruleset_id)`; `columns` = merged outputs; `details` = per-analyzer metadata/errors.

**Live:** On each finalized lifecycle, `BehaviorBot` calls `BehaviorSupabaseSync.syncCycleFromDailyInput` **after** Sheets attempt (Sheets failure does not block Supabase if that path already completed — Supabase is in its own try).

**Backfill:** Re-fetches market candles and upserts every day in range (idempotent upserts).

---

## 6. Google Sheets

- **Not removed.** `behavior:backtest` and `behavior:live` still use Sheets reporters when configured.
- **Supabase backfill does not read Sheets**; it recomputes from **exchange/Binance candle source** (same as `runBehaviorBacktest`).

---

## 7. Watchlist (ops + product)

1. **Long backfills:** Full 2024→present is many cycles; network, rate limits, and Supabase write volume matter. Progress logs every 50 cycles in CLI.
2. **Multiple `is_active` rulesets:** Code picks **one** active ruleset (`order created_at limit 1`). Avoid more than one active row or define a policy.
3. **Dashboard `/behavior` scale:** List page loads **all** `behavior_results` for the selected ruleset then filters/paginates in memory — fine for moderate history; **revisit** for very large tables (server-side filter/pagination or RPC).
4. **`isolated-vm`:** Native module; **Windows** needs build tools if prebuild misses; **deploy image** (e.g. Render) must support native addons. **`NODE_OPTIONS=--no-node-snapshot`** on newer Node.
5. **Sandbox vs native:** Default seed uses **native_s2** only — sandbox path is ready for **Phase 5**–style DB-stored JS analyzers; security posture is “trusted team + accident protection,” not adversarial hardening (per behavior system design).
6. **Typecheck:** Root `tsc` may still fail on **pre-existing** unrelated files; validate behavior changes with **dashboard build** + **targeted Vitest** for sandbox tests.
7. **`behavior_environments`:** Table exists; **no UI** yet (Phase 6 pipeline).

---

## 8. Planned / follow-on (not done here)

- **Phase 5:** Analyzer editor, ruleset builder UI, test-run, comparison — per phase plan and dashboard spec (`/behavior/analyzers`, `/behavior/rulesets`, …).
- **Realtime UX on dashboard:** Subscribing to `behavior_results` for live backfill progress (spec mentions it; list page does not yet subscribe).
- **Optional cron:** If `behavior:live` is **not** 24/7, scheduled **incremental** backfill (last N days) — discussed in planning, not implemented as a job.
- **Reconcile docs:** Update `raw/docs/` or legacy stubs where they still imply “behavior output = Sheets only.”

---

## 9. Acceptance checklist (for “Phase 4 done” in prod)

- [ ] Migration `20260407140000_behavior_phase4.sql` applied to production Supabase.
- [ ] Seed ruleset/analyzer present (or equivalent custom ruleset + `is_active`).
- [ ] Successful smoke: one `behavior:backfill-supabase` day range + rows visible in Studio and `/behavior`.
- [ ] If using sandbox analyzers in prod: Node flags and hosting image validated for `isolated-vm`.

---

## See also

- [Phase plan v3](./2026-04-07-phase-plan-v3.md) — Phase 4 deliverables wording  
- [Schema design v3](./2026-04-07-schema-design-v3.md) — table definitions  
- [Behavior system design](./2026-04-07-behavior-system-design.md) — analyzer contract + helpers  
- [Dashboard spec](./2026-04-07-dashboard-spec.md) — `/behavior` layout (Phase 4 section)
