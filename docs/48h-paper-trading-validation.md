# 48-Hour Paper Trading Validation Guide

## Overview

This document provides a comprehensive checklist for running and monitoring a 48-hour paper trading validation test for the DSTB trading bot.

## Prerequisites

✅ All integration tests passing (3/3)
✅ Monitoring systems configured (optional but recommended)
✅ Bot configuration file ready
✅ Understanding of paper trading mode

---

## Pre-Test Setup

### 1. Verify Bot Configuration

Check your config file (e.g., `configs/bot-live-eth-bitunix.json`):

```bash
# View current config
cat configs/bot-live-eth-bitunix.json
```

**Verify these settings:**
- [ ] `initialBalance` matches test capital (e.g., 10,000 USDT for paper mode)
- [ ] `symbol` is correct (e.g., "ETH-USD")
- [ ] `interval` matches strategy requirements
- [ ] Risk parameters are configured:
  - `riskPctPerTrade` (e.g., 1-3%)
  - `maxDailyLossPct` (e.g., 5%)
  - `maxPositionSizePct` (e.g., 100%)

### 2. Clean Environment

```bash
# Stop any running bots
npm run bot -- stop --all

# Check status
npm run bot -- status

# Clean old logs (optional)
# rm -rf logs/*
```

### 3. Test Paper Trading Connection

```bash
# Quick test run (5 iterations)
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper --max-iterations 5

# Check logs
npm run bot -- logs <bot-id>
```

**Verify:**
- [ ] Bot connects to exchange data feed
- [ ] Candles are fetched correctly
- [ ] No immediate errors

---

## Starting the 48-Hour Test

### Start Time Planning

**Choose a start time:**
- Ideally during active market hours (Asia/Europe/US overlap)
- Monday-Friday preferred (higher market activity)
- Ensure you'll be available to check every 6 hours initially

### Launch Command

```bash
# Start bot in paper mode as daemon
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper --daemon

# Note the bot ID from output
# Example: Bot started with ID: abc12345-6789-defg
```

**Record Start Details:**
```
Start Time: _______________
Bot ID: _______________
Strategy: _______________
Symbol: _______________
Interval: _______________
```

---

## Monitoring Schedule

### Every 6 Hours (First 24h)

**Check 1:** Hour 6
**Check 2:** Hour 12
**Check 3:** Hour 18
**Check 4:** Hour 24

### Every 12 Hours (Second 24h)

**Check 5:** Hour 36
**Check 6:** Hour 48

---

## Monitoring Checklist (Each Check)

### 1. Bot Status

```bash
# Check if bot is running
npm run bot -- status <bot-id>
```

**Verify:**
- [ ] Status is "running"
- [ ] Last heartbeat is recent (< 5 minutes ago)
- [ ] No error alerts

### 2. Recent Logs

```bash
# View last 50 lines
npm run bot -- logs <bot-id> --tail 50

# Filter errorsonly
npm run bot -- logs <bot-id> --level error
```

**Look for:**
- [ ] No CRITICAL or ERROR messages
- [ ] Regular candle processing
- [ ] Trade executions logging correctly
- [ ] Position sizing looks reasonable

### 3. Trade History

```bash
# View recent trades
npm run bot -- trades <bot-id> --limit 10
```

**Record:**
```
Total Trades: _______________
Win Rate: _______________
Largest Winner: _______________
Largest Loser: _______________
Average Trade: _______________
```

### 4. System Resources

```bash
# On Windows PowerShell
Get-Process node | Select Name,CPU,WorkingSet

# Check logs directory size
Get-ChildItem logs -Recurse | Measure-Object -Property Length -Sum
```

**Monitor:**
- [ ] CPU usage stable (< 50%)
- [ ] Memory usage stable (< 500MB)
- [ ]Log files not growing excessively (< 100MB total)

### 5. Database Check

```bash
# Check database size
ls -lh data/bot-state.db

# Quick SQLite query (optional)
sqlite3 data/bot-state.db "SELECT COUNT(*) FROM trades WHERE bot_id='<bot-id>';"
```

**Verify:**
- [ ] Database size reasonable (< 50MB)
- [ ] Trade count matches expectations

---

## Red Flags 🚨

**Stop the test immediately if:**

1. **Bot Stopped Unexpectedly**
   - Status shows "stopped" without manual intervention
   - Last heartbeat > 10 minutes ago

2. **Excessive Errors**
   - Multiple CRITICAL errors in logs
   - Repeated exchange connection failures
   - Database write errors

3. **Resource Issues**
   - Memory usage > 1GB
   - CPU usage > 80% sustained
   - Disk full warnings

