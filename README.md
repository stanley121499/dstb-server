# DSTB Trading Bot

**Simplified, Robust CLI Trading Bot** for cryptocurrency strategies.

## 🎯 What Is This?

A **bulletproof trading bot** designed for running algorithmic crypto strategies 24/7 with:
- ✅ **Plugin-based strategies** - Add new strategies in minutes
- ✅ **Rock-solid infrastructure** - Auto-recovery, reconnection, error alerts
- ✅ **Multi-bot support** - Run multiple strategies simultaneously
- ✅ **Real-time monitoring** - Telegram alerts + Google Sheets dashboard
- ✅ **CLI-first** - No complex UI to maintain

## 📚 Documentation

**LLM Wiki vault:** [`dstb-docs/index.md`](./dstb-docs/index.md) · **Canonical doc files:** [`dstb-docs/raw/docs/README.md`](./dstb-docs/raw/docs/README.md) · **Agent schema:** [`CLAUDE.md`](./CLAUDE.md)

### Quick Links

- **[📖 Architecture Overview](./dstb-docs/raw/docs/architecture.md)** - Start here to understand the simplified system
- **[🔌 Strategy Plugin Guide](./dstb-docs/raw/docs/strategy-plugin-guide.md)** - How to create and test strategies
- **[🚀 Deployment Guide](./dstb-docs/raw/docs/deployment-guide.md)** - Running on Windows/Linux/Cloud
- **[💻 CLI Reference](./dstb-docs/raw/docs/cli-reference.md)** - All available commands
- **[📊 Monitoring Setup](./dstb-docs/raw/docs/monitoring-setup.md)** - Telegram + Google Sheets
- **[📈 Backtest Engine](./dstb-docs/raw/docs/backtest-engine.md)** - Understanding strategy backtesting

## 🚀 Quick Start

Set **Supabase** env vars (see [`.env.example`](./.env.example)): `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Apply SQL migrations under [`supabase/migrations/`](./supabase/migrations/) to your project, then seed the `configs` table (see [`configs/strategies/README.md`](./configs/strategies/README.md)).

```bash
# Install dependencies
npm install

# Copy env template
copy .env.example .env

# Test with paper trading (simulated fills) — upserts config into Supabase
npm run bot -- start --config configs/bot.example.json --paper

# Long-running server (loads enabled configs from Supabase + Realtime)
npm run start

# Check status of the running bot
npm run bot -- status

# Stop bot
npm run bot -- stop <bot-id>
```

Optional: migrate old SQLite data with `npm run import:sqlite` (see script header in `src/scripts/sqliteToSupabaseImport.ts`).

## 📁 Project Structure

```
dstb-bot/
├── src/
│   ├── core/              # Bot engine (TradingBot, SupabaseStateStore)
│   ├── supabase/          # Supabase client + env helpers
│   ├── strategies/        # Strategy plugins (orb-atr, sma-crossover)
│   ├── exchange/          # Exchange adapters (bitunix, paper trading)
│   ├── monitoring/        # Alerts & reporting (Telegram, Sheets)
│   ├── backtest/          # Deterministic candle-based backtest engine
│   ├── cli/               # CLI commands
│   └── utils/             # Helpers
├── supabase/migrations/   # Postgres schema (Phase 1 v3)
├── configs/               # Example JSON; live configs in Supabase
├── data/                  # Daemon records, optional local files
├── logs/                  # Log files
├── docs/                  # Stub → see dstb-docs/
└── dstb-docs/             # LLM Wiki (raw/docs = markdown archive, wiki = synthesis)
```

## 📊 Monitoring

### Google Sheets Dashboard
Your partner (non-technical) can view a live Google Sheet with:
- Current equity for each bot
- Open positions
- Today's P&L
- Recent trades
- Bot status

### Telegram Alerts
Get instant notifications for:
- 🔴 Bot crashes or disconnections
- 🔴 Position liquidations
- 🟡 Unusual events (slippage, API rate limits)

## 🎮 Usage Examples

### Running Bots

```bash
# Start a live bot
npm run bot -- start --config configs/bot-live-eth-bitunix.json

# View all running bot statuses
npm run bot -- status
```

### Backtesting

```bash
# Backtest a strategy over historical data
npm run bot -- backtest --config configs/bot.example.json \
  --start 2024-01-01 \
  --end 2024-12-31 \
  --output dstb-docs/raw/docs/reports/backtest-2024.json
```

### Emergency Controls

```bash
# Stop all bots immediately
npm run bot -- stop --all --force
```

## ⚠️ Safety Disclaimer

**This software handles real money trading. Always:**
- Test with paper trading for 48+ hours
- Start with small capital
- Monitor closely for the first month
- Never risk money you can't afford to lose
- Understand the risks of algorithmic trading

**This software is provided as-is with no guarantees. Use at your own risk.**

## 🆘 Support

- Read [`dstb-docs/index.md`](./dstb-docs/index.md) and the [doc index](./dstb-docs/raw/docs/README.md) first
- Review [Deployment Guide](./dstb-docs/raw/docs/deployment-guide.md)
