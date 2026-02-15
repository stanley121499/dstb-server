# Testing Plan for Critical Bug Fixes

## ⚠️ IMPORTANT: Read This Before Running

**Current Situation**:
- You have an open 0.09 ETH SHORT position on Bitunix
- Account balance: ~100 USDT
- Multiple bot instances were running (now stopped)

---

## 🧪 Test Plan Overview

We will test in **3 phases**:
1. **Paper Trading Test** (Safe, no real trades)
2. **Live Test with 1% Risk** (Minimal risk)
3. **Live Test with 3% Risk** (Full production)

---

## Phase 1: Paper Trading Test (SAFE)

### Purpose:
Verify all safety checks work without risking real money.

### Steps:

1. **Stop all running bots**:
```bash
npm run bot -- stop --all
```

2. **Start in paper mode**:
```bash
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper
```

3. **What to Look For in Logs**:

**✅ Good Signs**:
```
[INFO] Balance fetched for position sizing
  available: 95.32 USDT
  total: 100.15 USDT
  <-- Should match your real balance, not 10,000!

[INFO] Position size calculated
  quantity: 0.025 ETH
  positionNotional: 82.5 USDT
  notionalPctOfBalance: 82.37%
  <-- Should be less than 100% (or slightly over with leverage)
```

**❌ Bad Signs** (should NOT see these):
```
[ERROR] CRITICAL: Position size too large!
[WARN] Balance appears inflated
```

4. **Let it run for 2-4 hours** to see:
- Entry signals generated correctly
- Position sizing logs show reasonable numbers
- No critical errors

5. **Check Status**:
```bash
npm run bot -- status
```

6. **View Logs**:
```bash
npm run bot -- logs --follow
```

7. **Stop Paper Trading**:
```bash
npm run bot -- stop
```

---

## Phase 2: Live Test with 1% Risk (LOW RISK)

### Purpose:
Test with real money but minimal risk (~1 USDT per trade).

### Prerequisites:
- ✅ Paper trading test passed
- ✅ No critical errors in logs
- ✅ Position sizing logs look correct
- ✅ Only ONE bot instance running

### Config Changes:

Create a test config: `configs/bot-live-eth-test.json`
```json
{
  "name": "ETH Live Bot - Test 1%",
  "strategy": "orb-atr",
  "exchange": "bitunix",
  "symbol": "ETH-USD",
  "interval": "1h",
  "initialBalance": 100,
  "riskManagement": {
    "maxDailyLossPct": 5,
    "maxPositionSizePct": 100
  },
  "bitunix": {
    "apiKey": "${BITUNIX_API_KEY}",
    "secretKey": "${BITUNIX_SECRET_KEY}",
    "testMode": false,
    "marketType": "futures"
  },
  "params": {
    "version": "1.0",
    "session": {
      "timezone": "America/New_York",
      "startTime": "09:30",
      "openingRangeMinutes": 60
    },
    "entry": {
      "directionMode": "long_short",
      "entryMode": "close_confirm",
      "breakoutBufferBps": 5,
      "maxTradesPerSession": 1
    },
    "atr": {
      "atrLength": 20,
      "atrFilter": {
        "enabled": true,
        "minAtrBps": 30,
        "maxAtrBps": 300
      }
    },
    "risk": {
      "sizingMode": "fixed_risk_pct",
      "riskPctPerTrade": 1,
      "fixedNotional": 1000,
      "stopMode": "or_midpoint",
      "atrStopMultiple": 1.5,
      "takeProfitMode": "r_multiple",
      "tpRMultiple": 3,
      "trailingStopMode": "atr_trailing",
      "atrTrailMultiple": 3,
      "timeExitMode": "disabled",
      "barsAfterEntry": 0,
      "sessionEndTime": "15:00"
    },
    "execution": {
      "feeBps": 10,
      "slippageBps": 5
    }
  }
}
```

### Steps:

1. **Close your existing 0.09 ETH position** (manually in Bitunix UI or via flash close)

2. **Verify account state**:
- Check Bitunix UI: No open positions
- Check balance: ~100 USDT available

3. **Start live bot with 1% risk**:
```bash
npm run bot -- start --config configs/bot-live-eth-test.json
```

4. **Monitor First Entry Signal CLOSELY**:
```bash
# In a separate terminal, watch logs:
npm run bot -- logs --follow
```

**Look for**:
```
[INFO] Balance fetched for position sizing
  total: 100.15 USDT  <-- Should be ~100, not 10,000!

[INFO] Position size calculated
  quantity: 0.0083 ETH  <-- With 1% risk, should be ~0.008-0.01 ETH
  positionNotional: 27.4 USDT  <-- Should be ~1% of balance
  notionalPctOfBalance: 27.37%
```

5. **When Entry Signal Triggers**:
- Pause and check Bitunix UI immediately
- Verify position size matches logs
- Expected: ~0.008-0.01 ETH position (notional ~30-33 USDT with 20x leverage)

6. **If Position Size Looks Good**:
- Let the trade run to completion (SL or TP)
- Monitor for any close position errors

7. **If Position Size Looks Wrong**:
```bash
# Stop immediately:
npm run bot -- stop

# Close position manually in Bitunix UI
```

8. **After First Trade Completes**:
- Review all logs for errors
- Check final PnL makes sense
- Verify close order used correct quantity

---

## Phase 3: Live Test with 3% Risk (FULL PRODUCTION)

### Purpose:
Full production deployment with intended risk parameters.

### Prerequisites:
- ✅ Phase 2 passed successfully
- ✅ At least 1-2 trades completed without issues
- ✅ Close position logic worked correctly
- ✅ No oversized positions

