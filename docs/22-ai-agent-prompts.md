# AI agent prompts + parallelization plan

## Goal

You will use multiple AI agents to build the monorepo (server + frontend). This doc provides:

- Copy/paste prompts
- File ownership rules to avoid merge conflicts
- What can be done in parallel vs what must be sequential

## Quick navigation (Table of Contents)

- [AI agent prompts + parallelization plan](#ai-agent-prompts--parallelization-plan)
  - [Goal](#goal)
  - [Quick navigation (Table of Contents)](#quick-navigation-table-of-contents)
  - [Golden rules (must follow)](#golden-rules-must-follow)
  - [Run order + parallelization](#run-order--parallelization)
    - [Phase 1 (Backtesting)](#phase-1-backtesting)
    - [Phase 2 (Live trading)](#phase-2-live-trading)
  - [Agents (file ownership)](#agents-file-ownership)
  - [What cannot run in parallel (or needs coordination)](#what-cannot-run-in-parallel-or-needs-coordination)
  - [Phase 1 prompts](#phase-1-prompts)
  - [Prompt: Agent 0 (Monorepo bootstrap + tooling)](#prompt-agent-0-monorepo-bootstrap--tooling)
  - [Prompt: Agent A (Backend / API)](#prompt-agent-a-backend--api)
  - [Prompt: Agent B (Frontend / React)](#prompt-agent-b-frontend--react)
  - [Prompt: Agent C (Shared package: types/schemas)](#prompt-agent-c-shared-package-typesschemas)
  - [Prompt: Agent D (Supabase migrations)](#prompt-agent-d-supabase-migrations)
  - [Prompt: Agent H (Integration + smoke test)](#prompt-agent-h-integration--smoke-test)
  - [Coordination checklist (before merging agent work)](#coordination-checklist-before-merging-agent-work)
  - [Package manager note (authoritative for this repo)](#package-manager-note-authoritative-for-this-repo)
  - [Phase 2 exchange decision (authoritative)](#phase-2-exchange-decision-authoritative)
  - [Definition of Done (Phase 1) — acceptance checklist](#definition-of-done-phase-1--acceptance-checklist)
    - [Prerequisites (local)](#prerequisites-local)
    - [Required workspace scripts (must exist)](#required-workspace-scripts-must-exist)
    - [1) Install dependencies](#1-install-dependencies)
    - [2) Start API (backend)](#2-start-api-backend)
    - [3) Start Web (frontend)](#3-start-web-frontend)
    - [4) Auth works (Supabase email/password)](#4-auth-works-supabase-emailpassword)
    - [5) Create + save a Parameter Set](#5-create--save-a-parameter-set)
    - [6) Run a Backtest and view results](#6-run-a-backtest-and-view-results)
    - [7) Compare runs (minimum)](#7-compare-runs-minimum)
    - [8) Deployment readiness (smoke)](#8-deployment-readiness-smoke)
  - [Phase 2 (Live trading)](#phase-2-live-trading-1)
    - [Parallelization rules (Phase 2)](#parallelization-rules-phase-2)
    - [What should be done sequentially (Phase 2)](#what-should-be-done-sequentially-phase-2)
  - [Prompt: Agent E (Phase 2 - Exchange adapters: Paper + Luno)](#prompt-agent-e-phase-2---exchange-adapters-paper--luno)
  - [Prompt: Agent F (Phase 2 - Bot lifecycle + API endpoints)](#prompt-agent-f-phase-2---bot-lifecycle--api-endpoints)
  - [Prompt: Agent G (Phase 2 - Frontend Live Bots screens)](#prompt-agent-g-phase-2---frontend-live-bots-screens)

## Golden rules (must follow)

- Each agent must follow all docs in `docs/` as the source of truth.
- Each agent must implement **strict TypeScript**:
  - No `any`
  - No non-null assertions (`!`)
  - No unsafe `as unknown as T` casts
- Use **double quotes** for strings.
- Validate all external inputs (API, env vars, DB rows).
- No agent should edit files “owned” by another agent without explicit coordination.

## Run order + parallelization

### Phase 1 (Backtesting)

- Run **Agent 0 first** (workspace + repo scaffolding).
- Then run **Agent A + Agent B + Agent C + Agent D** in parallel (safe if you enforce folder ownership).
- Run **Agent H last** (integration + smoke test / acceptance).

### Phase 2 (Live trading)

- Only start Phase 2 after Phase 1 passes the [Definition of Done](#definition-of-done-phase-1--acceptance-checklist).
- Phase 2 backend work must be split to avoid collisions in `apps/api/**`:
  - Agent E = adapters/exchanges only
  - Agent F = bots/routes only
  - Agent G = frontend only

## Agents (file ownership)

- **Agent 0 (monorepo bootstrap)**: owns root workspace files (e.g., `package.json`, workspace config, root tooling configs)
- **Agent A (backend scaffold + API)**: owns `apps/api/**`
- **Agent B (frontend scaffold + UI)**: owns `apps/web/**`
- **Agent C (shared types/schemas)**: owns `packages/shared/**`
- **Agent D (Supabase migrations)**: owns `supabase/migrations/**`
- **Agent H (integration + smoke test)**: may edit across folders only for final wiring and runtime verification (last step)

Agents may read each other’s folders but should not edit them.

## What cannot run in parallel (or needs coordination)

- Anything that changes the **authoritative contracts**:
  - `docs/12-strategy-orb-atr.md` parameter schema
  - `docs/15-api-contracts.md`
  - `docs/17-supabase-schema-and-migrations.md`

If those change, all agents must re-sync.

Also, these are sequencing-sensitive:

- Migrations (DB) should land before API endpoints relying on those tables.
- Shared types should stabilize before both UI and API import them heavily.

---

## Phase 1 prompts

## Prompt: Agent 0 (Monorepo bootstrap + tooling)

Copy/paste:

```text
You are bootstrapping the monorepo. Read and follow these docs as source of truth:
- docs/20-monorepo-and-local-dev.md
- docs/18-dev-standards.md

Scope:
- You may edit only repo-root and workspace-level files and folder scaffolding, such as:
  - package.json (root)
  - package-lock.json (root)
  - .gitignore
  - tsconfig base(s)
  - workspace config (npm workspaces)
  - root scripts to run apps
  - optional: eslint/prettier configs
  - create empty folders: apps/api, apps/web, packages/shared, supabase/migrations (do not implement app logic)

Implement:
- npm workspaces monorepo wiring.
- Root scripts that make local dev easy, such as:
  - install
  - dev api
  - dev web
  - build all
- Ensure the monorepo structure matches docs/20-monorepo-and-local-dev.md exactly.

Constraints:
- Do not implement business logic in this step.
- Keep it Windows-friendly.
```

## Prompt: Agent A (Backend / API)

Copy/paste:

```text
You are building the backend in a monorepo. Read and follow these docs as source of truth:
- docs/10-requirements.md
- docs/11-architecture.md
- docs/12-strategy-orb-atr.md
- docs/14-backtest-engine.md
- docs/15-api-contracts.md
- docs/17-supabase-schema-and-migrations.md
- docs/18-dev-standards.md
- docs/20-monorepo-and-local-dev.md

Scope:
- Only edit files under apps/api/** (do not touch other folders).

Implement:
- Node.js + TypeScript API server.
- Endpoints from docs/15-api-contracts.md for Phase 1.
- Supabase integration (server-only uses SUPABASE_SERVICE_ROLE_KEY).
- Request validation and standard error format.
- CORS configuration for local dev + Vercel domain support.

Must include (often missed):

- `GET /v1/backtests` list endpoint (paged offset/limit), used by the Compare Runs UI.

Constraints:
- Strict TypeScript; no any; no non-null assertion; no unsafe casts.
- Double quotes for strings; no '+' concatenation.
- Include JSDoc for exported functions and inline comments for complex logic.
```

## Prompt: Agent B (Frontend / React)

Copy/paste:

```text
You are building the frontend in a monorepo. Read and follow these docs as source of truth:
- docs/12-strategy-orb-atr.md
- docs/15-api-contracts.md
- docs/16-ui-spec.md
- docs/18-dev-standards.md
- docs/20-monorepo-and-local-dev.md
- docs/21-deployment-vercel-render.md

Scope:
- Only edit files under apps/web/** (do not touch other folders).

Implement:
- React + TypeScript UI.
- Supabase Auth with email/password (signup/login/logout).
- Screens from docs/16-ui-spec.md:
  - Parameter Sets list + editor
  - Run Backtest
  - Backtest Results
  - Compare Runs
- API client to call backend endpoints and render results.

UI rules:
- Use single-select for mutually exclusive items (entry mode, stop mode, etc.).
- Use toggles for independent features (TP, trailing, time exit, ATR filter).

Constraints:
- Strict TypeScript; no any; no non-null assertion; no unsafe casts.
- Double quotes for strings; no '+' concatenation.
- Validate and guard against invalid user inputs.
```

## Prompt: Agent C (Shared package: types/schemas)

Copy/paste:

```text
You are building the shared package in a monorepo. Read and follow these docs as source of truth:
- docs/12-strategy-orb-atr.md (parameter schema)
- docs/15-api-contracts.md (API shapes)
- docs/18-dev-standards.md
- docs/20-monorepo-and-local-dev.md

Scope:
- Only edit files under packages/shared/**.

Implement:
- Shared TypeScript types for:
  - Backtest params schema
  - API request/response DTOs
  - Error response schema
- Shared runtime validation (recommended: Zod schemas).
- Export helpers for parsing/validating env vars and params payloads (if useful).

Constraints:
- Strict TypeScript; no any; no non-null assertion; no unsafe casts.
- Double quotes for strings; no '+' concatenation.
```

## Prompt: Agent D (Supabase migrations)

Copy/paste:

```text
You are responsible for Supabase migrations. Read and follow these docs as source of truth:
- docs/17-supabase-schema-and-migrations.md
- docs/10-requirements.md

Scope:
- Only edit files under supabase/migrations/**.

Implement:
- SQL migrations to create Phase 1 tables:
  - parameter_sets
  - backtest_runs
  - backtest_trades
  - run_events
  - optional: backtest_equity_points
- Create indexes and FKs as described.

Notes:
- Follow the single-client rules in `docs/17-supabase-schema-and-migrations.md` (no `user_id`, no RLS in Phase 1).
```

## Prompt: Agent H (Integration + smoke test)

Copy/paste:

```text
You are the integration agent. Your job is to ensure the system is fully runnable end-to-end on local dev.

Read and follow these docs as source of truth:
- docs/10-requirements.md
- docs/15-api-contracts.md
- docs/16-ui-spec.md
- docs/17-supabase-schema-and-migrations.md
- docs/20-monorepo-and-local-dev.md

Scope:
- You may edit files across apps/packages ONLY for integration wiring:
  - workspace scripts
  - shared type imports
  - environment variable naming consistency
  - .env.example files
  - CORS config alignment
  - small API/UI glue fixes

Deliverable:
- Local dev works:
  - API runs and responds to Phase 1 endpoints.
  - Web app can log in (Supabase email/password) and run a backtest.
  - Results render (metrics + trades).
  - Migrations exist and match the server persistence.

Constraints:
- Do not redesign features; only wire and fix integration issues.
```

## Coordination checklist (before merging agent work)

- Confirm shared package exports are stable and used by both apps.
- Confirm API endpoints match docs and UI expectations.
- Confirm migrations match the schema plan and API persistence needs.
- Confirm env var names match `20-monorepo-and-local-dev.md`.

## Package manager note (authoritative for this repo)

- Use **npm workspaces**.
- Do not introduce `pnpm-lock.yaml` or `yarn.lock`.
- Agents should use workspace commands like:
  - `npm run -w apps/api build`
  - `npm run -w apps/web dev`

## Phase 2 exchange decision (authoritative)

- The default Phase 2 exchange is **Luno** (see `docs/23-live-trading-exchange-selection.md`).

## Definition of Done (Phase 1) — acceptance checklist

This is the single Phase 1 acceptance test to confirm the system is **fully runnable end-to-end**.

### Prerequisites (local)

- Windows 11 + PowerShell
- Node.js installed
- Supabase project created (hosted is fine) with **email/password auth enabled**
- Env files created:
  - `apps/api/.env`
  - `apps/web/.env`
- Phase 1 migrations applied to the Supabase database (from `supabase/migrations/`)

### Required workspace scripts (must exist)

Agent 0 / Agent H must ensure these commands work:

- `npm ci`
- `npm run -w apps/api dev`
- `npm run -w apps/web dev`

Optional but recommended:

- `npm run -w apps/api build`
- `npm run -w apps/web build`

### 1) Install dependencies

Command:

- `npm ci`

Expected:

- Installs successfully and creates/uses only `package-lock.json` (no pnpm/yarn lockfiles).

### 2) Start API (backend)

Command:

- `npm run -w apps/api dev`

Expected:

- Server starts without crashing.
- Logs show it is listening on the configured port (e.g., 3001).

Manual API checks (via browser or REST client):

- `GET /v1/parameter-sets` returns `200` with JSON.
- Creating a parameter set via `POST /v1/parameter-sets` returns `201/200` and persists to Supabase.

### 3) Start Web (frontend)

Command:

- `npm run -w apps/web dev`

Expected:

- Web app starts and prints the local dev URL (e.g., `http://localhost:5173`).

### 4) Auth works (Supabase email/password)

In the web app:

- Sign up with an email + password OR sign in with an existing account.

Expected:

- Session persists after refresh (normal Supabase behavior).
- Logged-in user can access the Backtests UI screens.

### 5) Create + save a Parameter Set

In the web app:

- Create a Parameter Set with any valid configuration (defaults are acceptable).

Expected:

- Parameter set appears in the list after save.
- Refreshing the page still shows it (persisted in Supabase).

### 6) Run a Backtest and view results

In the web app:

- Choose a date range and run a backtest.

Expected:

- Backend creates a `BacktestRun` record in Supabase with `status` progressing to `completed` (or returns completed synchronously).
- Results screen renders:
  - Summary metrics (at least those listed in `docs/10-requirements.md`)
  - Trades table (may be empty depending on params/date range; empty must be handled gracefully)
  - Equity curve (or a message indicating no trades/equity points)

### 7) Compare runs (minimum)

In the web app:

- Run two backtests (can be different params) and use Compare.

Expected:

- Compare screen shows a metrics comparison table without errors.

### 8) Deployment readiness (smoke)

Expected:

- `apps/web` only uses public env vars (`VITE_*`) and does not contain any service-role secrets.
- `apps/api` uses `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- CORS is restricted to local dev + expected production domains (no `*`).

---

## Phase 2 (Live trading)

These prompts are intended for after Phase 1 backtesting is working end-to-end.

### Parallelization rules (Phase 2)

- UI “Live Bots” screens can be done in parallel with backend Phase 2 work if API contract is stable.
- Backend Phase 2 work should be split by folder ownership to avoid conflicts (see Agent E vs Agent F scopes).

### What should be done sequentially (Phase 2)

- Decide the exact bot DB tables and migrations (Phase 2) before implementing persistence-heavy bot endpoints.
- Ensure Phase 1 shared types are stable before reusing them for Phase 2 bot DTOs.

## Prompt: Agent E (Phase 2 - Exchange adapters: Paper + Luno)

Copy/paste:

```text
You are implementing Phase 2 exchange adapters in a monorepo. Read and follow these docs as source of truth:
- docs/11-architecture.md
- docs/12-strategy-orb-atr.md
- docs/14-backtest-engine.md
- docs/18-dev-standards.md
- docs/23-live-trading-exchange-selection.md

Scope:
- Only edit files under apps/api/**, but restrict yourself to adapter-related subfolders:
  - `apps/api/**/adapters/**`
  - `apps/api/**/exchanges/**`
Do not touch bot lifecycle routes/controllers.

Implement:
- Define an adapter interface for:
  - Market data (fetch/stream candles)
  - Trading (place/cancel orders, query balances, query fills)
- Implement:
  - PaperTradingAdapter (uses live candles, simulates fills with fee/slippage model)
  - LunoTradingAdapter (real order placement) OR a stub with full interface + clear TODOs if Luno API constraints block progress.

Constraints:
- Strict TypeScript; no any; no non-null assertion; no unsafe casts.
- Double quotes for strings; no '+' concatenation.
- All secrets server-side only. Never expose API keys to frontend.
- Include JSDoc and inline comments for tricky parts (idempotency, retries, rate limits).
```

## Prompt: Agent F (Phase 2 - Bot lifecycle + API endpoints)

Copy/paste:

```text
You are implementing Phase 2 bot lifecycle management in a monorepo. Read and follow these docs as source of truth:
- docs/10-requirements.md
- docs/11-architecture.md
- docs/15-api-contracts.md (Phase 2 section)
- docs/17-supabase-schema-and-migrations.md
- docs/18-dev-standards.md
- docs/19-roadmap.md
- docs/23-live-trading-exchange-selection.md

Scope:
- Only edit files under apps/api/**, but restrict yourself to bot-related subfolders:
  - `apps/api/**/bots/**`
  - `apps/api/**/routes/**` (bot routes only)
Do not touch exchange adapter implementations.

Implement:
- Bot lifecycle endpoints:
  - create bot
  - start bot
  - stop bot
  - list bots
  - bot detail
  - bot logs/events
- Bot runner loop:
  - loads parameter set
  - consumes candles from adapter
  - runs strategy logic
  - places orders via adapter
  - persists bot events

Constraints:
- Strict TypeScript; no any; no non-null assertion; no unsafe casts.
- Double quotes for strings; no '+' concatenation.
- Implement robust error handling, retries, and safe stop/restart behavior.
```

## Prompt: Agent G (Phase 2 - Frontend Live Bots screens)

Copy/paste:

```text
You are implementing Phase 2 Live Bots UI. Read and follow these docs as source of truth:
- docs/15-api-contracts.md (Phase 2 endpoints)
- docs/16-ui-spec.md (Phase 2 Live Bots screens)
- docs/18-dev-standards.md
- docs/23-live-trading-exchange-selection.md (Luno is the default exchange)

Scope:
- Only edit files under apps/web/** (do not touch other folders).

Implement:
- Live Bots screens:
  - Bots list (start/stop actions, status)
  - Bot detail (position, recent orders/fills, logs stream)
- Use Supabase Auth (email/password) for UI access.
- Use backend API base URL env var for requests.

Constraints:
- Strict TypeScript; no any; no non-null assertion; no unsafe casts.
- Double quotes for strings; no '+' concatenation.
```


