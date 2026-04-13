# E2E testing — v3 backlog (not in original phase plan)

**Date:** 2026-04-07  
**Context:** v3 planning documents focused on schema, phases, and dashboard features. **End-to-end (E2E) automated tests** were not spelled out. This note captures a practical backlog so CI can eventually assert “dashboard + bot + Supabase” behavior together.

## Why E2E matters here

- **RLS + auth:** Dashboard uses Supabase Auth; mistakes show up only with a real session.
- **Realtime:** Bot grid depends on `bots` / `configs` subscriptions; regressions are integration-level.
- **Cross-runtime:** Bot server (Node, Render) and dashboard (Next.js, Vercel) share one Supabase project — contract tests on mocks miss wiring bugs.

## Suggested layers (build in order)

### 1. Supabase local + seed

- `supabase start` (or hosted **branch** / disposable project for CI).
- Migrations applied; seed script: test users, 1–2 `configs`, optional `bots` row.
- Document env vars for **test** anon key + service role (CI secrets).

### 2. Bot server smoke (API / DB)

- Start server against test Supabase with `SKIP_BITUNIX` / paper adapter or mocked exchange if available.
- Assert: `GET /health` JSON shape; optional: insert then read `bots.last_heartbeat` after N seconds (heartbeat fix).

### 3. Dashboard Playwright (or Cypress)

**Auth:** login once per run; store session (storage state).

**Critical paths:**

| Flow | Assert |
|------|--------|
| Login | Redirect to `/`, no error toast |
| Bot grid | Seeded config visible; status / heartbeat label present |
| Toggle enabled | Write to `configs` (or UI feedback + network 200) |
| Trades | Table loads; link to `/trades/:id` resolves |
| Trade detail | Chart container or empty-state when no `trade_candles` |
| Analytics | `/analytics` loads stats; compare view `?view=compare` |

**Realtime:** Optional flaky test — subscribe then service-role update `bots.equity`, expect UI update within timeout (mark `test.slow()`).

### 4. Optional full E2E (“golden path”)

- Start bot + dashboard + Supabase in CI (Docker Compose or GitHub Actions services).
- One closed **paper** trade → row in `trades` + `trade_candles` → open trade detail and assert chart data (non-empty JSON or canvas).

**Cost / flakiness:** High; defer until layers 1–3 stable.

## Tooling choices (pick one stack)

- **Playwright** + Next.js: good for App Router, parallel browsers.
- **Cypress:** familiar if team already uses it.
- **Supabase testing:** Official patterns for RLS tests often use **service role** for setup and **anon + auth** for assertions.

## CI strategy

- **PR:** Layer 1 + 2 + subset of Playwright (login + grid) on every PR.
- **Nightly:** Full Playwright + optional compose E2E.
- **Secrets:** Never commit keys; use GitHub Actions `secrets` / Vercel env for preview Supabase.

## Gaps to plan explicitly in future phase docs

- **Test Supabase project** (or branch-per-PR) ownership and cost.
- **Exchange mocking** contract for bot E2E without live Bitunix.
- **Deterministic time** for analytics charts (freeze clock or seed fixed `exit_time`).

## Related

- [`2026-04-07-phase-plan-v3.md`](2026-04-07-phase-plan-v3.md) — add a “Quality / E2E” subsection in the next revision if desired.
- [`2026-04-07-post-phases-polish-backlog.md`](2026-04-07-post-phases-polish-backlog.md) — UX polish; E2E is orthogonal but can share CI time budget.
