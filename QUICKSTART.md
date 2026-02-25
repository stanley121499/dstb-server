# DSTB Bot Quick Start Guide

## 🚀 How to Run Your Live Bot (Bitunix)

Your example bot config is located at: `configs/bot.example.json`

### Option 1: Foreground Mode (Watch logs in real-time)

```bash
# 1. Install dependencies
npm install

# 2. Make sure your API keys are in the .env file
copy .env.example .env

# 3. Choose paper trading vs live trading
npm run bot -- start --config configs/bot.example.json --paper
```

### Option 2: Run a Backtest

```bash
npm run bot -- backtest --config configs/bot.example.json --start 2024-01-01 --end 2024-12-31
```

---

## 📊 Essential Commands

### Start a Bot
```bash
# Live trading
npm run bot -- start --config configs/bot-live-eth-bitunix.json

# Paper trading (simulated)
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper
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
# Check if bot local SQLite state matches Bitunix exchange
npm run bot -- reconcile

# Check specific bot id
npm run bot -- reconcile --bot-id <id>
```

---

## 🔧 Your Bot Configuration

**Example Config File:** `configs/bot.example.json`

**Environment Variables Needed:**
```env
BITUNIX_API_KEY=your-api-key
BITUNIX_SECRET_KEY=your-secret-key
```

---

## 🎯 Recommended First Steps

1. **Test with Paper Trading:**
   ```bash
   npm run bot -- start --config configs/bot.example.json --paper
   ```

2. **Watch it run for a few hours**, then check status:
   ```bash
   npm run bot -- status
   npm run bot -- logs <bot-id>
   ```

3. **If all looks good, switch to live!**

---

## 📖 Full Documentation

- **Architecture**: [`docs/architecture.md`](./docs/architecture.md)
- **CLI Reference**: [`docs/cli-reference.md`](./docs/cli-reference.md)
- **Strategy Guide**: [`docs/strategy-plugin-guide.md`](./docs/strategy-plugin-guide.md)
- **Deployment**: [`docs/deployment-guide.md`](./docs/deployment-guide.md)
- **Monitoring**: [`docs/monitoring-setup.md`](./docs/monitoring-setup.md)

---

**Need Help?** Check the full CLI reference directly:
```bash
npm run bot -- --help
npm run bot -- start --help
```
