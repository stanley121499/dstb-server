# Parameter Optimization - Industry Standard Ranges

## Overview

The optimization UI now includes **built-in guidance** for every parameter, showing you:
- ✅ What each parameter does
- ✅ Industry standard ranges
- ✅ Pre-filled suggested values
- ✅ What happens if values are too high or too low

## How It Works

When you select a parameter from the dropdown, the UI automatically displays:

```
💡 Opening Range Duration
Minutes after session start to define the range

Suggested: 15,30,60
Typical: 15-90 minutes. Lower = more trades, Higher = better breakout confirmation
```

No more guessing! Every parameter has context-specific help.

## Complete Parameter Reference

### Entry Parameters

#### Opening Range Duration (`session.openingRangeMinutes`)
- **What it is**: Minutes after session start to define the high/low range
- **Typical range**: 15-90 minutes
- **Suggested starting values**: `15,30,60`
- **Too low (< 15)**: Insufficient price action, noisy range
- **Sweet spot (15-60)**: Most strategies work well here
- **Too high (> 120)**: May miss early momentum

#### Breakout Buffer (`entry.breakoutBufferBps`)
- **What it is**: Additional buffer beyond range high/low (in basis points)
- **Typical range**: 0-20 bps
- **Suggested starting values**: `0,5,10,15`
- **Zero**: Pure breakout, more trades but more false signals
- **10-15 bps**: Reduces false breakouts, better confirmation
- **Too high (> 30)**: Miss too many valid breakouts

#### Max Trades Per Session (`entry.maxTradesPerSession`)
- **What it is**: Maximum number of trades allowed per session
- **Typical range**: 1-5 trades
- **Suggested starting values**: `1,2,3`
- **Lower (1-2)**: More selective, higher quality setups
- **Higher (3-5)**: More opportunities but potentially lower quality

### Risk Management Parameters

#### ATR Period (`atr.atrLength`)
- **What it is**: Number of bars used to calculate Average True Range
- **Typical range**: 10-20 bars
- **Suggested starting values**: `10,14,20`
- **Industry standard**: **14 bars** (most widely used)
- **Lower (< 10)**: More reactive to recent volatility
- **Higher (> 20)**: Smoother but lags market changes

#### Risk Per Trade (`risk.riskPctPerTrade`)
- **What it is**: Percentage of equity risked per trade
- **Typical range**: 0.5-3%
- **Suggested starting values**: `1,2,3`
- **Conservative (0.5-1%)**: Slow growth, high survival
- **Professional (1-2%)**: Industry standard
- **Aggressive (2-3%)**: Higher returns, more volatility
- **⚠️ Dangerous (> 5%)**: High risk of ruin

#### Stop Loss (`risk.atrStopMultiple`)
- **What it is**: Stop loss distance as multiple of ATR
- **Typical range**: 1.5-3.0x ATR
- **Suggested starting values**: `1.5,2.0,2.5`
- **Too tight (< 1.0x)**: Stopped out by normal volatility
- **Sweet spot (1.5-2.5x)**: Balances protection with breathing room
- **Too loose (> 4.0x)**: Risk too much per trade

#### Take Profit (`risk.tpRMultiple`)
- **What it is**: Take profit target as multiple of initial risk (R)
- **Typical range**: 2-5R
- **Suggested starting values**: `2,3,4`
- **Conservative (2R)**: 1:2 risk-reward, easier to hit
- **Balanced (3R)**: 1:3 risk-reward, standard for breakouts
- **Aggressive (4R+)**: Higher targets, lower hit rate
- **Too high (> 6R)**: Rarely achieved, reduces win rate

#### Trailing Stop (`risk.atrTrailMultiple`)
- **What it is**: Trailing stop distance as multiple of ATR
- **Typical range**: 2-4x ATR
- **Suggested starting values**: `2.0,2.5,3.0`
- **Must be**: >= stop loss multiple
- **Tighter (2x)**: Locks in profits quickly but may exit early
- **Wider (3-4x)**: Gives winning trades more room to run

### Execution Parameters

#### Trading Fees (`execution.feeBps`)
- **What it is**: Transaction fee per trade in basis points
- **Typical range**: 5-50 bps
- **Suggested starting values**: `5,10,15`
- **Binance**: ~10 bps with BNB discount
- **Coinbase**: ~50 bps
- **Use realistic values**: Don't optimize, use actual costs

#### Slippage (`execution.slippageBps`)
- **What it is**: Expected price slippage per trade
- **Typical range**: 5-30 bps
- **Suggested starting values**: `5,10,20`
- **Liquid markets (BTC 5m)**: 5-10 bps
- **Less liquid (ETH 1m)**: 10-30 bps
- **Use realistic values**: Don't optimize, estimate actual market impact

