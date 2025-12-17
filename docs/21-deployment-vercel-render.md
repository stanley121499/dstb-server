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


