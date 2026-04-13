import { describe, expect, it } from "vitest";

import { exchangeCandleToPersistRecord, filterCandlesForTradeWindow } from "../tradeExitChartCandles.js";
import type { ExchangeCandle } from "../types.js";

function c(timeUtcMs: number, o: number, h: number, l: number, cl: number): ExchangeCandle {
  return { timeUtcMs, open: o, high: h, low: l, close: cl, volume: 1 };
}

describe("tradeExitChartCandles", () => {
  it("exchangeCandleToPersistRecord copies OHLCV fields", () => {
    const row = exchangeCandleToPersistRecord(c(1_700_000_000_000, 1, 2, 0.5, 1.5));
    expect(row["timeUtcMs"]).toBe(1_700_000_000_000);
    expect(row["open"]).toBe(1);
    expect(row["high"]).toBe(2);
    expect(row["low"]).toBe(0.5);
    expect(row["close"]).toBe(1.5);
    expect(row["volume"]).toBe(1);
  });

  it("filterCandlesForTradeWindow keeps candles inside padded entry/exit window", () => {
    const entry = 1_700_000_000_000;
    const exit = entry + 60_000;
    const tf = "15m";
    const bar = 15 * 60_000;
    const candles: ExchangeCandle[] = [
      c(entry - 30 * bar, 1, 1, 1, 1),
      c(entry - bar, 2, 2, 2, 2),
      c(entry, 3, 3, 3, 3),
      c(exit, 4, 4, 4, 4),
      c(exit + 30 * bar, 5, 5, 5, 5)
    ];
    const bundle = filterCandlesForTradeWindow(candles, entry, exit, tf);
    expect(bundle).not.toBeNull();
    if (bundle === null) {
      return;
    }
    expect(bundle.timeframe).toBe(tf);
    expect(bundle.candles.length).toBe(3);
    expect(bundle.rangeStartMs).toBe(entry - bar);
    expect(bundle.rangeEndMs).toBe(exit);
  });

  it("filterCandlesForTradeWindow falls back to full set when padded window is empty", () => {
    const entry = 1_700_000_000_000;
    const exit = entry + 60_000;
    const candles: ExchangeCandle[] = [c(1_000_000, 1, 1, 1, 1)];
    const bundle = filterCandlesForTradeWindow(candles, entry, exit, "15m");
    expect(bundle).not.toBeNull();
    if (bundle === null) {
      return;
    }
    expect(bundle.candles.length).toBe(1);
  });
});
