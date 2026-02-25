# Strategy Plugin Guide

**Last Updated:** February 2026

---

## Overview

A strategy plugin is a self-contained TypeScript file that implements the `IStrategy` interface. The bot's core engine (`TradingBot.ts`) calls your strategy on every new historical or live candle to generate trading signals (ENTRY, EXIT, HOLD).

## The `IStrategy` Interface

All strategies must implement the `IStrategy` interface defined in `src/strategies/IStrategy.ts`:

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

export interface IStrategy {
  /** Strategy name (for logs and monitoring) */
  readonly name: string;
  
  /** Minimum historical candles needed before strategy can start trading */
  readonly warmupPeriod: number;
  
  /**
   * Initialize strategy with historical candles
   * Called once when bot starts
   */
  initialize(candles: readonly Candle[]): void;
  
  /**
   * Called on every new candle
   * Return a signal (ENTRY, EXIT, or HOLD)
   * 
   * @param candle - The current (latest) candle
   * @param position - Current open position tied to this bot (null if flat)
   */
  onCandle(candle: Candle, position: Position | null): Signal;
  
  /**
   * Called when an order fills
   * Allows strategy to update internal state
   */
  onFill(position: Position): void;
  
  /**
   * Get current strategy state for logging/monitoring
   */
  getState(): Record<string, unknown>;
}
```

---

## Creating Your First Strategy

### Example: Simple Moving Average (SMA) Crossover

To create a strategy, add a class in `src/strategies/`. Here is a basic SMA Crossover example:

```typescript
// src/strategies/sma-crossover.ts

import type { IStrategy, Candle, Signal, Position } from "./IStrategy";

interface SMAConfig {
  fastPeriod: number;
  slowPeriod: number;
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
  
  initialize(candles: readonly Candle[]): void {
    // Store only the recent candles needed for calculations
    this.candles = [...candles].slice(-this.warmupPeriod);
  }
  
  onCandle(candle: Candle, position: Position | null): Signal {
    // Maintain rolling window
    this.candles.push(candle);
    if (this.candles.length > this.warmupPeriod) {
      this.candles.shift();
    }
    
    if (this.candles.length < this.warmupPeriod) {
      return { type: "HOLD", price: candle.close, reason: "Warming up" };
    }

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
          stopLoss: slowSMA * 0.98,
          takeProfit: candle.close * 1.04,
          reason: `Bullish crossover (Fast ${fastSMA.toFixed(2)} > Slow ${slowSMA.toFixed(2)})`
        };
      }
      
      // Bearish crossover
      if (prevFastSMA >= prevSlowSMA && fastSMA < slowSMA) {
        return {
          type: "ENTRY",
          side: "short",
          price: candle.close,
          stopLoss: slowSMA * 1.02,
          takeProfit: candle.close * 0.96,
          reason: `Bearish crossover (Fast ${fastSMA.toFixed(2)} < Slow ${slowSMA.toFixed(2)})`
        };
      }
      
      return { type: "HOLD", price: candle.close, reason: "Waiting for crossover" };
    }
    
    // Have position - check for exit
    if (position.side === "long" && fastSMA < slowSMA) {
      return { type: "EXIT", price: candle.close, reason: "Bearish crossover (exit)" };
    }
    
    if (position.side === "short" && fastSMA > slowSMA) {
      return { type: "EXIT", price: candle.close, reason: "Bullish crossover (exit)" };
    }
    
    return { type: "HOLD", price: candle.close, reason: "In position, holding" };
  }
  
  onFill(position: Position): void {
    // Fired after the exchange confirms the order
  }
  
  getState(): Record<string, unknown> {
    return {
      trend: this.calculateSMA(this.config.fastPeriod) > this.calculateSMA(this.config.slowPeriod) ? "bullish" : "bearish",
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

---

## Registering Your Strategy

The bot dynamically loads strategies via the factory. Add your strategy to `src/strategies/factory.ts`:

```typescript
// src/strategies/factory.ts

import { SMAcrossoverStrategy } from "./sma-crossover.js";
import { ORBATRStrategy } from "./orb-atr.js";
import type { IStrategy } from "./IStrategy.js";

export function createStrategy(name: string, params: any): IStrategy {
  switch (name) {
    case "sma-crossover":
      return new SMAcrossoverStrategy(params);
    case "orb-atr":
      return new ORBATRStrategy(params);
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}
```

---

## Strategy Configuration JSON

Once your strategy is registered, users can invoke it by specifying its name and parameters in a JSON configuration file inside the `configs/` directory.

```json
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

---

## Strategy Best Practices

### 1. State Management
**DON'T** store endless historical arrays if they can be recalculated or trimmed. This creates memory leaks.  
**DO** store only a rolling window matching your `warmupPeriod` length.

### 2. Validation
Always protect against bad exchange data:
```typescript
if (!candle || !Number.isFinite(candle.close) || candle.close <= 0) {
  return { type: "HOLD", price: candle.close, reason: "Invalid candle data" };
}
```

### 3. Clear Reasoning
Always provide verbose diagnostic strings in the `reason` field of your Signal. The bot logger prints this natively so you can debug why the strategy took a trade.

### 4. Performance
Keep `onCandle()` computation extremely fast. It executes sequentially on historical data in backtests and blocking during live trading. Instead of recalculating indicators over a 200-candle span every iteration, try maintaining an incremental SMA or EMA state.

### 5. Independent Positions
Your strategy receives the `position` representing the exact trade made by *this specific bot*. You don't have to parse multi-bot capital allocation—that is handled strictly by the `TradingBot` and `RiskManager` layers before orders enter the exchange. 

## Testing Strategies

1. **Unit Testing:** Write small jest/vitest files explicitly mocking indicator states.
2. **Deterministic Backtest Engine:** Run your strategy against real historical Yahoo Finance data using `bot backtest --config configs/your-strategy.json`.
3. **Paper Trading:** Launch the simulated exchange loop for live data via `bot start --config configs/your-strategy.json --paper`.
4. **Live Validation:** Reconcile your 48h paper-trading logs mathematically before deploying capital.
