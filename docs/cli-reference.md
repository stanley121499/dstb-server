# CLI Reference

**Last Updated:** February 2026

---

## Installation

```powershell
# Run directly with tsx (development)
node --import tsx src/cli/index.ts <command>

# Or use the npm shortcut
npm run bot -- <command>
```

The `bot` command is also available via the `bin/bot.cjs` entry point.

---

## Implemented Commands

| Command | Description |
|---------|-------------|
| `bot start` | Start a trading bot |
| `bot stop` | Stop a bot (or all bots) |
| `bot status` | Show bot status summary |
| `bot logs` | View or follow log output |
| `bot backtest` | Run a deterministic backtest |
| `bot reconcile` | Compare SQLite state vs exchange reality |

---

## `bot start`

Start a trading bot with a given config file.

```bash
bot start --config <path> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to strategy config JSON (required) |
| `--paper` | Use paper trading mode (no real orders) |

**Examples:**
```bash
# Paper trading
bot start --config configs/bot-live-eth-bitunix.json --paper

# Live trading
bot start --config configs/bot-live-eth-bitunix.json
```

---

## `bot stop`

Stop a running bot or all bots.

```bash
bot stop [bot-id] [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `[bot-id]` | ID of the bot to stop |
| `--all` | Stop all running bots |
| `--force` | Immediately halt (skip graceful position close) |

**Examples:**
```bash
bot stop fd887a5a-1d30-41a7-aa58-96bd8fdbedce
bot stop --all
bot stop --all --force
```

---

## `bot status`

Show status for one or all bots.

```bash
bot status [bot-id]
```

Prints: strategy, exchange, symbol, current equity, open position, error count, uptime, and last heartbeat.

---

## `bot logs`

View log output for a bot.

```bash
bot logs <bot-id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--follow` | Stream logs in real-time |
| `--tail <n>` | Show last N lines (default: 100) |
| `--level <level>` | Filter by level: `error`, `warn`, `info`, `debug` |

**Examples:**
```bash
bot logs fd887a5a --follow
bot logs fd887a5a --tail 50 --level error
```

---

## `bot backtest`

Run a deterministic backtest using the candle-based engine in `src/backtest/runBacktest.ts`.

```bash
bot backtest --config <path> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--config <path>` | Strategy config file (required) |
| `--start <YYYY-MM-DD>` | Backtest start date |
| `--end <YYYY-MM-DD>` | Backtest end date |
| `--output <path>` | Save JSON results to file |

**Examples:**
```bash
bot backtest --config configs/bot.example.json \
  --start 2024-01-01 \
  --end 2024-12-31 \
  --output docs/reports/backtest-2024.json
```

**Output:**
```
Running backtest...
  Symbol: BTCUSDT | Interval: 15m
  Period: 2024-01-01 → 2024-12-31

Results:
  Total Return:   +45.2%
  Max Drawdown:   -18.3%
  Win Rate:       48%
  Profit Factor:  1.42
  Total Trades:   142
```

---

## `bot reconcile`

Checks that the positions tracked in SQLite match what the exchange reports. Useful after a crash or unexpected restart.

```bash
bot reconcile [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--bot-id <id>` | Check a specific bot only |

---

## Config File Format

```json
{
  "name": "ORB BTC 15m",
  "strategy": "orb-atr",
  "exchange": "bitunix",
  "symbol": "BTCUSDT",
  "interval": "15m",
  "initialBalance": 5000,
  "riskManagement": {
    "maxDailyLossPct": 5,
    "maxPositionSizePct": 20
  },
  "params": {
    "session": "NY",
    "atrLength": 14,
    "openingRangeMinutes": 30,
    "entry": { "directionMode": "long_only" }
  },
  "bitunix": {
    "apiKey": "${BITUNIX_API_KEY}",
    "secretKey": "${BITUNIX_SECRET_KEY}",
    "testMode": false,
    "marketType": "futures"
  }
}
```

> Config files live in `configs/`. See `configs/bot.example.json` for a full example.

---

## Environment Variables

```bash
# Bitunix exchange
BITUNIX_API_KEY=
BITUNIX_SECRET_KEY=

# Telegram alerts
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Google Sheets
GOOGLE_SHEETS_ID=
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=path/to/key.json

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_TO=
```

Copy `.env` and fill in values. Never commit real keys.

---

## See Also

- [Architecture](./architecture.md)
- [Deployment Guide](./deployment-guide.md)
- [Strategy Plugin Guide](./strategy-plugin-guide.md)
