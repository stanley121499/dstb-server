import type { Candle } from "./yahooFinance.js";
import { intervalToMs } from "../utils/interval.js";

/**
 * Resamples candles from a base interval to a coarser interval.
 *
 * Intervals: see `dstb-docs/raw/docs/architecture.md` and `src/utils/interval.ts` (legacy doc `docs/13` was never checked in).
 * - Open: first open
 * - High: max high
 * - Low: min low
 * - Close: last close
 * - Volume: sum
 *
 * Timestamps are aligned to UTC boundaries for the target interval.
 */
export function resampleCandles(args: Readonly<{
  candles: readonly Candle[];
  targetInterval: string;
}>): readonly Candle[] {
  const bucketMs = intervalToMs(args.targetInterval);
  if (args.candles.length === 0) {
    return [];
  }

  const buckets = new Map<number, Candle>();
  for (const c of args.candles) {
    const bucketStart = Math.floor(c.timeUtcMs / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (existing === undefined) {
      buckets.set(bucketStart, {
        timeUtcMs: bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      });
      continue;
    }

    buckets.set(bucketStart, {
      timeUtcMs: bucketStart,
      open: existing.open,
      high: Math.max(existing.high, c.high),
      low: Math.min(existing.low, c.low),
      close: c.close,
      volume: existing.volume + c.volume
    });
  }

  const out = [...buckets.values()];
  out.sort((a, b) => a.timeUtcMs - b.timeUtcMs);
  return out;
}





