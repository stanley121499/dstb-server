# CLI Reference

**Status:** 🚧 In Implementation  
**Last Updated:** February 2026

## Overview

Complete reference for all CLI commands in the DSTB trading bot.

**Implemented Commands (current CLI):**
- `bot start`
- `bot stop`
- `bot status`
- `bot logs`
- `bot backtest`
- `bot reconcile`

Commands not listed above are planned and not yet implemented in the current CLI build.

## Installation

```powershell
# Build the bot first
npm run build

# CLI will be available as 'bot' command
```

## Global Options

All commands support:
- `--help` - Show help for command
- `--verbose` - Enable debug logging
- `--config` - Specify config file path

---

## Bot Management

### `bot start`

Start a trading bot.

**Syntax:**
```bash
bot start --config <path> [options]
```

**Options:**
- `--config <path>` - Path to strategy config file (required)
- `--paper` - Use paper trading (simulated fills)
- `--daemon` - Run in background
- `--dry-run` - Simulate without placing real orders

**Examples:**
```bash
# Start with paper trading
bot start --config configs/strategies/orb-btc-15m.json --paper

# Start live trading in background
bot start --config configs/strategies/orb-btc-15m.json --daemon

# Dry run (no orders placed)
bot start --config configs/strategies/orb-btc-15m.json --dry-run
```

**Output:**
```
🚀 Starting bot: ORB BTC 15m
Bot ID: bot-abc123
Strategy: orb-atr
Exchange: bitunix (paper mode)
Symbol: BTC-USD
Initial Balance: $5,000.00

✅ Bot started successfully
Status: running
Logs: logs/bot-abc123-2026-02-04.log
```

---

### `bot stop`

Stop a running bot.

**Syntax:**
```bash
bot stop [bot-id] [options]
```

**Options:**
- `[bot-id]` - Specific bot to stop (omit to stop all)
- `--force` - Force stop (close positions immediately)
- `--all` - Stop all running bots

**Examples:**
```bash
# Stop specific bot (closes positions gracefully)
bot stop bot-abc123

# Force stop (emergency)
bot stop bot-abc123 --force

# Stop all bots
bot stop --all
```

**Output:**
```
🛑 Stopping bot: bot-abc123

Closing open positions...
  ✅ Closed LONG 0.1 BTC @ 45,500 (PnL: +$234.50)

Cancelling pending orders...
  ✅ No pending orders

Saving state...
  ✅ State saved to database

✅ Bot stopped successfully
Final Equity: $5,234.50
Total PnL: +$234.50 (+4.69%)
```

---

### `bot list`

List all bots.

**Syntax:**
```bash
bot list [options]
```

**Options:**
- `--status <status>` - Filter by status (running, stopped, error)
- `--json` - Output as JSON

**Output:**
```
╔═════════════════════════════════════════════════════════════════╗
║                      Running Bots                                ║
╠═════════════════════════════════════════════════════════════════╣

ID          | Name                  | Status  | Uptime    | Equity    | Today P&L
------------|----------------------|---------|-----------|-----------|------------
bot-abc123  | ORB BTC Aggressive   | running | 2h 15m    | $5,234.50 | +$234.50
bot-def456  | ORB BTC Conservative | running | 2h 15m    | $4,889.20 | -$110.80
bot-ghi789  | CME Gap ETH         | waiting | 1h 03m    | $5,000.00 | $0.00

Total Bots: 3 | Running: 2 | Stopped: 0 | Error: 0
Portfolio Value: $15,123.70 | Today P&L: +$123.70 (+0.82%)
```

---

### `bot status`

Show detailed bot status.

**Syntax:**
```bash
bot status [bot-id]
```

**Options:**
- `[bot-id]` - Specific bot (omit for all bots summary)

