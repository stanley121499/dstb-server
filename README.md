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

- **[📖 New Architecture Overview](./docs/30-new-architecture.md)** - Start here to understand the simplified system
- **[🔌 Strategy Plugin Guide](./docs/31-strategy-plugin-guide.md)** - How to create and test strategies
- **[🚀 Deployment Guide](./docs/32-deployment-guide.md)** - Running on Windows/Linux/Cloud
- **[💻 CLI Reference](./docs/33-cli-reference.md)** - All available commands
- **[📊 Monitoring Setup](./docs/34-monitoring-setup.md)** - Telegram + Google Sheets
- **[🔄 Migration Plan](./docs/35-migration-plan.md)** - Migrating from old system
- **[🤖 AI Agent Implementation](./docs/36-ai-agent-implementation.md)** - Task breakdown for implementation

### Legacy Documentation

- [Original Architecture](./docs/11-architecture.md) - Old monorepo system (deprecated)
- [ORB Strategy Spec](./docs/12-strategy-orb-atr.md) - Still valid for strategy logic
- [Dev Standards](./docs/18-dev-standards.md) - Coding standards (still applies)

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Build the bot
npm run build

# Test with paper trading
bot start --config configs/strategies/orb-btc-15m.json --paper

# Monitor logs
bot logs --follow

# Check status
bot status

# Stop bot
bot stop
```

## 📁 New Project Structure

```
dstb-bot/
├── src/
│   ├── core/              # Bot engine
│   ├── strategies/        # Strategy plugins
│   ├── exchanges/         # Exchange adapters
│   ├── monitoring/        # Alerts & reporting
│   ├── cli/              # CLI commands
│   └── utils/            # Helpers
├── configs/
│   └── strategies/       # Strategy config files
├── data/
│   └── bot-state.db      # SQLite database
├── logs/                 # Daily log files
└── docs/                 # Documentation
```

## ⚠️ Important Changes

**This is a major refactor that simplifies the system:**

### Removed
- ❌ Frontend UI (`apps/web`) - Too complex to maintain
- ❌ Supabase database - Replaced with SQLite
- ❌ Complex API server - Now simple CLI
- ❌ WebSocket real-time updates - Not needed

### Added
- ✅ Strategy plugin system - Easy to add new strategies
- ✅ Google Sheets integration - Partner can monitor
- ✅ Telegram alerts - Instant error notifications
- ✅ Better error handling - Auto-recovery everywhere
- ✅ Multi-bot support - Run multiple strategies

## 🛡️ Why the Refactor?

**Problems with old system:**
1. Bot was fragile (crashed often)
2. Hard to add new strategies (code was hardcoded)
3. No instant error alerts (discovered issues 18 hours later)
4. Frontend was out of scope (no time to maintain)
5. Bitunix integration was unstable

**New system priorities:**
1. **Stability first** - Auto-restart, reconnection, error recovery
2. **Strategy flexibility** - Plugin system for easy testing
3. **Instant alerts** - Know within 1 minute if something breaks
4. **Simplicity** - 90% less code to maintain

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
- 🔴 Bot crashes
- 🔴 Position liquidations
- 🔴 Exchange disconnections
- 🟡 Unusual events
- ✅ Daily summaries

## 🎮 Usage Examples

### Running Multiple Bots

```bash
# Start aggressive ORB strategy
bot start --config configs/strategies/orb-btc-aggressive.json --daemon

# Start conservative ORB strategy
bot start --config configs/strategies/orb-btc-conservative.json --daemon

# List all running bots
bot list

# View specific bot logs
bot logs bot-abc123 --follow
```

### Backtesting

```bash
# Backtest a strategy
bot backtest --config configs/strategies/orb-btc-15m.json \
  --start 2024-01-01 \
  --end 2024-12-31

# Batch test multiple parameter combinations
bot backtest-grid --grid configs/grids/orb-parameter-grid.json
```

### Monitoring

```bash
# Check all bots status
bot status --all

# View today's trades
bot trades --today

# View positions
bot positions

# Emergency stop all bots
bot emergency-stop-all
```

## 🔧 Development

See [AI Agent Implementation Guide](./docs/36-ai-agent-implementation.md) for detailed task breakdown.

### Implementation Order
1. Core infrastructure (SQLite, logging, config)
2. Strategy plugin system
3. Exchange layer hardening
4. Simplified bot engine
5. Monitoring & alerts
6. CLI commands
7. Testing & validation

## ⚠️ Safety Disclaimer

**This software handles real money trading. Always:**
- Test with paper trading for 48+ hours
- Start with small capital ($50-100)
- Monitor closely for first month
- Never risk money you can't afford to lose
- Understand the risks of algorithmic trading

**This software is provided as-is with no guarantees. Use at your own risk.**

## 📝 License

[Add your license here]

## 🆘 Support

- Read documentation in `/docs` first
- Check [Migration Plan](./docs/35-migration-plan.md) for upgrading
- Review [Troubleshooting](./docs/32-deployment-guide.md#troubleshooting)
