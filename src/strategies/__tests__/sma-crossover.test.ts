import { describe, expect, it } from "vitest";

import { createStrategy } from "../factory";
import { SMAcrossoverStrategy } from "../sma-crossover";
import type { Candle, Position } from "../IStrategy";

/**
 * Builds a candle for testing.
 */
const buildCandle = (timestamp: number, close: number): Candle => {
  return {
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0
  };
};

describe("SMA crossover strategy", () => {
  it("emits a long entry on bullish crossover", () => {
    const strategy = new SMAcrossoverStrategy({ fastPeriod: 2, slowPeriod: 3 });
    // Need at least slowPeriod + 1 candles to detect crossover
    const history = [
      buildCandle(Date.parse("2024-01-01T00:00:00Z"), 10),
      buildCandle(Date.parse("2024-01-01T00:15:00Z"), 10),
      buildCandle(Date.parse("2024-01-01T00:30:00Z"), 10),
      buildCandle(Date.parse("2024-01-01T00:45:00Z"), 10)
    ];

    strategy.initialize(history);
    const signal = strategy.onCandle(buildCandle(Date.parse("2024-01-01T01:00:00Z"), 12), null);

    expect(signal.type).toBe("ENTRY");
    expect(signal.side).toBe("long");
  });

  it("emits an exit when crossover flips against position", () => {
    const strategy = new SMAcrossoverStrategy({ fastPeriod: 2, slowPeriod: 3 });
    const history = [
      buildCandle(Date.parse("2024-01-01T00:00:00Z"), 10),
      buildCandle(Date.parse("2024-01-01T00:15:00Z"), 12),
      buildCandle(Date.parse("2024-01-01T00:30:00Z"), 14)
    ];

    strategy.initialize(history);
    strategy.onCandle(buildCandle(Date.parse("2024-01-01T00:45:00Z"), 13), null);

    const position: Position = {
      id: "pos-1",
      side: "long",
      entryPrice: 13,
      quantity: 1,
      stopLoss: 12,
      takeProfit: 15,
      entryTime: Date.parse("2024-01-01T00:45:00Z")
    };

    const signal = strategy.onCandle(buildCandle(Date.parse("2024-01-01T01:00:00Z"), 9), position);
    expect(signal.type).toBe("EXIT");
  });
});

describe("Strategy factory", () => {
  it("creates strategies by name", () => {
    const strategy = createStrategy("sma-crossover", { fastPeriod: 2, slowPeriod: 3 });
    expect(strategy.name).toBe("SMA Crossover");
  });
});
