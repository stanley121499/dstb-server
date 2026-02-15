import { describe, expect, it } from "vitest";

import { ORBATRStrategy, OrbAtrInternals } from "../orb-atr";
import { ATRCalculator } from "../helpers/ATRCalculator";
import { SessionManager } from "../helpers/SessionManager";
import type { Candle, Position } from "../IStrategy";

/**
 * Builds a candle for testing.
 */
const buildCandle = (
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number
): Candle => {
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: 0
  };
};

/**
 * Builds a base ORB parameter payload.
 */
const buildOrbParams = (): Record<string, unknown> => {
  return {
    version: "1.0",
    intervalMinutes: 15,
    session: {
      timezone: "America/New_York",
      startTime: "09:30",
      openingRangeMinutes: 30
    },
    entry: {
      directionMode: "long_short",
      entryMode: "stop_breakout",
      breakoutBufferBps: 0,
      maxTradesPerSession: 1
    },
    atr: {
      atrLength: 2,
      atrFilter: {
        enabled: false,
        minAtrBps: 0,
        maxAtrBps: 1000
      }
    },
    risk: {
      sizingMode: "fixed_risk_pct",
      riskPctPerTrade: 1,
      fixedNotional: 0,
      stopMode: "or_opposite",
      atrStopMultiple: 1.5,
      takeProfitMode: "r_multiple",
      tpRMultiple: 2,
      trailingStopMode: "disabled",
      atrTrailMultiple: 1.5,
      timeExitMode: "disabled",
      barsAfterEntry: 0,
      sessionEndTime: "16:00"
    },
    execution: {
      feeBps: 10,
      slippageBps: 10
    }
  };
};

describe("ORB ATR helpers", () => {
  it("calculates ATR using Wilder smoothing", () => {
    const calculator = new ATRCalculator(3);
    const candles = [
      buildCandle(Date.parse("2024-01-01T00:00:00Z"), 10, 12, 9, 11),
      buildCandle(Date.parse("2024-01-01T00:15:00Z"), 11, 13, 10, 12),
      buildCandle(Date.parse("2024-01-01T00:30:00Z"), 12, 14, 11, 13),
      buildCandle(Date.parse("2024-01-01T00:45:00Z"), 13, 15, 12, 14),
      buildCandle(Date.parse("2024-01-01T01:00:00Z"), 14, 16, 13, 15)
    ];

    let atr: number | null = null;
    for (const candle of candles) {
      atr = calculator.update(candle);
    }

    expect(atr).not.toBeNull();
    expect(atr ?? 0).toBeCloseTo(3, 6);
  });

  it("handles DST session dates correctly", () => {
    const beforeOpen = Date.parse("2024-03-10T13:29:00Z");
    const afterOpen = Date.parse("2024-03-10T13:31:00Z");

    const beforeSession = OrbAtrInternals.sessionDateForUtc(beforeOpen, "America/New_York", "09:30");
    const afterSession = OrbAtrInternals.sessionDateForUtc(afterOpen, "America/New_York", "09:30");

    expect(beforeSession).toBe("2024-03-09");
    expect(afterSession).toBe("2024-03-10");
  });

  it("computes opening range levels from the session window", () => {
    const manager = new SessionManager({
      timezone: "America/New_York",
      startTime: "09:30",
      openingRangeMinutes: 30,
      intervalMinutes: 15
    });

    const candle930 = buildCandle(Date.parse("2024-01-02T14:30:00Z"), 100, 104, 99, 103);
    const candle945 = buildCandle(Date.parse("2024-01-02T14:45:00Z"), 103, 105, 101, 104);
    const candle1000 = buildCandle(Date.parse("2024-01-02T15:00:00Z"), 104, 106, 102, 105);

    manager.update(candle930);
    manager.update(candle945);
    const state = manager.update(candle1000);

    expect(state.orLevels).not.toBeNull();
    expect(state.orLevels?.orHigh).toBe(105);
    expect(state.orLevels?.orLow).toBe(99);
    expect(state.orLevels?.orMid).toBe(102);
  });
});

describe("ORB ATR strategy", () => {
  it("emits entry signal on breakout", () => {
    const strategy = new ORBATRStrategy(buildOrbParams());

    const history = [
      buildCandle(Date.parse("2024-01-02T14:00:00Z"), 100, 102, 99, 101),
      buildCandle(Date.parse("2024-01-02T14:15:00Z"), 101, 103, 100, 102)
    ];
    strategy.initialize(history);

    strategy.onCandle(buildCandle(Date.parse("2024-01-02T14:30:00Z"), 102, 104, 101, 103), null);
    strategy.onCandle(buildCandle(Date.parse("2024-01-02T14:45:00Z"), 103, 105, 102, 104), null);

    const signal = strategy.onCandle(buildCandle(Date.parse("2024-01-02T15:00:00Z"), 104, 106, 103, 105), null);

    expect(signal.type).toBe("ENTRY");
    expect(signal.side).toBe("long");
    expect(signal.stopLoss ?? 0).toBeCloseTo(101, 6);
    expect(signal.takeProfit ?? 0).toBeCloseTo(113, 6);
  });

  it("emits exit signal when stop loss is touched", () => {
    const strategy = new ORBATRStrategy(buildOrbParams());

    const history = [
      buildCandle(Date.parse("2024-01-02T14:00:00Z"), 100, 102, 99, 101),
      buildCandle(Date.parse("2024-01-02T14:15:00Z"), 101, 103, 100, 102)
    ];
    strategy.initialize(history);

    strategy.onCandle(buildCandle(Date.parse("2024-01-02T14:30:00Z"), 102, 104, 101, 103), null);
    strategy.onCandle(buildCandle(Date.parse("2024-01-02T14:45:00Z"), 103, 105, 102, 104), null);

    const position: Position = {
      id: "pos-1",
      side: "long",
      entryPrice: 105,
      quantity: 1,
      stopLoss: 101,
      takeProfit: 113,
      entryTime: Date.parse("2024-01-02T15:00:00Z")
    };

    const signal = strategy.onCandle(buildCandle(Date.parse("2024-01-02T15:15:00Z"), 104, 106, 100, 102), position);

    expect(signal.type).toBe("EXIT");
    expect(signal.reason).toBe("stop");
  });
});
