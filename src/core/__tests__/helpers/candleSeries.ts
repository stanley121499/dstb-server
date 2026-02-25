import { createHash } from "node:crypto";
import type { Candle, CandleFetchResult, YahooInterval } from "../../data/yahooFinance.js";

/**
 * Args for building deterministic candle series.
 */
export type CandleSeriesArgs = Readonly<{
  startTimeMs: number;
  intervalMs: number;
  count: number;
  basePrice: number;
  volatility: number;
  volumeBase?: number;
}>;

/**
 * Builds a deterministic candle series for testing.
 *
 * Inputs:
 * - startTimeMs: UTC start timestamp in milliseconds.
 * - intervalMs: Candle interval length in milliseconds.
 * - count: Number of candles to generate.
 * - basePrice: Starting price.
 * - volatility: Max absolute change per candle.
 * - volumeBase: Optional base volume (default 1000).
 *
 * Outputs:
 * - Array of Candle objects sorted by time.
 *
 * Error behavior:
 * - Throws on invalid inputs.
 */
export function buildCandleSeries(args: CandleSeriesArgs): Candle[] {
  // Step 1: Validate inputs.
  if (!Number.isFinite(args.startTimeMs)) {
    throw new Error("startTimeMs must be a finite number.");
  }
  if (!Number.isFinite(args.intervalMs) || args.intervalMs <= 0) {
    throw new Error("intervalMs must be a positive number.");
  }
  if (!Number.isFinite(args.count) || args.count <= 0) {
    throw new Error("count must be a positive number.");
  }
  if (!Number.isFinite(args.basePrice) || args.basePrice <= 0) {
    throw new Error("basePrice must be a positive number.");
  }
  if (!Number.isFinite(args.volatility) || args.volatility < 0) {
    throw new Error("volatility must be a non-negative number.");
  }

  // Step 2: Generate a deterministic walk using a sine wave.
  const candles: Candle[] = [];
  const volumeBase = args.volumeBase ?? 1000;
  for (let index = 0; index < args.count; index += 1) {
    const timeUtcMs = args.startTimeMs + index * args.intervalMs;
    const wave = Math.sin(index / 3);
    const delta = wave * args.volatility;
    const open = args.basePrice + delta;
    const close = args.basePrice + Math.sin((index + 1) / 3) * args.volatility;
    const high = Math.max(open, close) + args.volatility * 0.5;
    const low = Math.min(open, close) - args.volatility * 0.5;

    candles.push({
      timeUtcMs,
      open,
      high,
      low,
      close,
      volume: volumeBase + index * 2
    });
  }

  // Step 3: Return the constructed series.
  return candles;
}

/**
 * Builds a CandleFetchResult for tests with a deterministic fingerprint.
 *
 * Inputs:
 * - symbol: Trading symbol.
 * - interval: Candle interval identifier.
 * - startTimeUtc: ISO start time.
 * - endTimeUtc: ISO end time.
 * - candles: Candle array.
 *
 * Outputs:
 * - CandleFetchResult matching the production shape.
 */
export function buildCandleFetchResult(args: Readonly<{
  symbol: string;
  interval: YahooInterval;
  startTimeUtc: string;
  endTimeUtc: string;
  candles: readonly Candle[];
}>): CandleFetchResult {
  // Step 1: Build fingerprint input.
  const fingerprintData = {
    source: "yahoo" as const,
    symbol: args.symbol,
    interval: args.interval,
    startTimeUtc: args.startTimeUtc,
    endTimeUtc: args.endTimeUtc,
    fetchedAtUtc: new Date().toISOString(),
    rowCount: args.candles.length,
    firstTimeUtc: args.candles[0] ? new Date(args.candles[0].timeUtcMs).toISOString() : null,
    lastTimeUtc: args.candles[args.candles.length - 1]
      ? new Date(args.candles[args.candles.length - 1]?.timeUtcMs ?? 0).toISOString()
      : null
  };

  // Step 2: Compute deterministic hash.
  const sha256 = createHash("sha256")
    .update(JSON.stringify(fingerprintData), "utf8")
    .digest("hex");

  // Step 3: Return the fetch result.
  return {
    candles: [...args.candles],
    fingerprint: {
      source: "yahoo",
      symbol: args.symbol,
      interval: args.interval,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      fetchedAtUtc: fingerprintData.fetchedAtUtc,
      rowCount: args.candles.length,
      firstTimeUtc: fingerprintData.firstTimeUtc,
      lastTimeUtc: fingerprintData.lastTimeUtc,
      sha256
    },
    warnings: []
  };
}

/**
 * Builds a mock fetcher for Binance candle calls that respects time windows.
 *
 * Inputs:
 * - symbol: Symbol string to validate.
 * - interval: YahooInterval value to validate.
 * - candles: Candle array used for responses.
 *
 * Outputs:
 * - Function with the same signature as fetchBinanceCandles().
 */
export function buildMockBinanceFetcher(args: Readonly<{
  symbol: string;
  interval: YahooInterval;
  candles: readonly Candle[];
}>): (input: Readonly<{ symbol: string; interval: YahooInterval; startTimeUtc: string; endTimeUtc: string }>) => Promise<CandleFetchResult> {
  // Step 1: Validate inputs.
  if (args.candles.length === 0) {
    throw new Error("Mock candles cannot be empty.");
  }
  const lastCandle = args.candles[args.candles.length - 1];
  if (lastCandle === undefined) {
    throw new Error("Mock candles must include a valid last candle.");
  }

  // Step 2: Return the mock fetcher.
  return async (input) => {
    if (input.symbol !== args.symbol) {
      throw new Error(`Unexpected symbol "${input.symbol}".`);
    }
    if (input.interval !== args.interval) {
      throw new Error(`Unexpected interval "${input.interval}".`);
    }
    const startMs = new Date(input.startTimeUtc).getTime();
    const endMs = new Date(input.endTimeUtc).getTime();
    const filtered = args.candles.filter((candle) => candle.timeUtcMs >= startMs && candle.timeUtcMs <= endMs);
    const candles = filtered.length > 0 ? filtered : [lastCandle];
    return buildCandleFetchResult({
      symbol: input.symbol,
      interval: input.interval,
      startTimeUtc: input.startTimeUtc,
      endTimeUtc: input.endTimeUtc,
      candles
    });
  };
}
