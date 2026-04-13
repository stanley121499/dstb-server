import type { CandlestickData, Time } from "lightweight-charts";

/**
 * Normalizes `trade_candles.candles` JSONB into chart-ready OHLCV (ms timestamps).
 */
export type ChartCandle = Readonly<{
  timeUtcMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}>;

function readNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parses one stored candle record into `ChartCandle` or returns null when invalid.
 */
export function parseStoredCandleRecord(row: Readonly<Record<string, unknown>>): ChartCandle | null {
  const timeUtcMs = readNum(row["timeUtcMs"]);
  const open = readNum(row["open"]);
  const high = readNum(row["high"]);
  const low = readNum(row["low"]);
  const close = readNum(row["close"]);
  if (timeUtcMs === null || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { timeUtcMs, open, high, low, close };
}

/**
 * Parses a JSONB array of candle objects from Supabase.
 */
export function parseCandlesJsonb(payload: unknown): ChartCandle[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const out: ChartCandle[] = [];
  for (const item of payload) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const parsed = parseStoredCandleRecord(item as Record<string, unknown>);
    if (parsed !== null) {
      out.push(parsed);
    }
  }
  return out.sort((a, b) => a.timeUtcMs - b.timeUtcMs);
}

/**
 * Converts chart candles to Lightweight Charts candlestick format (`time` in UTC seconds).
 */
export function toLwCandlestickData(candles: readonly ChartCandle[]): CandlestickData<Time>[] {
  return candles.map((c) => ({
    time: Math.floor(c.timeUtcMs / 1000) as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }));
}
