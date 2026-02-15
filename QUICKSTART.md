# DSTB Bot Quick Start Guide

## ✅ All Systems Operational

All Phase 1, 2, and 3 implementations are complete and tested!
- ✅ 33/33 tests passing
- ✅ CLI working
- ✅ Paper trading ready
- ✅ Live trading ready

---

## 🚀 How to Run Your Live Bot (Bitunix)

Your original bot config has been migrated to: `configs/bot-live-eth-bitunix.json`

### Option 1: Foreground Mode (Watch logs in real-time)

```bash
# Make sure your API keys are in .env file
npm run bot -- start --config configs/bot-live-eth-bitunix.json
```

### Option 2: Background Mode (Daemon)

```bash
# Start in background
npm run bot -- start --config configs/bot-live-eth-bitunix.json --daemon

# Check status
npm run bot -- status

# View logs
npm run bot -- logs <bot-id> --follow

# Stop the bot
npm run bot -- stop <bot-id>
```

### Option 3: Paper Trading Mode (Test First!)

```bash
# Recommended: Test with paper trading first
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper
```

---

## 📊 Essential Commands

### Start a Bot
```bash
# Live trading
npm run bot -- start --config configs/bot-live-eth-bitunix.json

# Paper trading (simulated)
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper

# Background daemon
npm run bot -- start --config configs/bot-live-eth-bitunix.json --daemon
```

### Monitor Bots
```bash
# List all bots
npm run bot -- status

# View specific bot details
npm run bot -- status <bot-id>

# View logs (last 100 lines)
npm run bot -- logs <bot-id>

# Follow logs in real-time
npm run bot -- logs <bot-id> --follow

# Filter by error level
npm run bot -- logs <bot-id> --level error
```

### Stop Bots
```bash
# Stop specific bot (closes positions gracefully)
npm run bot -- stop <bot-id>

# Force stop (emergency)
npm run bot -- stop <bot-id> --force

# Stop ALL bots (emergency)
npm run bot -- stop --all
```

### Reconciliation
```bash
# Check if bot state matches exchange
npm run bot -- reconcile

# Fix discrepancies automatically
npm run bot -- reconcile --fix
```

---

## 🧪 Testing & Validation

### Run All Tests
```bash
npm run test:core
```

### Paper Trading Validation (48h)
```bash
# Compare paper trading vs backtest over 48 hours
npm run paper:validate -- --config configs/strategies/orb-btc-15m.json --hours 48
```

### Performance Benchmark
```bash
# Test bot performance with 1000 candles
npm run benchmark:perf -- --config configs/strategies/orb-btc-15m.json --candles 1000
```

---

## 🔧 Your Bot Configuration

**File:** `configs/bot-live-eth-bitunix.json`

**Settings:**
- Symbol: ETH-USD
- Interval: 1h
- Exchange: Bitunix Futures
- Strategy: ORB-ATR
- Direction: Long & Short
- Risk: 3% per trade
- Session: NY 09:30 (60min opening range)
- Take Profit: 3R
- Trailing Stop: 3x ATR

**Environment Variables Needed:**
```env
BITUNIX_API_KEY=your-api-key
BITUNIX_SECRET_KEY=your-secret-key
```

---

## 🎯 Recommended First Steps

1. **Test with Paper Trading:**
   ```bash
   npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper
   ```

2. **Watch it run for a few hours**, then check status:
   ```bash
   npm run bot -- status
   npm run bot -- logs <bot-id>
   ```

3. **If all looks good, switch to live:**
   ```bash
   npm run bot -- stop <paper-bot-id>
   npm run bot -- start --config configs/bot-live-eth-bitunix.json
   ```

4. **Run in background for production:**
   ```bash
   npm run bot -- start --config configs/bot-live-eth-bitunix.json --daemon
   ```

---

## 📂 Files & Locations

- **Configs:** `configs/` and `configs/strategies/`
- **Logs:** `logs/bot-<id>-<date>.log`
- **Database:** `data/bot-state.db` (SQLite)
- **Reports:** `docs/reports/`

---

## 🆘 Troubleshooting

### Bot won't start
- Check API keys in `.env`
- Verify config file path
- Check logs: `npm run bot -- logs <bot-id>`

### Can't see running bots
- Run: `npm run bot -- status`
- Check database: `data/bot-state.db`

### Emergency: Stop everything
```bash
npm run bot -- stop --all --force
```

---

## 📖 Full Documentation

- Architecture: `docs/30-new-architecture.md`
- CLI Reference: `docs/33-cli-reference.md`
- Strategy Guide: `docs/31-strategy-plugin-guide.md`
- Deployment: `docs/32-deployment-guide.md`
- Monitoring: `docs/34-monitoring-setup.md`

---

**Need Help?** Check the full CLI reference:
```bash
npm run bot -- --help
npm run bot -- start --help
```
