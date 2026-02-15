# Quick Start After Critical Fixes

## 🚨 What Was Wrong

Your bot opened **100x larger positions** than intended because it used the config's `initialBalance` (10,000 USDT) instead of your actual balance (~100 USDT).

**Result**: 5.16 ETH and 5.34 ETH positions instead of ~0.025 ETH.

---

## ✅ What's Fixed

1. **Position sizing now uses real exchange balance**
2. **Safety checks reject positions > 10x balance**
3. **Close positions use exact exchange position size**
4. **Comprehensive logging for debugging**
5. **Config updated to match real balance (100 USDT)**

---

## 🏃 Quick Start (5 Steps)

### 1. Close Your Existing Position
Log into Bitunix → Positions → Close the 0.09 ETH SHORT

### 2. Stop All Running Bots
```bash
npm run bot -- status --all
npm run bot -- stop --all
```

### 3. Test in Paper Mode (SAFE)
```bash
npm run bot -- start --config configs/bot-live-eth-bitunix.json --paper
```

Wait 5 minutes, then check logs:
```bash
npm run bot -- logs --tail 50
```

Look for:
```
[INFO] Balance fetched: total=100.15 USDT ✅
[INFO] Position size: qty=0.025 ETH, notional=82.5 USDT ✅
```

If you see `total=10000`, STOP and report issue.

### 4. Stop Paper Mode
```bash
npm run bot -- stop
```

### 5. Run Live (When Ready)
```bash
npm run bot -- start --config configs/bot-live-eth-bitunix.json
```

**Monitor first trade**:
```bash
npm run bot -- logs --follow
```

---

## 🔍 What to Watch For

### ✅ Good Signs:
- `Balance fetched: total=100` (matches your account)
- `Position size: qty=0.025 ETH` (reasonable for 3% risk)
- `notionalPctOfBalance: 82%` (less than 100%)

### ❌ Bad Signs (Stop immediately):
- `Balance fetched: total=10000` (using config, not real balance)
- `Position size: qty=5 ETH` (way too large)
- `[ERROR] CRITICAL: Position size too large!`

---

## 🛑 Emergency Stop

```bash
npm run bot -- stop --force
```

Then close position manually in Bitunix UI.

---

## 📊 Expected Trade Size

| Risk | Balance | Position Size | Notional |
|------|---------|---------------|----------|
| 1%   | 100 USDT | ~0.008 ETH   | ~27 USDT |
| 3%   | 100 USDT | ~0.025 ETH   | ~82 USDT |

---

## 📞 Need Help?

1. Check logs: `npm run bot -- logs --tail 100`
2. Check status: `npm run bot -- status`
3. Review `CRITICAL_FIXES_APPLIED.md` for full details
4. Review `TESTING_PLAN.md` for comprehensive testing

---

**All fixes are active now. Test in paper mode first! 🚀**
