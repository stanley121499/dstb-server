# Deploy, runtime, and Supabase operational notes (2026-04-07)

Immutable source note for ingestion. Summarizes recent server/infra behavior and gaps.

## Stack (Phase 1 v3)

- **State and configs:** PostgreSQL via **Supabase** (`configs`, `bots`, `trades`, `positions`, `orders`, `trade_candles`, `bot_logs`, `config_versions`). Migrations under `supabase/migrations/` (`20260407120000_phase1_core.sql`, optional seed `20260407120001_seed_configs_from_repo_json.sql`).
- **Long-running process:** `npm run start` → `src/server/index.ts` — loads **enabled** rows from `configs`, **Realtime** subscription on `configs` for control plane, **HTTP** on **`PORT`** with **`GET /health`**.
- **Docker / Render:** Root **`Dockerfile`** (Node 22, `npm ci --omit=dev`, `CMD ["npm","start"]`). **Web Service** on Render; set env in dashboard (not baked into image). **`DEPLOY-RENDER.md`** at repo root lists required/optional variables.

## Git / deploy gotcha (resolved)

- Feature work lived on **`fix/yahoo-null-ohlc`** while **GitHub `main`** lacked **`Dockerfile`**. Render builds **`main`** → builds failed with `open Dockerfile: no such file or directory`.
- **Fix:** merge feature branch into **`main`** and push so `Dockerfile` and `.dockerignore` exist on the branch Render deploys.

## Environment variables (production)

- **Required:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service role bypasses RLS for the server).
- **Bitunix live configs** using placeholders: `BITUNIX_API_KEY`, `BITUNIX_SECRET_KEY` (substituted by `ConfigLoader` from `credentials_ref` when values look like `${VAR}`).
- **Optional:** Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), Google Sheets (`GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` as path to key JSON — Render secret files).
- **Render:** **`PORT`** is injected by the platform; app must listen on `process.env.PORT` (default locally `8787`).

## Runtime fixes (2026-04-07)

### Bitunix WebSocket teardown crash

- **Symptom:** Process exited with unhandled `error` on `ws` when stopping the bot during **`applyConfigChange`** (e.g. config/Realtime-driven restart) while the socket was still **CONNECTING**.
- **Cause:** `ws.close()` before the connection is established emits an `error` event; with listeners removed, Node treats it as fatal.
- **Fix:** `BitunixWebSocket.disconnect()` — clear reference first, `removeAllListeners()`, attach noop `error` handler, **`close()`** only when **OPEN**, else **`terminate()`** for non-closed states. File: `src/exchange/BitunixWebSocket.ts`.

### Render “success then SIGTERM”

- **`npm error signal SIGTERM`** means the **platform** sent **SIGTERM** (new deploy, health-check policy, restart, plan behavior), not necessarily an application exception.
- **Health checks:** `/health` previously depended on Supabase on every request; slow or failing DB could yield **500** or long hangs → failed probes.
- **Fix:** **`/health`** is **liveness-first**: always returns **200** quickly; Supabase snapshot is **best-effort** with a **~2.5s** timeout; body includes `"db": "ok"` or `"db": "degraded"`. File: `src/server/index.ts`.

## `configs` seed

- Seed migration inserts paper + example Bitunix rows with **`enabled = false`** by default; operators enable rows in Studio or SQL when ready.
- Unique **`(name, symbol)`**; seed uses **`ON CONFLICT DO NOTHING`**.

## `bot_logs` table empty — expected today

- The **`bot_logs`** table and **`SupabaseStateStore.insertBotLog()`** exist, but **no call sites** in the codebase currently invoke **`insertBotLog`** (grep shows only the store method definition).
- Therefore an **empty `bot_logs` table after hours of deploy is expected** with the current implementation. Logs still go to **filesystem** via **`Logger`** under the resolved log directory, not automatically to Postgres.
- **ORB session timing** (e.g. NY session vs user local **GMT+8**) affects **when the strategy trades**, not whether **`bot_logs`** fills; filling **`bot_logs`** requires **wiring** logger or key **`TradingBot`** events to **`insertBotLog`** (future work).

## Related paths

- `DEPLOY-RENDER.md` — Render checklist.
- `configs/strategies/README.md` — disk JSON vs Supabase `configs`.
- `src/server/index.ts` — health server, startup order.
- `src/server/BotManager.ts` — Realtime + autostart from `configs`.
