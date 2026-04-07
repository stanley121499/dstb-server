import YahooFinance from "yahoo-finance2";
import { z } from "zod";

import { Sha256 } from "../utils/hash.js";
import { intervalToMs } from "../utils/interval.js";

export type Candle = Readonly<{
  timeUtcMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

/**
 * Intervals supported by Phase 1 (aligned with `src/utils/interval.ts` and API schemas).
 *
 * Note: `yahoo-finance2` has its own interval union; this type matches the subset we use.
 */
export type YahooInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "4h" | "1d";

export type CandleFetchResult = Readonly<{
  candles: readonly Candle[];
  fingerprint: Readonly<{
    source: "yahoo";
    symbol: string;
    interval: YahooInterval;
    startTimeUtc: string;
    endTimeUtc: string;
    fetchedAtUtc: string;
    rowCount: number;
    firstTimeUtc: string | null;
    lastTimeUtc: string | null;
    sha256: string;
  }>;
  warnings: readonly string[];
}>;

const numeric = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

/**
 * Yahoo sometimes returns `null` for OHLC values inside `quotes[]`.
 * We accept that at the parsing boundary, then drop null rows during normalization.
 *
 * Important: the engine expects `Candle` to contain only numbers.
 */
const numericNullable = z.union([numeric, z.null()]);

const quoteSchema = z.object({
  date: z.union([z.date(), z.number(), z.string()]),
  open: numericNullable,
  high: numericNullable,
  low: numericNullable,
  close: numericNullable,
  volume: z.union([numeric, z.null(), z.undefined()]).optional()
});

const chartResultSchema = z.object({
  quotes: z.array(quoteSchema)
});

function toTimeMs(value: Date | number | string): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  return new Date(value).getTime();
}

function validateCandleOhlc(c: Candle): string | null {
  if (!Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) {
    return "Candle contains non-finite OHLC";
  }
  if (!Number.isFinite(c.volume)) {
    return "Candle contains non-finite volume";
  }
  const maxOc = Math.max(c.open, c.close);
  const minOc = Math.min(c.open, c.close);
  if (c.high < maxOc) {
    return "Candle high < max(open, close)";
  }
  if (c.low > minOc) {
    return "Candle low > min(open, close)";
  }
  if (c.high < c.low) {
    return "Candle high < low";
  }
  return null;
}

/**
 * Adds a sample string to an array, up to a hard maximum, without duplicates.
 */
function addSample(samples: string[], value: string, maxSamples: number): void {
  if (samples.length >= maxSamples) {
    return;
  }
  if (samples.includes(value)) {
    return;
  }
  samples.push(value);
}

/**
 * Fetches candles from Yahoo Finance (Node equivalent of the “yfinance” intent in docs).
 *
 * @param symbol - e.g. "BTC-USD"
 * @param interval - e.g. "5m", "1h", "1d"
 * @param startTimeUtc - ISO string
 * @param endTimeUtc - ISO string
 */
