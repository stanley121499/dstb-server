# Strategy Plugin Guide

**Status:** 🚧 In Implementation  
**Last Updated:** February 2026

## Overview

This guide explains how to create, test, and deploy trading strategy plugins for the DSTB bot.

## What is a Strategy Plugin?

A strategy plugin is a **self-contained TypeScript file** that implements the `IStrategy` interface. The bot calls your strategy on every candle to get trading signals.

**Think of it as:**
- Bot = The car (handles driving)
- Strategy = The navigator (decides where to go)
- Exchange = The road

## The IStrategy Interface

```typescript
export interface Candle {
  timestamp: number;      // Unix timestamp (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
  type: "ENTRY" | "EXIT" | "HOLD";
  side?: "long" | "short";         // Required if type === "ENTRY"
  price: number;                    // Current price (for logging)
  quantity?: number;                // Optional override (bot calculates if null)
  stopLoss?: number;                // Stop loss price
  takeProfit?: number;              // Take profit price (optional)
  reason: string;                   // Human-readable reason (for logs)
}

export interface Position {
  id: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit?: number;
  entryTime: number;
}

/**
 * Strategy interface - implement this to create a new strategy
 */
export interface IStrategy {
  /** Strategy name (for logs/monitoring) */
  name: string;
  
  /** Minimum candles needed before strategy can start trading */
  warmupPeriod: number;
  
  /**
   * Initialize strategy with historical candles
   * Called once when bot starts
   */
  initialize(candles: Candle[]): void;
  
  /**
   * Called on every new candle
   * Return a signal (ENTRY, EXIT, or HOLD)
   * 
   * @param candle - The current (latest) candle
   * @param position - Current open position (null if flat)
   */
  onCandle(candle: Candle, position: Position | null): Signal;
  
  /**
   * Called when an order fills
   * Allows strategy to update internal state
   * 
   * @param position - The newly created/updated position
   */
  onFill(position: Position): void;
  
  /**
   * Get current strategy state for logging/monitoring
   * This is saved in logs and shown in status commands
   */
  getState(): Record<string, unknown>;
}
```

## Creating Your First Strategy

### Example 1: Simple Moving Average Crossover

```typescript
// src/strategies/sma-crossover.ts

import type { IStrategy, Candle, Signal, Position } from "./IStrategy";

interface SMAConfig {
  fastPeriod: number;   // e.g., 10
  slowPeriod: number;   // e.g., 30
}

export class SMAcrossoverStrategy implements IStrategy {
  name = "SMA Crossover";
  warmupPeriod: number;
  
  private config: SMAConfig;
  private candles: Candle[] = [];
  
  constructor(config: SMAConfig) {
    this.config = config;
    this.warmupPeriod = Math.max(config.fastPeriod, config.slowPeriod);
  }
  
  initialize(candles: Candle[]): void {
    // Store recent candles for calculations
    this.candles = candles.slice(-this.warmupPeriod);
  }
  
  onCandle(candle: Candle, position: Position | null): Signal {
    // Add new candle
    this.candles.push(candle);
    if (this.candles.length > this.warmupPeriod) {
      this.candles.shift();
    }
    
    // Calculate SMAs
    const fastSMA = this.calculateSMA(this.config.fastPeriod);
    const slowSMA = this.calculateSMA(this.config.slowPeriod);
    const prevFastSMA = this.calculateSMA(this.config.fastPeriod, 1);
    const prevSlowSMA = this.calculateSMA(this.config.slowPeriod, 1);
    
    // No position - look for entry
    if (!position) {
      // Bullish crossover
      if (prevFastSMA <= prevSlowSMA && fastSMA > slowSMA) {
        return {
          type: "ENTRY",
          side: "long",
          price: candle.close,
          stopLoss: slowSMA * 0.98,  // 2% below slow SMA
          takeProfit: candle.close * 1.04,  // 4% profit target
          reason: `Bullish crossover (Fast ${fastSMA.toFixed(2)} > Slow ${slowSMA.toFixed(2)})`
        };
      }
      
      // Bearish crossover
      if (prevFastSMA >= prevSlowSMA && fastSMA < slowSMA) {
        return {
          type: "ENTRY",
          side: "short",
          price: candle.close,
          stopLoss: slowSMA * 1.02,  // 2% above slow SMA
          takeProfit: candle.close * 0.96,  // 4% profit target
          reason: `Bearish crossover (Fast ${fastSMA.toFixed(2)} < Slow ${slowSMA.toFixed(2)})`
        };
      }
      
      return {
        type: "HOLD",
        price: candle.close,
        reason: "Waiting for crossover"
      };
    }
    
    // Have position - check for exit
    if (position.side === "long" && fastSMA < slowSMA) {
      return {
        type: "EXIT",
        price: candle.close,
        reason: "Bearish crossover (exit long)"
      };
    }
    
    if (position.side === "short" && fastSMA > slowSMA) {
      return {
        type: "EXIT",
        price: candle.close,
        reason: "Bullish crossover (exit short)"
      };
    }
    
    return {
      type: "HOLD",
      price: candle.close,
      reason: "In position, no exit signal"
    };
  }
  
  onFill(position: Position): void {
    // Strategy doesn't need to do anything on fill
    // but you could update internal state here if needed
  }
  
  getState(): Record<string, unknown> {
    const fastSMA = this.calculateSMA(this.config.fastPeriod);
    const slowSMA = this.calculateSMA(this.config.slowPeriod);
    
    return {
      fastSMA: fastSMA,
      slowSMA: slowSMA,
      trend: fastSMA > slowSMA ? "bullish" : "bearish",
      candlesLoaded: this.candles.length
    };
  }
  
  private calculateSMA(period: number, offset: number = 0): number {
    const end = this.candles.length - offset;
    const start = end - period;
    const slice = this.candles.slice(start, end);
    const sum = slice.reduce((acc, c) => acc + c.close, 0);
    return sum / period;
  }
}
```

