---
title: "Source summary — deploy, runtime, Supabase operational notes"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, supabase, render, docker, operations]
---

# Source summary: deploy, runtime, and Supabase operational notes

**Raw path:** [`raw/2026-04-07-deploy-runtime-supabase-notes.md`](../../raw/2026-04-07-deploy-runtime-supabase-notes.md)

## Summary

**Phase 1 stack:** Postgres via Supabase (`configs`, `bots`, trades, positions, orders, `trade_candles`, `bot_logs`, `config_versions`); migrations `supabase/migrations/20260407120000_phase1_core.sql` and optional seed `20260407120001_seed_configs_from_repo_json.sql`. **`npm run start`** → `src/server/index.ts`: enabled `configs`, Realtime control plane, **`GET /health`** on **`PORT`**. **Dockerfile** (Node 22) for Render Web Service; env vars in dashboard per **`DEPLOY-RENDER.md`**.

## Notable operational items

- **Git/Render:** feature branch vs `main` missing `Dockerfile` caused build failures — merge to deploy branch.
- **Env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` required; Bitunix placeholders via `credentials_ref`; optional Telegram/Sheets; **`PORT`** on Render.
- **Bitunix WebSocket:** `BitunixWebSocket.disconnect()` hardened (CONNECTING teardown → noop error handler, `terminate` when not OPEN).
- **Health:** liveness-first **200**; Supabase check best-effort ~**2.5s** timeout → `"db": "ok" | "degraded"`.
- **Seed:** `enabled = false` by default; `ON CONFLICT DO NOTHING` on `(name, symbol)`.

## Stale clause in raw (superseded)

The raw file’s section **“`bot_logs` table empty — expected today”** described the codebase **before** `TradingBot.persistThought()` wired **`insertBotLog`**. Treat [[bot-logs-gap-and-integration-plan|bot_logs gap + integration plan]] and `src/core/TradingBot.ts` as current truth for whether rows appear.

## Cross-references

- `DEPLOY-RENDER.md` (repo root)
- [[../synthesis/v3-planning-document-set|v3 planning document set]]
- [[bot-logs-gap-and-integration-plan|bot_logs integration]]