**Output:**
```
╔═════════════════════════════════════════════════════════════════╗
║  Bot: ORB BTC Aggressive (bot-abc123)                           ║
╠═════════════════════════════════════════════════════════════════╣

Status: running
Strategy: orb-atr
Exchange: bitunix
Symbol: BTC-USD
Interval: 15m

Financial:
  Initial Balance:   $5,000.00
  Current Equity:    $5,234.50
  Total PnL:         +$234.50 (+4.69%)
  Today PnL:         +$123.00 (+2.35%)

Position:
  Side:              LONG
  Quantity:          0.1 BTC
  Entry Price:       $45,000
  Current Price:     $45,500
  Unrealized PnL:    +$50.00 (+1.11%)
  Stop Loss:         $44,500
  Take Profit:       $46,500

Strategy State:
  Session Active:    Yes
  OR Complete:       Yes
  OR High:           $45,200
  OR Low:            $44,800
  ATR:               $450.20
  Trades Today:      2

System:
  Uptime:            2h 15m 33s
  Last Heartbeat:    5 seconds ago
  Last Trade:        1h 12m ago
  Memory Usage:      245 MB
  Error Count:       0
```

---

## Monitoring

### `bot logs`

View bot logs.

**Syntax:**
```bash
bot logs [bot-id] [options]
```

**Options:**
- `[bot-id]` - Specific bot (required)
- `--follow` - Stream logs in real-time
- `--level <level>` - Filter by level (error, warn, info, debug)
- `--tail <n>` - Show last N lines (default: 100)
- `--since <time>` - Show logs since time (e.g., "1h", "30m")

**Examples:**
```bash
# View last 50 lines
bot logs bot-abc123 --tail 50

# Follow logs in real-time
bot logs bot-abc123 --follow

# Show only errors
bot logs bot-abc123 --level error

# Show logs from last hour
bot logs bot-abc123 --since 1h
```

**Output:**
```
[09:30:21] INFO  📊 Session opened: NY 09:30
[09:30:21] INFO  📈 Opening range: 44800-45200
[10:32:14] INFO  ⚡ LONG signal at 45220 (breakout)
[10:32:18] INFO  ✅ Order filled: LONG 0.1 BTC @ 45210
[10:32:18] INFO  📍 Stop loss @ 44500 | Take profit @ 46500
[11:45:33] INFO  📊 Position update: +$123.50 (+2.73%)
[12:30:45] INFO  ✅ Take profit hit @ 46505
[12:30:45] INFO  💰 Trade closed: +$1295 PnL (+2.86% | R=2.59)
```

---

### `bot positions`

Show open positions.

**Syntax:**
```bash
bot positions [bot-id]
```

**Options:**
- `[bot-id]` - Specific bot (omit for all bots)

**Output:**
```
╔═════════════════════════════════════════════════════════════════╗
║                      Open Positions                              ║
╠═════════════════════════════════════════════════════════════════╣

Bot: ORB BTC Aggressive (bot-abc123)
  Side:        LONG
  Symbol:      BTC-USD
  Quantity:    0.1 BTC
  Entry:       $45,000 (2h 15m ago)
  Current:     $45,500
  PnL:         +$50.00 (+1.11%)
  Stop:        $44,500
  Take Profit: $46,500
  Risk:        $50.00 (1.0%)
  R-Multiple:  +1.0R

Bot: CME Gap ETH (bot-ghi789)
  No open position

Total Position Value: $4,550
Total Unrealized PnL: +$50.00
```

---

### `bot trades`

Show trade history.

**Syntax:**
```bash
bot trades [bot-id] [options]
```

**Options:**
- `[bot-id]` - Specific bot (omit for all bots)
- `--days <n>` - Show last N days (default: 7)
- `--today` - Show only today's trades
- `--week` - Show this week
- `--month` - Show this month
- `--winners` - Show only winning trades
- `--losers` - Show only losing trades

**Examples:**
```bash
# Today's trades
bot trades bot-abc123 --today

# Last 30 days
bot trades bot-abc123 --days 30

# Only winners this month
bot trades bot-abc123 --month --winners
```