4. **Position Sizing Problems**
   - Positions > 100% of balance
   - Notional > 10x balance (with leverage)
   - Negative balance reported

5. **Data Issues**
   - No candles received for > 1 hour
   - Timestamp is not advancing
   - Trades not being recorded

---

## Post-Test Analysis

### 1. Stop the Bot

```bash
# Graceful stop
npm run bot -- stop <bot-id>

# Verify stopped
npm run bot -- status <bot-id>
```

### 2. Collect Final Metrics

```bash
# All trades
npm run bot -- trades <bot-id> --all > test-results/48h-trades.txt

# Final log export
npm run bot -- logs <bot-id> --all > test-results/48h-logs.txt

# Database backup
cp data/bot-state.db test-results/48h-bot-state-backup.db
```

### 3. Calculate Performance

**Metrics to Review:**
```
Initial Balance: _______________
Final Balance: _______________
Total PnL: _______________
Total PnL %: _______________

Total Trades: _______________
Winning Trades: _______________
Losing Trades: _______________
Win Rate: _______________

Largest Winner: _______________
Largest Loser: _______________
Average Winner: _______________
Average Loser: _______________
Profit Factor: _______________

Max Drawdown: _______________
Sharpe Ratio: _______________ (if applicable)
```

### 4. Stability Analysis

**Review:**
- [ ] Bot ran for full 48 hours without crashes
- [ ] No manual interventions required
- [ ] Memory usage remained stable
- [ ] CPU usage remained stable
- [ ] All trades executed correctly
- [ ] No database corruption
- [ ] Logs rotated properly
- [ ] Monitoring alerts worked (if configured)

---

## Success Criteria

**The test PASSES if:**

✅ Bot ran for 48+ hours without stopping
✅ No CRITICAL errors in logs
✅ All trades executed and recorded correctly
✅ Position sizing within expected ranges
✅ Memory usage < 500MB throughout
✅ CPU usage < 50% average
✅ Database integrity maintained
✅ Monitoring worked as expected

**Minor Issues (Acceptable):**
- Occasional WARNING logs
- Brief exchange connectivity issues (< 5 min)
- Single transient errors that recovered

**Major Issues (Test FAILS):**
- Bot crashed or stopped unexpectedly
- Multiple CRITICAL errors
- Position sizing errors
- Memory leaks
- Data corruption
- Missing trades in database

---

## Common Issues & Solutions

### Issue: Bot stops after a few hours

**Possible Causes:**
- Exchange API rate limiting
- Network connectivity issues
- Memory leak

**Solutions:**
- Check exchange adapter logs
- Verify internet connection stability
- Monitor memory usage trend

### Issue: No trades being executed

**Possible Causes:**
- Strategy not generating signals
- Risk checks blocking all entries
- Exchange data not updating

**Solutions:**
- Review strategy logic
- Check risk parameters (too restrictive?)
- Verify candles are being received

### Issue: Memory usage growing

**Possible Causes:**
- Log buffering not flushing
- Candle data accumulating
- Unclosed connections

**Solutions:**
- Check log rotation settings
- Review candle caching logic
- Verify exchange connections close

---

## Next Steps After Successful Test

1. **Review Findings**
   - Document any issues encountered
   - Note improvements needed
   - Update configuration if needed

2. **Prepare for Live Trading**
   - Create production config (with real balance)
   - Set up monitoring alerts
   - Document deployment process
   - Create rollback plan

3. **Start Live (Cautiously)**
   - Use small capital initially
   - Monitor closely for first 24h
   - Gradually increase allocation
   - Keep detailed records

---

## Test Record Template

```markdown
# 48-Hour Paper Trading Test Record

## Test Details
- Start Date/Time: _______________
- End Date/Time: _______________
- Bot ID: _______________
- Config File: _______________
- Strategy: _______________

## Monitoring Checks
- [ ] Hour 6 - Status: _______________
- [ ] Hour 12 - Status: _______________
- [ ] Hour 18 - Status: _______________
- [ ] Hour 24 - Status: _______________
- [ ] Hour 36 - Status: _______________
- [ ] Hour 48 - Status: _______________

## Results
- Total Runtime: _______________
- Number of Trades: _______________
- Final PnL: _______________
- Issues Encountered: _______________

## Pass/Fail: _______________

## Notes:
_______________
_______________
_______________
```

---

## Support

If you encounter issues during the test:

1. Check logs for specific error messages
2. Review docs/monitoring-credentials-setup.md for monitoring setup
3. Check docs/32-deployment-guide.md for troubleshooting
4. Review CRITICAL_FIXES_APPLIED.md for known issues