### Example 2: CME Weekend Gap Strategy

```typescript
// src/strategies/cme-gap.ts

import type { IStrategy, Candle, Signal, Position } from "./IStrategy";
import { DateTime } from "luxon";

interface CMEGapConfig {
  minGapPercent: number;      // e.g., 2 (minimum 2% gap to trade)
  targetFillPercent: number;  // e.g., 80 (target 80% gap fill)
  timezone: string;           // "America/Chicago" for CME
}

export class CMEGapStrategy implements IStrategy {
  name = "CME Weekend Gap";
  warmupPeriod = 10;  // Need some historical candles
  
  private config: CMEGapConfig;
  private fridayClose: number | null = null;
  private mondayOpen: number | null = null;
  private gapPercent: number | null = null;
  private gapDirection: "up" | "down" | null = null;
  private targetPrice: number | null = null;
  
  constructor(config: CMEGapConfig) {
    this.config = config;
  }
  
  initialize(candles: Candle[]): void {
    // Look for last Friday close in historical data
    for (let i = candles.length - 1; i >= 0; i--) {
      const dt = this.toLocalTime(candles[i].timestamp);
      if (dt.weekday === 5 && dt.hour === 17) {  // Friday 5 PM
        this.fridayClose = candles[i].close;
        break;
      }
    }
  }
  
  onCandle(candle: Candle, position: Position | null): Signal {
    const dt = this.toLocalTime(candle.timestamp);
    
    // Step 1: Capture Friday close (5 PM CME time)
    if (dt.weekday === 5 && dt.hour === 17) {
      this.fridayClose = candle.close;
      return {
        type: "HOLD",
        price: candle.close,
        reason: `📅 Friday close captured: ${candle.close.toFixed(2)}`
      };
    }
    
    // Step 2: Capture Monday open (5 PM Sunday = CME open)
    if (dt.weekday === 7 && dt.hour === 17 && this.fridayClose) {
      this.mondayOpen = candle.close;
      this.gapPercent = ((this.mondayOpen - this.fridayClose) / this.fridayClose) * 100;
      this.gapDirection = this.gapPercent > 0 ? "up" : "down";
      
      // Calculate target (expect gap to fill partially)
      const fillPercent = this.config.targetFillPercent / 100;
      this.targetPrice = this.mondayOpen - (this.mondayOpen - this.fridayClose) * fillPercent;
      
      return {
        type: "HOLD",
        price: candle.close,
        reason: `📊 Gap detected: ${this.gapPercent.toFixed(2)}% (${this.gapDirection})`
      };
    }
    
    // Step 3: Check if gap is big enough to trade
    if (this.gapPercent !== null && Math.abs(this.gapPercent) < this.config.minGapPercent) {
      return {
        type: "HOLD",
        price: candle.close,
        reason: `Gap too small (${Math.abs(this.gapPercent).toFixed(2)}% < ${this.config.minGapPercent}%)`
      };
    }
    
    // Step 4: Enter position (fade the gap)
    if (!position && this.mondayOpen && this.targetPrice && this.gapPercent !== null) {
      // Only trade within first 24 hours of CME open
      const hoursSinceOpen = (candle.timestamp - this.toTimestamp(dt.set({ hour: 17, minute: 0 }))) / (1000 * 60 * 60);
      
      if (hoursSinceOpen > 24) {
        // Reset for next weekend
        this.resetState();
        return {
          type: "HOLD",
          price: candle.close,
          reason: "Gap trade window closed (>24h)"
        };
      }
      
      // Gap up → go short (expect fill down)
      if (this.gapDirection === "up") {
        return {
          type: "ENTRY",
          side: "short",
          price: candle.close,
          stopLoss: this.mondayOpen * 1.02,  // Stop 2% above Monday open
          takeProfit: this.targetPrice,
          reason: `Gap up ${this.gapPercent.toFixed(2)}%, shorting to ${this.targetPrice?.toFixed(2)}`
        };
      }
      
      // Gap down → go long (expect fill up)
      if (this.gapDirection === "down") {
        return {
          type: "ENTRY",
          side: "long",
          price: candle.close,
          stopLoss: this.mondayOpen * 0.98,  // Stop 2% below Monday open
          takeProfit: this.targetPrice,
          reason: `Gap down ${this.gapPercent.toFixed(2)}%, longing to ${this.targetPrice?.toFixed(2)}`
        };
      }
    }
    
    // Step 5: Manage position
    if (position) {
      // Take profit hit (bot handles this automatically via exchange)
      // or stop loss hit (bot handles this too)
      // We just need to exit if Friday comes (end of week)
      if (dt.weekday === 5) {
        return {
          type: "EXIT",
          price: candle.close,
          reason: "End of week, exiting position"
        };
      }
    }
    
    return {
      type: "HOLD",
      price: candle.close,
      reason: position ? "Holding position" : "Waiting for gap setup"
    };
  }
  
  onFill(position: Position): void {
    // Position entered, reset state for next gap
    this.resetState();
  }
  
  getState(): Record<string, unknown> {
    return {
      fridayClose: this.fridayClose,
      mondayOpen: this.mondayOpen,
      gapPercent: this.gapPercent,
      gapDirection: this.gapDirection,
      targetPrice: this.targetPrice
    };
  }
  
  private toLocalTime(timestampMs: number): DateTime {
    return DateTime.fromMillis(timestampMs, { zone: "utc" })
      .setZone(this.config.timezone);
  }
  
  private toTimestamp(dt: DateTime): number {
    return dt.toMillis();
  }
  
  private resetState(): void {
    this.fridayClose = null;
    this.mondayOpen = null;
    this.gapPercent = null;
    this.gapDirection = null;
    this.targetPrice = null;
  }
}
```