## Auto-Fill Feature

The UI is smart! When you:
1. Select a parameter from the dropdown
2. The **Values** field automatically fills with suggested starting values
3. You see a helpful explanation below

**Example:**
```
You select: session.openingRangeMinutes
Auto-filled values: 15,30,60
Guidance shown: "Typical: 15-90 minutes. Lower = more trades..."
```

## Optimization Strategy Guide

### Strategy 1: Conservative (Capital Preservation)
```
session.openingRangeMinutes: 60
entry.breakoutBufferBps: 10
risk.riskPctPerTrade: 1
risk.atrStopMultiple: 2.0
risk.tpRMultiple: 3
```
**Result**: Fewer, higher-quality trades. Lower risk.

### Strategy 2: Balanced (Most Recommended)
```
session.openingRangeMinutes: 30
entry.breakoutBufferBps: 5
risk.riskPctPerTrade: 2
risk.atrStopMultiple: 1.5
risk.tpRMultiple: 2.5
```
**Result**: Good balance of frequency and quality.

### Strategy 3: Aggressive (Higher Frequency)
```
session.openingRangeMinutes: 15
entry.breakoutBufferBps: 0
risk.riskPctPerTrade: 2.5
risk.atrStopMultiple: 1.5
risk.tpRMultiple: 2
```
**Result**: More trades, faster exits, higher activity.

## Common Questions

### Q: How do I know if my values are too extreme?
**A**: The UI shows you! Every parameter displays:
- "Typical: X-Y" - Stay within this range
- Descriptions of what happens if too high/low

### Q: Should I test the extremes?
**A**: No! Testing values like:
- `risk.riskPctPerTrade: 10` (way too high)
- `session.openingRangeMinutes: 300` (5 hours - too long)
- `risk.atrStopMultiple: 0.5` (too tight)

These will likely fail and waste computation time.

### Q: Can I use values outside the suggested range?
**A**: Yes, but understand the implications:
- Slightly outside (e.g., 12 min opening range) - OK
- Way outside (e.g., 180 min opening range) - Probably not useful
- The guidance is based on years of trading research

### Q: What if I want to test unusual values?
**A**: Do it! But:
1. Test proven ranges first
2. Validate results on different time periods
3. Understand why unusual values would work
4. Be skeptical of extreme outliers

## Optimization Workflow with Guidance

### Step 1: Choose Your First Parameter
- Click "Add Override"
- Select from dropdown: `session.openingRangeMinutes`
- **UI auto-fills**: `15,30,60`
- **UI shows**: "Typical: 15-90 minutes..."
- ✅ Leave suggested values or adjust

### Step 2: Add More Parameters
- Click "Add Override" again
- Select: `risk.atrStopMultiple`
- **UI auto-fills**: `1.5,2.0,2.5`
- **UI shows**: "Typical: 1.5-3.0x ATR..."
- ✅ Values look good!

### Step 3: Review Calculation
```
Symbols: BTC-USD (1)
Intervals: 5m, 15m, 1h (3)
Parameters:
  - openingRangeMinutes: 3 values
  - atrStopMultiple: 3 values

Total: 1 × 3 × (3 × 3) = 27 tests
```

### Step 4: Run Optimization
- Click "Run 27 Tests"
- Results appear in Compare page
- See which combination performs best!

## Best Practices

### ✅ DO:
- Use suggested starting values
- Read the guidance for each parameter
- Test within typical ranges first
- Validate results on different periods
- Start with 1-2 parameters

### ❌ DON'T:
- Test random extreme values
- Optimize too many parameters at once (> 3)
- Ignore the guidance warnings
- Over-optimize on a single time period
- Test unrealistic fee/slippage values

## Visual Example

When you add an override for opening range, you'll see:

```
┌─────────────────────────────────────────────────────────────┐
│ Parameter Override 1                                         │
├─────────────────────────────────────────────────────────────┤
│ Parameter Path: session.openingRangeMinutes                │
│ Values: 15,30,60                                            │
│                                                              │
│ 💡 Opening Range Duration                                   │
│ Minutes after session start to define the range            │
│                                                              │
│ Suggested: 15,30,60                                         │
│ Typical: 15-90 minutes. Lower = more trades,               │
│ Higher = better breakout confirmation                       │
└─────────────────────────────────────────────────────────────┘
```

No more guessing what values to use!

## Summary

With these enhancements:
1. **You're never lost** - Every parameter has clear guidance
2. **Smart defaults** - Suggested values pre-filled automatically
3. **Industry standard** - Based on proven trading practices
4. **Educational** - Learn what each parameter does as you go
5. **Safe experimentation** - Know the boundaries before you test

Happy optimizing! 🎯



