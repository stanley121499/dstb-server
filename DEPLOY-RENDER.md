# Deploying DSTB on Render (Docker)

## Service type

Use a **Web Service** (not only a Background Worker): the server binds to `PORT` and exposes **`GET /health`** for UptimeRobot and Render health checks.

## Environment variables

Configure secrets in the Render dashboard. Required for Phase 1 v3:

- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service role is used by the bot server to bypass RLS; keep secret).
- **Exchange (live Bitunix):** `BITUNIX_API_KEY`, `BITUNIX_SECRET_KEY` — these match `${BITUNIX_API_KEY}` / `${BITUNIX_SECRET_KEY}` in `credentials_ref` when configs use env placeholders (see seed migration / `configs/examples/eth-live-v3.example.json`).
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Google Sheets:** `GOOGLE_SHEETS_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` as a path to a JSON key file. Use a [secret file](https://render.com/docs/configure-environment-variables#secret-files) so the path exists in the container.

## Configs and data

- Strategy definitions live in **Supabase** (`configs` table). Enable bots by setting `enabled = true`. See [`configs/strategies/README.md`](./configs/strategies/README.md).
- **No SQLite** on the server: state is in Postgres. Redeploys do not wipe trading history when using Supabase.

## Local Docker check

```bash
docker build -t dstb-server .
docker run --rm -e NODE_ENV=production -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -p 8787:8787 dstb-server
```

Pass the same env vars your bots require for a meaningful run.