## Strategy Configuration Files

Each strategy needs a JSON config file:

```json
// configs/strategies/sma-crossover-btc.json
{
  "name": "SMA Crossover BTC 15m",
  "strategy": "sma-crossover",
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
    "fastPeriod": 10,
    "slowPeriod": 30
  }
}
```

```json
// configs/strategies/cme-gap-eth.json
{
  "name": "CME Gap ETH",
  "strategy": "cme-gap",
  "exchange": "bitunix",
  "symbol": "ETH-USD",
  "interval": "1h",
  "initialBalance": 5000,
  "riskManagement": {
    "maxDailyLossPct": 5,
    "maxPositionSizePct": 100,
    "riskPctPerTrade": 3
  },
  "params": {
    "minGapPercent": 2,
    "targetFillPercent": 80,
    "timezone": "America/Chicago"
  }
}
```

## Testing Your Strategy

### 1. Unit Tests

```typescript
// src/strategies/__tests__/sma-crossover.test.ts

import { SMAcrossoverStrategy } from "../sma-crossover";

describe("SMA Crossover Strategy", () => {
  it("should generate long signal on bullish crossover", () => {
    const strategy = new SMAcrossoverStrategy({
      fastPeriod: 3,
      slowPeriod: 5
    });
    
    // Create test candles
    const candles = [
      { timestamp: 1000, close: 100, ... },
      { timestamp: 2000, close: 101, ... },
      { timestamp: 3000, close: 102, ... },
      { timestamp: 4000, close: 103, ... },
      { timestamp: 5000, close: 105, ... },  // Fast SMA crosses above
    ];
    
    strategy.initialize(candles.slice(0, -1));
    const signal = strategy.onCandle(candles[4], null);
    
    expect(signal.type).toBe("ENTRY");
    expect(signal.side).toBe("long");
  });
});
```

### 2. Backtest

```bash
# Test strategy on historical data
bot backtest --config configs/strategies/sma-crossover-btc.json \
  --start 2024-01-01 \
  --end 2024-12-31

# Results:
# Total Return: +18.5%
# Sharpe Ratio: 1.45
# Max Drawdown: -12.3%
# Win Rate: 48%
# Total Trades: 87
```

### 3. Paper Trading

```bash
# Test with live data, simulated fills
bot start --config configs/strategies/sma-crossover-btc.json --paper

# Watch it run for 48+ hours
bot logs --follow
```

### 4. Compare with Backtest

