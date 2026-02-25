import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Minimal structural type for the `yahoo-finance2` `chart()` call as used by this repo.
 * We keep this narrow on purpose: tests should not depend on library-specific types.
 */
type YahooChartFn = (
  symbol: string,
  options: Readonly<{
    period1: Date;
    period2: Date;
    interval: string;
  }>
) => Promise<unknown>;

const chartMock = vi.hoisted(() => vi.fn<YahooChartFn>());

vi.mock("yahoo-finance2", () => {
  class YahooFinanceMock {
    public chart = chartMock;
  }

  return {
    default: YahooFinanceMock
  };
});

async function getSubject() {
  return await import("./yahooFinance.js");
}

beforeEach(() => {
  chartMock.mockReset();
});

describe("fetchYahooCandles()", () => {
  it("drops null OHLC rows, aggregates warnings, and preserves dedupe behavior", async () => {
    const { fetchYahooCandles } = await getSubject();

    const t0 = Date.UTC(2024, 0, 1, 0, 0, 0);
    const t1 = Date.UTC(2024, 0, 1, 0, 5, 0);
    const t2 = Date.UTC(2024, 0, 1, 0, 10, 0);

    const raw = {
      quotes: [
        // Valid row (will be overwritten by a later duplicate timestamp)
        { date: t0, open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" },

        // Duplicate timestamp: should override the prior row in dedupe
        { date: t0, open: "9", high: "10", low: "8", close: "9.5", volume: "11" },

        // Yahoo null OHLC row: should be dropped before Candle normalization
        { date: t1, open: null, high: null, low: null, close: null, volume: "0" },

        // Invalid date: should be dropped
        { date: "not-a-date", open: "1", high: "1", low: "1", close: "1", volume: "1" },

        // Invalid OHLC (high < max(open, close)): should be dropped during validation
        { date: t2, open: "5", high: "4", low: "3", close: "3.5", volume: "7" }
      ]
    };

    chartMock.mockResolvedValue(raw);

    const result = await fetchYahooCandles({
      symbol: "BTC-USD",
      interval: "5m",
      startTimeUtc: "2024-01-01T00:00:00.000Z",
      endTimeUtc: "2024-01-02T00:00:00.000Z"
    });

    expect(chartMock).toHaveBeenCalledTimes(1);

    // Only the deduped (latest) row at t0 should survive.
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]).toEqual({
      timeUtcMs: t0,
      open: 9,
      high: 10,
      low: 8,
      close: 9.5,
      volume: 11
    });

    // Aggregated warnings (counts + samples), no per-candle spam.
    expect(result.warnings.join("\n")).toContain("Dropped 1 Yahoo quote row(s) with null OHLC values.");
    expect(result.warnings.join("\n")).toContain(new Date(t1).toISOString());

    expect(result.warnings.join("\n")).toContain("Dropped 1 Yahoo quote row(s) with invalid timestamps.");
    expect(result.warnings.join("\n")).toContain("not-a-date");

    expect(result.warnings.join("\n")).toContain("Dropped 1 candle(s) failing OHLC validation");
    expect(result.warnings.join("\n")).toContain(new Date(t2).toISOString());
  });

  it("throws a clear error if 0 valid candles remain after filtering", async () => {
    const { fetchYahooCandles } = await getSubject();

    const t0 = Date.UTC(2024, 0, 1, 0, 0, 0);

    const raw = {
      quotes: [
        { date: t0, open: null, high: null, low: null, close: null, volume: "0" },
        { date: "not-a-date", open: null, high: null, low: null, close: null, volume: "0" }
      ]
    };

    chartMock.mockResolvedValue(raw);

    await expect(
      fetchYahooCandles({
        symbol: "BTC-USD",
        interval: "5m",
        startTimeUtc: "2024-01-01T00:00:00.000Z",
        endTimeUtc: "2024-01-02T00:00:00.000Z"
      })
    ).rejects.toThrow(/0 valid candles/i);
  });
});




