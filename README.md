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

**All documentation is in [`/docs`](./docs/README.md)** (source of truth)

### Quick Links

- **[📖 Architecture Overview](./docs/architecture.md)** - Start here to understand the simplified system
- **[🔌 Strategy Plugin Guide](./docs/strategy-plugin-guide.md)** - How to create and test strategies
- **[🚀 Deployment Guide](./docs/deployment-guide.md)** - Running on Windows/Linux/Cloud
- **[💻 CLI Reference](./docs/cli-reference.md)** - All available commands
- **[📊 Monitoring Setup](./docs/monitoring-setup.md)** - Telegram + Google Sheets
- **[📈 Backtest Engine](./docs/backtest-engine.md)** - Understanding strategy backtesting

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Test with paper trading (simulated fills)
npm run bot -- start --config configs/bot.example.json --paper

# Check status of the running bot
npm run bot -- status

# Monitor logs
npm run bot -- logs <bot-id> --follow

# Stop bot
npm run bot -- stop <bot-id>
```

## 📁 Project Structure

```
dstb-bot/
├── src/
│   ├── core/              # Bot engine (TradingBot, StateManager)
│   ├── strategies/        # Strategy plugins (orb-atr, sma-crossover)
│   ├── exchange/          # Exchange adapters (bitunix, paper trading)
│   ├── monitoring/        # Alerts & reporting (Telegram, Sheets)
│   ├── backtest/          # Deterministic candle-based backtest engine
│   ├── cli/               # CLI commands
│   └── utils/             # Helpers
├── configs/               # Strategy JSON config files
├── data/
│   └── bot-state.db       # SQLite database
├── logs/                  # Log files
└── docs/                  # Original documentation mapping
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
  --output docs/reports/backtest-2024.json
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

- Read documentation in [`/docs`](./docs/README.md) first
- Review [Deployment Guide](./docs/deployment-guide.md)