```bash
# After 48h of paper trading
npm run paper:validate -- --config configs/strategies/sma-crossover-btc.json --hours 48

# Should be within ±5% if strategy is correct
```

## Strategy Best Practices

### 1. State Management

**DON'T** store state that can be recalculated:
```typescript
// ❌ Bad
private allHistoricalCandles: Candle[] = [];  // Memory leak!
```

**DO** store only what's needed:
```typescript
// ✅ Good
private recentCandles: Candle[] = [];
private maxCandles = 100;

onCandle(candle: Candle, position: Position | null): Signal {
  this.recentCandles.push(candle);
  if (this.recentCandles.length > this.maxCandles) {
    this.recentCandles.shift();
  }
  // ...
}
```

### 2. Validation

Always validate your calculations:

```typescript
onCandle(candle: Candle, position: Position | null): Signal {
  // Validate candle data
  if (!candle || candle.close <= 0 || !Number.isFinite(candle.close)) {
    return {
      type: "HOLD",
      price: 0,
      reason: "Invalid candle data"
    };
  }
  
  // Validate indicators
  const sma = this.calculateSMA();
  if (!Number.isFinite(sma) || sma <= 0) {
    return {
      type: "HOLD",
      price: candle.close,
      reason: "Invalid indicator calculation"
    };
  }
  
  // ... rest of logic
}
```

### 3. Clear Reasoning

Always provide clear reasons in signals:

```typescript
// ❌ Bad
return {
  type: "ENTRY",
  side: "long",
  price: candle.close,
  reason: "Signal"
};

// ✅ Good
return {
  type: "ENTRY",
  side: "long",
  price: candle.close,
  stopLoss: 44500,
  takeProfit: 46000,
  reason: `Fast SMA (${fastSMA.toFixed(2)}) crossed above Slow SMA (${slowSMA.toFixed(2)}), RSI ${rsi.toFixed(2)} oversold`
};
```

### 4. Warmup Period

Set warmup period correctly:

```typescript
// If you need 20 candles for ATR and 50 for SMA:
warmupPeriod = Math.max(20, 50);  // = 50

// If you need 200 candles for long-term analysis:
warmupPeriod = 200;

// Bot will fetch this many historical candles before starting
```

### 5. Performance

Keep `onCandle()` fast - it's called every candle:

```typescript
// ❌ Bad - expensive calculation every candle
onCandle(candle: Candle, position: Position | null): Signal {
  const last200SMA = this.calculateSMA(200);  // Recalculates from scratch
  const last100SMA = this.calculateSMA(100);
  const last50SMA = this.calculateSMA(50);
  // ...
}

// ✅ Good - incremental updates
private sma200: number = 0;
private sma100: number = 0;
private sma50: number = 0;

onCandle(candle: Candle, position: Position | null): Signal {
  // Update SMAs incrementally (much faster)
  this.sma200 = this.updateSMA(this.sma200, 200, candle.close);
  this.sma100 = this.updateSMA(this.sma100, 100, candle.close);
  this.sma50 = this.updateSMA(this.sma50, 50, candle.close);
  // ...
}
```

## Migrating ORB Strategy

The existing ORB-ATR strategy from `apps/api/src/strategy/orbAtrStrategy.ts` needs to be migrated to a plugin.

**Task:** Extract the existing logic into a class that implements `IStrategy`.

**Key changes:**
- Session management → Move to strategy state
- ATR calculation → Keep in strategy
- Signal generation → Already matches pattern
- Exit logic → Already matches pattern

**See implementation in:** Agent 2 task (AI Agent Implementation doc)

## Registering Strategies

The bot needs a strategy factory to load plugins:

```typescript
// src/strategies/factory.ts

import { SMAcrossoverStrategy } from "./sma-crossover";
import { CMEGapStrategy } from "./cme-gap";
import { ORBATRStrategy } from "./orb-atr";
import type { IStrategy } from "./IStrategy";

export function createStrategy(name: string, params: any): IStrategy {
  switch (name) {
    case "sma-crossover":
      return new SMAcrossoverStrategy(params);
    case "cme-gap":
      return new CMEGapStrategy(params);
    case "orb-atr":
      return new ORBATRStrategy(params);
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}
```

## Next Steps

1. Implement your strategy class
2. Create config file
3. Write unit tests
4. Run backtest
5. Paper trade for 48h
6. Compare results
7. Deploy to live (small size first)

## References

- [New Architecture](./30-new-architecture.md) - System overview
- [CLI Reference](./33-cli-reference.md) - Commands for testing
- [ORB Strategy Spec](./12-strategy-orb-atr.md) - Original ORB logic
- [AI Agent Implementation](./36-ai-agent-implementation.md) - Task breakdown