**Output:**
```
╔═════════════════════════════════════════════════════════════════╗
║  Trades: Last 7 Days (bot-abc123)                               ║
╠═════════════════════════════════════════════════════════════════╣

Date       | Side  | Entry   | Exit    | PnL      | R-Mult | Exit Reason
-----------|-------|---------|---------|----------|--------|-------------
2026-02-04 | LONG  | 45,000  | 46,500  | +$150.00 | +3.0R  | Take profit
2026-02-04 | SHORT | 45,800  | 45,600  | +$20.00  | +0.4R  | Stop moved
2026-02-03 | LONG  | 44,500  | 44,200  | -$30.00  | -1.0R  | Stop loss
2026-02-03 | SHORT | 44,100  | 43,500  | +$60.00  | +1.2R  | Take profit
2026-02-02 | LONG  | 43,800  | 44,100  | +$30.00  | +0.6R  | Session end

Summary:
  Total Trades:     5
  Winners:          4 (80%)
  Losers:           1 (20%)
  Total PnL:        +$230.00 (+4.60%)
  Avg Win:          +$65.00
  Avg Loss:         -$30.00
  Profit Factor:    7.67
  Avg R-Multiple:   +0.84R
```

---

### `bot performance`

Show performance metrics.

**Syntax:**
```bash
bot performance [bot-id] [options]
```

**Options:**
- `[bot-id]` - Specific bot (required)
- `--period <days>` - Analysis period (default: 30)

**Output:**
```
╔═════════════════════════════════════════════════════════════════╗
║  Performance Report: ORB BTC Aggressive (bot-abc123)            ║
║  Period: Last 30 Days                                           ║
╠═════════════════════════════════════════════════════════════════╣

Returns:
  Total Return:       +18.5%
  Daily Avg Return:   +0.62%
  Best Day:           +4.2% (2026-02-01)
  Worst Day:          -2.8% (2026-01-25)

Risk:
  Max Drawdown:       -8.3%
  Sharpe Ratio:       1.45
  Sortino Ratio:      2.12
  Win Rate:           52%
  Profit Factor:      1.85

Trading:
  Total Trades:       87
  Avg Trade:          +0.21%
  Avg Win:            +1.2%
  Avg Loss:           -0.9%
  Largest Win:        +3.5%
  Largest Loss:       -2.1%
  Avg Hold Time:      4h 23m

Execution:
  Avg Slippage:       0.08%
  Avg Fee:            0.10%
  Total Fees Paid:    $45.20

Current Status:
  Equity:             $5,918.50
  Days Trading:       30
  Current Streak:     3 winners
  Last Trade:         +$123.50 (2h ago)
```

---

## Testing

### `bot backtest`

Run a backtest.

**Syntax:**
```bash
bot backtest --config <path> [options]
```

**Options:**
- `--config <path>` - Strategy config file (required)
- `--start <date>` - Start date (YYYY-MM-DD)
- `--end <date>` - End date (YYYY-MM-DD)
- `--output <path>` - Save results to file

**Example:**
```bash
bot backtest --config configs/strategies/orb-btc-15m.json \
  --start 2024-01-01 \
  --end 2024-12-31 \
  --output results/backtest-2024.json
```

**Output:**
```
Running backtest...
  Symbol: BTC-USD
  Interval: 15m
  Period: 2024-01-01 to 2024-12-31 (365 days)
  Initial Equity: $10,000

Progress: [████████████████████] 100% (8760/8760 candles)

Results:
  Total Return:       +45.2%
  Final Equity:       $14,520.00
  Max Drawdown:       -18.3%
  Sharpe Ratio:       1.32
  Sortino Ratio:      1.89
  Win Rate:           48%
  Profit Factor:      1.42
  Total Trades:       142
  Avg Trade:          +$31.83
  Best Trade:         +$892.00
  Worst Trade:        -$456.00

✅ Results saved to: results/backtest-2024.json
```

---

### `bot backtest-grid`

Batch backtest multiple parameter combinations.

**Syntax:**
```bash
bot backtest-grid --grid <path> [options]
```

**Options:**
- `--grid <path>` - Grid config file (required)
- `--parallel <n>` - Number of parallel backtests (default: 4)
- `--sort-by <metric>` - Sort results by metric (sharpe, return, winRate)
- `--top <n>` - Show top N results (default: 10)

**Example:**
```bash
bot backtest-grid --grid configs/grids/orb-parameter-grid.json \
  --parallel 4 \
  --sort-by sharpe \
  --top 5
```

