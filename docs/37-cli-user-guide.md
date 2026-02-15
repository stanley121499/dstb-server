# CLI User Guide

**Status:** ✅ Implemented  
**Last Updated:** February 2026

## Overview

This guide covers the DSTB CLI for starting, stopping, monitoring, and backtesting bots using the simplified core engine.

## Installation

```powershell
# Install dependencies
npm install

# Run the CLI from the repo root
npm run bot -- --help
```

## Quick Start

```bash
# Start a bot in paper mode
bot start --config configs/strategies/orb-btc-15m.json --paper

# Start a bot as a daemon
bot start --config configs/strategies/orb-btc-15m.json --daemon

# Check status for all bots
bot status

# Follow logs for a specific bot
bot logs bot-abc123 --follow

# Stop a specific bot
bot stop bot-abc123
```

## Command Reference (Implemented)

### `bot start`

Start a trading bot from a config file.

```bash
bot start --config <path> [--paper] [--dry-run] [--daemon]
```

Notes:
- `--paper` forces paper trading regardless of config.
- `--dry-run` uses paper trading and skips real exchange orders.
- `--daemon` runs the bot in the background and writes a PID record in `data/daemon/`.

### `bot stop`

Stop a running bot.

```bash
bot stop [bot-id] [--all] [--force]
```

Notes:
- If no `bot-id` is provided, all bots are stopped.
- `--force` attempts to close open positions immediately via the exchange adapter.

### `bot status`

Show bot status.

```bash
bot status [bot-id]
```

Notes:
- With no `bot-id`, a summary table for all bots is shown.

### `bot logs`

View bot logs.

```bash
bot logs <bot-id> [--tail <n>] [--level <level>] [--since <time>] [--follow]
```

Notes:
- `--tail` defaults to 100 lines.
- `--since` accepts durations like `1h`, `30m`, or an ISO timestamp.
- `--follow` streams new log lines in real time.

### `bot backtest`

Run a backtest using Yahoo candles.

```bash
bot backtest --config <path> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [--output <path>]
```

Notes:
- Results are printed to stdout and optionally written to the output path as JSON.

### `bot reconcile`

Reconcile DB state with exchange reality.

```bash
bot reconcile [bot-id] [--fix]
```

Notes:
- With no `bot-id`, all bots are reconciled.
- `--fix` attempts to align DB positions and equity with the exchange snapshot.

## Daemon Mode

- Daemon mode spawns a detached process and writes a record to `data/daemon/`.
- Use `bot stop` to terminate the daemon and remove the registry file.
- If a daemon process crashes, `bot status` still shows the bot in SQLite; you can restart by running `bot start` again.

## Log Streaming

Log files are written to `logs/` with names like:

```
logs/bot-<id>-YYYY-MM-DD.log
```

Use `bot logs <id> --follow` to stream updates in real time.

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - Configuration error
- `4` - Bot not found
- `5` - Exchange error
- `6` - Permission error

