import type { YahooInterval } from "../data/yahooFinance.js";
import { intervalToMs } from "../utils/interval.js";
import type { ExchangeCandle, TradeExitCandleBundle } from "./types.js";

/**
 * Multi-timeframe klines persisted around each closed trade (Phase 3 dashboard charts).
 */
export const TRADE_EXIT_CHART_INTERVALS: readonly YahooInterval[] = ["15m", "1h", "4h"];

/**
 * Serializes an exchange candle for JSONB storage (`trade_candles.candles`).
 */
export function exchangeCandleToPersistRecord(candle: ExchangeCandle): Record<string, unknown> {
  return {
    timeUtcMs: candle.timeUtcMs,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
}

function resolveIntervalMs(intervalKey: string): number {
  try {
    return intervalToMs(intervalKey);
  } catch {
    return 60 * 60_000;
  }
}

/**
 * Filters fetched candles to entry/exit ± padding bars; falls back to full `candles` when the window is empty
 * (e.g. Bitunix trailing-200 response missing very old bars).
 */
export function filterCandlesForTradeWindow(
  candles: readonly ExchangeCandle[],
  entryTimeUtcMs: number,
  exitTimeUtcMs: number,
  timeframeLabel: string
): TradeExitCandleBundle | null {
  if (candles.length === 0) {
    return null;
  }
  const lo = Math.min(entryTimeUtcMs, exitTimeUtcMs);
  const hi = Math.max(entryTimeUtcMs, exitTimeUtcMs);
  const intervalMs = resolveIntervalMs(timeframeLabel);
  const padMs = 20 * intervalMs;
  const rangeStart = lo - padMs;
  const rangeEnd = hi + padMs;
  const filtered = candles.filter((c) => c.timeUtcMs >= rangeStart && c.timeUtcMs <= rangeEnd);
  const use = filtered.length > 0 ? filtered : candles;
  const first = use[0];
  const last = use[use.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  return {
    timeframe: timeframeLabel,
    candles: use.map(exchangeCandleToPersistRecord),
    rangeStartMs: first.timeUtcMs,
    rangeEndMs: last.timeUtcMs
  };
}
