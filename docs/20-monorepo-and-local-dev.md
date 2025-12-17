# Monorepo + local development setup

## Goal

This repo is a monorepo containing:

- Backend API server (Node.js + TypeScript)
- React frontend (React + TypeScript)
- Shared packages (types/schemas) that both sides can import

This doc defines the intended structure and how to run everything locally.

## Recommended monorepo structure (authoritative)

```
apps/
  api/                # Backend server (Render deployment target)
  web/                # React UI (Vercel deployment target)
packages/
  shared/             # Shared TypeScript: types, schemas, utils
supabase/
  migrations/         # SQL migrations (checked into git)
docs/
```

## Package manager

### Recommendation for this repo (authoritative)

Use **npm workspaces**.

Reason:

- You reported recurring instability when `pnpm` and `npm` accidentally mixed in the same repo (lockfile/tooling drift).
- npm workspaces are a lower-friction default on Windows when you want to avoid cross-manager edge cases.

### Golden rule: never mix package managers

Mixing managers is the main cause of:

- `package-lock.json` appearing “randomly”
- inconsistent `node_modules`
- install/build differences between machines/CI

Rules:

- Use **one** lockfile for the repo:
  - npm: `package-lock.json`
  - pnpm: `pnpm-lock.yaml`
  - yarn: `yarn.lock`
- Delete the others and keep them out of git.

Optional enforcement (recommended once code exists):

- Set `packageManager` in the root `package.json` (pins the intended tool/version).
- Add a `preinstall` script that blocks the wrong package manager (e.g., using `only-allow`).
  - Note: this prevents accidental `npm install` in a pnpm repo and vice-versa.

## Environment variables

### Web (public-safe)

Frontend requires Supabase public settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are safe to expose in the browser (anon key is public by design).

### API (server-only)

Backend requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only secret)

Optional (if you also use anon key server-side for certain flows):

- `SUPABASE_ANON_KEY`

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.

## Local dev: Supabase

Two valid approaches:

### Option A (recommended): Use Supabase hosted project

- Create a Supabase project in the Supabase dashboard.
- Configure Auth providers:
  - Enable **Email/Password**
- Apply migrations from `supabase/migrations/`.

### Option B: Use Supabase local development

If you want local Postgres + Auth emulator, use the Supabase CLI.

This requires installing Supabase CLI and having Docker available.

## Local dev: running apps

The intended local workflow:

- Run the API on a local port (e.g., 3001)
- Run the web app on a local port (e.g., 5173)

Both should read environment variables from:

- `apps/api/.env`
- `apps/web/.env`

If you use Vercel/Render, local `.env` files should mirror production env var names.

## Shared package usage

`packages/shared` should contain:

- Shared TypeScript types (e.g., `BacktestParams`, `BacktestRun`)
- Shared validation schemas (recommended: Zod)
- Shared constants/enums used in both UI and server

This reduces drift between API and frontend.

## Auth model (Phase 1)

- Supabase Auth with **email + password** (see `docs/10-requirements.md`)
- Web app handles login/signup
- API validates requests using Supabase JWT (recommended) OR uses a server-only key with strict routing.

For single-client, we keep this simple, but still avoid insecure patterns.


