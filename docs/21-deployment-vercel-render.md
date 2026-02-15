# Deployment guide: Vercel (web) + Render (api)

## Goal

- Deploy React frontend (`apps/web`) to **Vercel**
- Deploy Node.js API (`apps/api`) to **Render**
- Use Supabase hosted project for database + auth

## Prerequisites

- Supabase project created (Auth enabled: email/password)
- Repo is a monorepo with the structure defined in `20-monorepo-and-local-dev.md`

## Vercel deployment (frontend)

### Project settings

- **Root Directory**: `apps/web`
- **Framework Preset**: Vite (if using Vite) or appropriate React preset

### Build settings (typical)

- **Install command**: `npm ci`
- **Build command**: `npm run -w apps/web build`
- **Output directory**: `apps/web/dist`

### Environment variables (Vercel)

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Notes

- Ensure CORS/auth redirect URLs are configured in Supabase Auth settings:
  - Add your Vercel domain as an allowed redirect URL.

## Render deployment (backend)

Two common approaches:

### Option A (recommended): Render “Web Service” (Node)

Project settings:

- **Root Directory**: `apps/api`
- **Runtime**: Node

Build and start:

- **Build command**: `npm ci && npm run -w apps/api build`
- **Start command**: `npm run -w apps/api start`

Environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Option B: Docker (if you prefer)

- Use a Dockerfile inside `apps/api`
- Render builds and runs the container

## Deploying Live Trading Bots to Render

### Prerequisites

- Bot configuration file with valid parameters (see `apps/api/bot-config.example.json`)
- Bitunix API credentials (required for `exchange: "bitunix"`)
- Supabase database with Phase 2 migrations applied (`supabase/migrations/0002_phase2_live_trading.sql`, `supabase/migrations/0003_add_bots_unique_name.sql`)
- Render worker service configured with `render.yaml`

### Deployment steps

1. Set required environment variables in the Render dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `BITUNIX_API_KEY` (required for Bitunix)
   - `BITUNIX_SECRET_KEY` (required for Bitunix)
   - `ENGINE_VERSION` (optional, used for tagging/logging)
2. Create the bot config as a Render secret file and mount it at `/etc/secrets/bot-config.json`.
3. Deploy the worker using `render.yaml`. The worker command should follow the CLI order:
   - `node apps/api/dist/scripts/botCli.js start --config /etc/secrets/bot-config.json`
4. Capture the bot id from the start output to use for status/log commands.

### CLI monitoring commands (local)

- Start a bot locally:
  - `npm run -w apps/api bot:start -- --config bot-config.json`
- Check bot status:
  - `npm run -w apps/api bot:status -- --id <bot-id>`
- Stream bot logs:
  - `npm run -w apps/api bot:logs -- --id <bot-id> --follow`
- List all bots:
  - `npm run -w apps/api bot:list`

### Troubleshooting tips

- If the CLI reports `Missing --config <path>`, ensure the command order is `start --config <path>` and the file exists.
- If validation fails for Bitunix spot configs, set `params.entry.directionMode` to `long_only`.
- If a bot fails immediately, verify Supabase migrations were applied and all required env vars are set.
- If Render cannot start the worker, ensure the build produced `apps/api/dist/scripts/botCli.js`.

## CORS and API base URL

- The web app must know the API base URL (Render URL).
- Add a frontend env var:
  - `VITE_API_BASE_URL`

Backend must allow CORS from:

- Your Vercel domain(s)
- `http://localhost:5173` (local dev)

## Supabase migrations (deployment)

Source of truth for schema changes:

- `supabase/migrations/*.sql`

Recommended workflow:

- Apply migrations to Supabase before deploying API changes that depend on them.

## Production checklist

- Confirm `SUPABASE_SERVICE_ROLE_KEY` is only on Render (server-only).
- Confirm Supabase Auth email/password enabled.
- Confirm Supabase redirect URLs include:
  - Local dev URL(s)
  - Vercel domain URL(s)
- Confirm CORS allowed origins are restricted (not `*`).


