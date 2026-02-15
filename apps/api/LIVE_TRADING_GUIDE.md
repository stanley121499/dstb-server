---
title: Live Trading Guide
---

# Live Trading Guide

This guide covers end-to-end setup, paper trading validation, and safe deployment for the live trading bot.

## Prerequisites

- Bitunix account (testnet + live).
- Bitunix API keys (store in environment variables, never commit).
- Supabase project with Phase 2 migrations applied.
- Node.js 18+ and npm 9+.

## Setup

1. Install dependencies:
   - `npm install`
2. Configure API env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENGINE_VERSION`
   - `BITUNIX_API_KEY` (live keys in production)
   - `BITUNIX_SECRET_KEY`

## Create a Bot Config (Best Params Export)

Export the best optimization run into a `bot-config.json` file:

```
npm run export-params -- --input optimization-results/run2.jsonl --metric sharpe --output bot-btc-15m.json
```

Optional overrides:

- `--exchange paper|bitunix`
- `--initialBalance 10000`
- `--maxDailyLossPct 5`
- `--maxPositionSizePct 25`
- `--bitunixApiKey <key>` (only for bitunix export)
- `--bitunixSecretKey <secret>` (only for bitunix export)
- `--bitunixTestMode true|false`
- `--bitunixMarketType spot|futures`

## Paper Trading Test (48 Hours Minimum)

Run the end-to-end paper trading validation:

```
npm run paper:test -- --hours 48 --metric totalReturn --input optimization-results/run2.jsonl
```

What the test validates:

- Signals are generated and logged.
- Orders are created and filled.
- Positions are tracked and closed.
- P&L snapshots exist.
- Risk limits are set.
- Heartbeat updates are fresh.
- Performance variance within ±5% of backtest expectations.

## Start Your First Bot

Start with paper trading:

```
npm run bot:start -- --config bot-config.json
```

Stop safely:

```
npm run bot:stop -- --id <bot-id>
```

## Monitoring Bot Performance

Use CLI tools:

```
npm run bot:status -- --id <bot-id>
npm run bot:positions -- --id <bot-id>
npm run bot:orders -- --id <bot-id>
npm run bot:trades -- --id <bot-id>
npm run bot:performance -- --id <bot-id>
npm run bot:logs -- --id <bot-id> --follow
```

## Emergency Procedures

Emergency stop all running bots:

```
npm run bot:emergency-stop-all
```

Manual close a position:

```
npm run bot:close-position -- --id <position-id> --reason manual_exit
```

## Pre-Launch Safety Checklist

Run the interactive checklist before going live:

```
npm run prelaunch:check -- --config bot-config.json
```

The checklist verifies:

- Paper trading 48+ hours completed.
- P&L matches backtest expectations.
- Bitunix testnet credentials work.
- Daily loss limit ≤ 5%.
- Starting capital is $50-$100.
- Monitoring plan and emergency stop readiness.
- Backup funds available.

## Deployment to Render (Background Worker)

Use the `render.yaml` blueprint at the repo root.

Key details:

- Service type: Background Worker.
- Build command: `npm ci && npm run -w apps/api build`
- Start command: `npm run -w apps/api bot:start -- --config /etc/secrets/bot-config.json`

### Secrets Management

- Upload `bot-config.json` to Render as a secret file:
  - `/etc/secrets/bot-config.json`
- Store API keys in Render environment variables:
  - `BITUNIX_API_KEY`
  - `BITUNIX_SECRET_KEY`

### Health Checks

Render workers do not support HTTP health checks. Use Supabase or CLI checks:

- Check last heartbeat in Supabase:
  - `select id, last_heartbeat_at from bots order by last_heartbeat_at desc;`
- Run health checks from a trusted machine:
  - `npm run bot:health -- --id <bot-id>`

### Deployment Steps

1. Push code to GitHub.
2. Connect Render to the repo.
3. Configure environment variables.
4. Upload `bot-config.json` as a secret file.
5. Deploy the worker.
6. Monitor logs for the first hour.
7. Verify `bots`, `live_orders`, and `live_positions` in Supabase.

## Testing Protocol

### Phase 1: Paper Trading (48+ Hours)

- Start bot with paper adapter.
- Verify entry signals and position open/close.
- Verify stops and take-profits are created.
- Verify P&L matches backtest expectations (±5%).
- Test bot restart (state recovery).
- Test emergency stop.

### Phase 2: Bitunix Testnet (24 Hours)

- Use testnet credentials.
- Validate order execution speed and error handling.
- Test rate limiting and invalid orders.

### Phase 3: Bitunix Live (Small Capital)

- Run pre-launch checklist.
- Start with $50-$100.
- Monitor first trade closely.
- Verify fills and fees.
- Increase capital gradually over weeks.

## Post-Launch Monitoring Plan

- Week 1: Check every 4 hours.
- Week 2-4: Check daily.
- After month: Check 2-3 times per week.

Set alerts for:

- Daily loss limit hit.
- Bot stopped unexpectedly.
- No trades in 24 hours (if expected activity).
- Balance drops > 10% in a day.

## Troubleshooting

- **No heartbeats**: check Render logs and Supabase connectivity.
- **No trades**: confirm strategy params and market conditions.
- **Order failures**: check Bitunix API keys and rate limits.
- **High drawdown**: verify risk settings and position sizing.

## Safety Warnings

Live trading involves real money and risk. Always:

- Use paper trading before live trading.
- Start with small capital.
- Monitor bots regularly.
- Never trade funds you cannot afford to lose.