export async function fetchYahooCandles(args: Readonly<{
  symbol: string;
  interval: YahooInterval;
  startTimeUtc: string;
  endTimeUtc: string;
}>): Promise<CandleFetchResult> {
  const yahooFinance = new YahooFinance();
  const fetchedAtUtc = new Date().toISOString();
  const warningSampleLimit = 5;

  // `chart()` is the recommended historical interface in yahoo-finance2.
  const raw = await yahooFinance.chart(args.symbol, {
    period1: new Date(args.startTimeUtc),
    period2: new Date(args.endTimeUtc),
    interval: args.interval as "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d"
  });

  const parsed = chartResultSchema.parse(raw);

  // Convert to candles, then sort + dedupe by timestamp (see architecture + interval helpers).
  // We accept Yahoo's raw null OHLC values (schema-level), but we do NOT allow nulls into Candle[].
  // Instead, we drop invalid rows here and emit aggregated warnings (not per-row spam).
  const droppedNullOhlcSamples: string[] = [];
  let droppedNullOhlcCount = 0;

  const droppedInvalidTimestampSamples: string[] = [];
  let droppedInvalidTimestampCount = 0;

  const candlesUnsorted: Candle[] = [];
  for (const q of parsed.quotes) {
    const timeUtcMs = toTimeMs(q.date);
    if (!Number.isFinite(timeUtcMs)) {
      droppedInvalidTimestampCount += 1;
      addSample(droppedInvalidTimestampSamples, String(q.date), warningSampleLimit);
      continue;
    }

    if (q.open === null || q.high === null || q.low === null || q.close === null) {
      droppedNullOhlcCount += 1;
      addSample(droppedNullOhlcSamples, new Date(timeUtcMs).toISOString(), warningSampleLimit);
      continue;
    }

    candlesUnsorted.push({
      timeUtcMs,
      open: Number(q.open),
      high: Number(q.high),
      low: Number(q.low),
      close: Number(q.close),
      volume: q.volume === null || q.volume === undefined ? 0 : Number(q.volume)
    });
  }

  candlesUnsorted.sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  const deduped: Candle[] = [];
  for (const candle of candlesUnsorted) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && last.timeUtcMs === candle.timeUtcMs) {
      // Keep the latest row for duplicate timestamps.
      deduped[deduped.length - 1] = candle;
      continue;
    }
    deduped.push(candle);
  }

  const warnings: string[] = [];
  if (droppedNullOhlcCount > 0) {
    warnings.push(
      [
        `Dropped ${droppedNullOhlcCount} Yahoo quote row(s) with null OHLC values.`,
        droppedNullOhlcSamples.length > 0 ? `Sample UTC times: ${droppedNullOhlcSamples.join(", ")}` : null
      ]
        .filter((v): v is string => v !== null)
        .join(" ")
    );
  }
  if (droppedInvalidTimestampCount > 0) {
    warnings.push(
      [
        `Dropped ${droppedInvalidTimestampCount} Yahoo quote row(s) with invalid timestamps.`,
        droppedInvalidTimestampSamples.length > 0 ? `Sample raw date values: ${droppedInvalidTimestampSamples.join(", ")}` : null
      ]
        .filter((v): v is string => v !== null)
        .join(" ")
    );
  }

  const validationFailures = new Map<string, { count: number; samples: string[] }>();
  const validated: Candle[] = [];
  for (const candle of deduped) {
    const msg = validateCandleOhlc(candle);
    if (msg !== null) {
      const key = msg;
      const existing = validationFailures.get(key);
      if (existing === undefined) {
        validationFailures.set(key, { count: 1, samples: [new Date(candle.timeUtcMs).toISOString()] });
      } else {
        existing.count += 1;
        addSample(existing.samples, new Date(candle.timeUtcMs).toISOString(), warningSampleLimit);
      }
      continue;
    }
    validated.push(candle);
  }

  for (const [reason, info] of validationFailures.entries()) {
    warnings.push(
      [
        `Dropped ${info.count} candle(s) failing OHLC validation: "${reason}".`,
        info.samples.length > 0 ? `Sample UTC times: ${info.samples.join(", ")}` : null
      ]
        .filter((v): v is string => v !== null)
        .join(" ")
    );
  }

  if (validated.length === 0) {
    throw new Error(
      [
        `Yahoo Finance returned 0 valid candles after filtering invalid quote rows.`,
        `symbol=${args.symbol}`,
        `interval=${args.interval}`,
        `startTimeUtc=${args.startTimeUtc}`,
        `endTimeUtc=${args.endTimeUtc}`,
        `droppedNullOhlc=${droppedNullOhlcCount}`,
        `droppedInvalidTimestamp=${droppedInvalidTimestampCount}`,
        `droppedOhlcValidation=${Array.from(validationFailures.values()).reduce((sum, v) => sum + v.count, 0)}`
      ].join(" ")
    );
  }

  // Fingerprint: stable hash over normalized candle rows.
  const hasher = new Sha256();
  for (const c of validated) {
    hasher.update(`${c.timeUtcMs}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume}\n`);
  }

  const first = validated[0];
  const last = validated[validated.length - 1];

  // Quick sanity check: Yahoo sometimes returns a different interval than requested.
  // We don't treat this as fatal, but we log a warning if timestamps aren't aligned.
  const intervalMs = intervalToMs(args.interval);
  if (validated.length > 0) {
    const misaligned = validated.some((c) => c.timeUtcMs % intervalMs !== 0);
    if (misaligned) {
      warnings.push("Some candle timestamps are not aligned to the requested interval boundary in UTC.");
    }
  }

  return {
    candles: validated,
    fingerprint: {
      source: "yahoo",
      symbol: args.symbol,
      interval: args.interval,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      fetchedAtUtc,
      rowCount: validated.length,
      firstTimeUtc: first === undefined ? null : new Date(first.timeUtcMs).toISOString(),
      lastTimeUtc: last === undefined ? null : new Date(last.timeUtcMs).toISOString(),
      sha256: hasher.digestHex()
    },
    warnings
  };
}