### Steps:

1. **Stop 1% risk bot**:
```bash
npm run bot -- stop
```

2. **Update main config** (`configs/bot-live-eth-bitunix.json`):
```json
"risk": {
  "sizingMode": "fixed_risk_pct",
  "riskPctPerTrade": 3,  <-- Back to 3%
  ...
}
```

3. **Start production bot**:
```bash
npm run bot -- start --config configs/bot-live-eth-bitunix.json
```

4. **Monitor first 3 trades closely**:
- Expected position size: ~0.025 ETH per trade
- Expected notional: ~82 USDT (with 20x leverage)
- Expected risk: ~3 USDT per trade

5. **Set up monitoring** (if not already):
- Enable Telegram alerts (if configured)
- Check logs daily
- Review positions in Bitunix UI

---

## 🚨 Emergency Stop Procedures

### If You See Oversized Position:

1. **Stop bot immediately**:
```bash
npm run bot -- stop --force
```

2. **Close position in Bitunix UI**:
- Go to "Positions"
- Click "Close" → "Market Close"

3. **Check logs for error**:
```bash
npm run bot -- logs --tail 100
```

4. **Report issue with**:
- Log file name
- Bot ID
- Expected vs actual position size
- Balance used in calculation

---

## 📊 Success Criteria for Each Phase

### Phase 1 (Paper):
- [ ] No critical errors in 2-4 hours
- [ ] Balance logs show ~100 USDT (not 10,000)
- [ ] Position sizing logs show reasonable quantities
- [ ] Entry signals generated correctly

### Phase 2 (1% Risk):
- [ ] First trade entry: 0.008-0.01 ETH
- [ ] Position notional: 25-35 USDT
- [ ] Close order uses correct quantity
- [ ] No balance inflation warnings
- [ ] 1-2 trades complete without errors

### Phase 3 (3% Risk):
- [ ] First trade entry: 0.024-0.026 ETH
- [ ] Position notional: 78-86 USDT
- [ ] Multiple trades complete successfully
- [ ] Trailing stops work correctly
- [ ] No safety check violations

---

## 🔍 Log Monitoring Checklist

For every trade, verify these log entries:

### Before Entry:
```
✅ [INFO] Balance fetched for position sizing
   - total: ~100 USDT
   - available: ~95 USDT

✅ [INFO] Position size calculated
   - quantity: reasonable (0.008 ETH for 1%, 0.025 ETH for 3%)
   - notionalPctOfBalance: < 100%
   - riskAmount: matches risk % (1 USDT for 1%, 3 USDT for 3%)
```

### During Entry:
```
✅ [INFO] Placing entry market order
   - side: buy or sell
   - quantity: matches calculated

✅ [INFO] Position opened
   - confirms order filled
```

### On Close:
```
✅ [BitunixAdapter] Closing position: [side] [qty] @ [price]
✅ [BitunixAdapter] Flash close successful
   OR
✅ [INFO] Placed close order
```

---

## 📈 Expected Position Sizes by Risk Level

| Risk % | Account Balance | Risk Amount | Stop Distance | Position Size (ETH) | Notional (USDT @ 3300) |
|--------|----------------|-------------|---------------|-------------------|---------------------|
| 1%     | 100 USDT       | 1 USDT      | ~120 USDT     | ~0.0083           | ~27 USDT            |
| 2%     | 100 USDT       | 2 USDT      | ~120 USDT     | ~0.0167           | ~55 USDT            |
| 3%     | 100 USDT       | 3 USDT      | ~120 USDT     | ~0.0250           | ~82 USDT            |

*Stop distance varies based on ORB midpoint and ATR*

---

## ⚙️ Config Settings Explained

### Key Settings for Position Sizing:

```json
"initialBalance": 100,  // MUST match actual balance!
"riskManagement": {
  "maxDailyLossPct": 5,  // Stop trading if -5% today
  "maxPositionSizePct": 100  // Max 100% of balance per position
},
"risk": {
  "sizingMode": "fixed_risk_pct",  // Risk % per trade
  "riskPctPerTrade": 3,  // 3% of balance at risk per trade
}
```

### How It Calculates:
1. Fetch balance from Bitunix: 100 USDT
2. Calculate risk: 100 * 0.03 = 3 USDT
3. Calculate stop distance: |entry - stopLoss| = 120 USDT
4. Calculate quantity: 3 / 120 = 0.025 ETH
5. Calculate notional: 0.025 * 3300 = 82.5 USDT

---

## 🎯 Final Checklist Before Going Live

- [ ] All old bot instances stopped
- [ ] Config `initialBalance` updated to 100
- [ ] Existing 0.09 ETH position closed
- [ ] Paper trading test passed (Phase 1)
- [ ] Read and understand all log messages
- [ ] Know how to stop bot quickly (`npm run bot -- stop`)
- [ ] Bitunix UI open in browser for verification
- [ ] Terminal with `npm run bot -- logs --follow` running

---

## 📞 Questions to Ask Before Each Trade

1. **Does the balance log show ~100 USDT?**
   - If shows 10,000: STOP, something wrong

2. **Does the position size make sense?**
   - 1% risk: ~0.008 ETH
   - 3% risk: ~0.025 ETH
   - If 5+ ETH: STOP IMMEDIATELY

3. **Does notionalPctOfBalance look reasonable?**
   - Should be 25-90% depending on leverage
   - If >200%: STOP

4. **Did the close order work correctly?**
   - Should use exact position size from exchange
   - Should say "Flash close successful" or "close order placed"

---

**Good luck! The bot is now much safer with all these fixes. 🚀**