---

### `bot paper`

Start paper trading (alias for `bot start --paper`).

**Syntax:**
```bash
bot paper --config <path>
```

---

## Emergency Controls

### `bot emergency-stop-all`

Immediately stop all bots and close all positions.

**Syntax:**
```bash
bot emergency-stop-all [options]
```

**Options:**
- `--confirm` - Skip confirmation prompt

**Example:**
```bash
bot emergency-stop-all
```

**Output:**
```
⚠️  EMERGENCY STOP
This will immediately close all positions and stop all bots.
Are you sure? (yes/no): yes

Stopping all bots...
  ✅ bot-abc123 stopped
  ✅ bot-def456 stopped
  ✅ bot-ghi789 stopped

Closing all positions...
  ✅ Closed LONG 0.1 BTC @ 45,500
  ✅ Closed LONG 2 ETH @ 2,350

✅ Emergency stop complete
Bots stopped: 3
Positions closed: 2
```

---

### `bot reconcile`

Check accounting and detect discrepancies.

**Syntax:**
```bash
bot reconcile [options]
```

**Options:**
- `--fix` - Attempt to fix discrepancies
- `--bot-id <id>` - Check specific bot only

**Example:**
```bash
bot reconcile
```

**Output:**
```
Running reconciliation...

Checking bot-abc123 (ORB BTC Aggressive)...
  Exchange Balance:     $5,234.50 ✅
  Bot Virtual Equity:   $5,234.50 ✅
  Difference:           $0.00 ✅

  Exchange Positions:   LONG 0.1 BTC ✅
  Bot Tracked Positions: LONG 0.1 BTC ✅
  Match:                Yes ✅

Checking bot-def456 (ORB BTC Conservative)...
  Exchange Balance:     $4,889.20 ✅
  Bot Virtual Equity:   $4,889.20 ✅
  Difference:           $0.00 ✅

  Exchange Positions:   None ✅
  Bot Tracked Positions: None ✅
  Match:                Yes ✅

Summary:
  Total Bots Checked:   2
  Issues Found:         0
  Status:               ✅ All Clear
```

---

### `bot health`

Check bot health.

**Syntax:**
```bash
bot health [bot-id]
```

**Example:**
```bash
bot health bot-abc123
```

**Output:**
```
Health Check: bot-abc123

✅ Bot Status:        running
✅ Heartbeat:         5 seconds ago
✅ Exchange:          connected
✅ Error Rate:        0/hour (threshold: 10)
✅ Memory Usage:      245 MB (threshold: 500 MB)
✅ Daily Loss:        -2.1% (limit: -5.0%)

Status: ✅ HEALTHY
```

---

## Configuration

### Config File Format

```json
{
  "name": "ORB BTC Aggressive",
  "strategy": "orb-atr",
  "exchange": "bitunix",
  "symbol": "BTC-USD",
  "interval": "15m",
  "initialBalance": 5000,
  "riskManagement": {
    "maxDailyLossPct": 5,
    "maxPositionSizePct": 100,
    "riskPctPerTrade": 2
  },
  "params": {
    "openingRangeMinutes": 15,
    "atrLength": 14,
    "stopMode": "atr_multiple",
    "atrStopMultiple": 1.5,
    "tpRMultiple": 2.0
  }
}
```

---

## Environment Variables

```bash
# Exchange API keys
BITUNIX_API_KEY=your-api-key
BITUNIX_SECRET_KEY=your-secret-key

# Telegram bot
TELEGRAM_BOT_TOKEN=your-telegram-token
TELEGRAM_CHAT_ID=your-chat-id

# Google Sheets
GOOGLE_SHEETS_ID=your-sheet-id
GOOGLE_SERVICE_ACCOUNT_KEY=path/to/key.json

# Email alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

---

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - Configuration error
- `4` - Bot not found
- `5` - Exchange error
- `6` - Permission error

---

## References

- [New Architecture](./30-new-architecture.md)
- [Strategy Plugin Guide](./31-strategy-plugin-guide.md)
- [Monitoring Setup](./34-monitoring-setup.md)
- [Deployment Guide](./32-deployment-guide.md)
