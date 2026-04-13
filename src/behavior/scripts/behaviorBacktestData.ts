import { fetchBinanceCandles } from "../../data/binanceDataSource.js";
import { toDateString } from "../utils.js";
import type { Candle, DailyCycleInput } from "../types.js";

function subtractDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") - days * 86400000).toISOString();
}

function addHours(isoDate: string, hours: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + hours * 3600000).toISOString();
}

/**
 * Builds one DailyCycleInput per UTC calendar day in [startDate, endDate] from fetched candles.
 */
export function buildBehaviorDailyCycleInputs(args: {
  candles15m: readonly Candle[];
  candles4h: readonly Candle[];
  startDate: string;
  endDate: string;
}): readonly DailyCycleInput[] {
  const cycles: DailyCycleInput[] = [];

  const startMs = Date.parse(args.startDate + "T00:00:00Z");
  const endMs = Date.parse(args.endDate + "T00:00:00Z");

  for (let currentMs = startMs; currentMs <= endMs; currentMs += 86400000) {
    const day = new Date(currentMs).toISOString().split("T")[0];
    if (day === undefined) {
      continue;
    }
    const cycleStartUtcMs = Date.parse(`${day}T00:00:00Z`);

    const windowStart = cycleStartUtcMs - 8 * 3600 * 1000;
    const windowEnd = cycleStartUtcMs + 26 * 3600 * 1000;
    const allCandles15m = args.candles15m.filter(
      c => c.timeUtcMs >= windowStart && c.timeUtcMs < windowEnd
    );

    const mainCandles = allCandles15m.filter(
      c => c.timeUtcMs >= cycleStartUtcMs && c.timeUtcMs < cycleStartUtcMs + 24 * 3600 * 1000
    );
    if (mainCandles.length === 0) {
      console.warn(`[buildBehaviorDailyCycleInputs] Skipping ${day}: no 15M candles in main cycle window`);
      continue;
    }

    const prevStart = cycleStartUtcMs - 24 * 3600 * 1000;
    const prevCandles = args.candles15m.filter(
      c => c.timeUtcMs >= prevStart && c.timeUtcMs < cycleStartUtcMs
    );
    const pdh = prevCandles.length > 0 ? Math.max(...prevCandles.map(c => c.high)) : 0;
    const pdl = prevCandles.length > 0 ? Math.min(...prevCandles.map(c => c.low)) : 0;

    cycles.push({
      cycleStartUtcMs,
      allCandles15m,
      candles4h: args.candles4h,
      pdh,
      pdl,
      uid: cycles.length + 1,
      writeDate: toDateString(cycleStartUtcMs),
    });
  }

  return cycles;
}

export type BehaviorBacktestRange = Readonly<{
  backtestStart: string;
  backtestEnd: string;
  pair: string;
}>;

/**
 * Reads range from env (same semantics as behavior backtest script).
 */
export function readBehaviorBacktestRangeFromEnv(): BehaviorBacktestRange {
  const backtestStart = process.env.BEHAVIOR_BACKTEST_START ?? "2024-01-01";
  const backtestEnd = process.env.BEHAVIOR_BACKTEST_END ?? new Date().toISOString().slice(0, 10);
  const pair = process.env.BEHAVIOR_PAIR ?? "BTC-USD";
  return { backtestStart, backtestEnd, pair };
}

/**
 * Fetches Binance candles and builds daily cycle inputs for the configured range.
 */
export async function loadBehaviorDailyCycleInputsForRange(
  range: BehaviorBacktestRange
): Promise<readonly DailyCycleInput[]> {
  const { backtestStart, backtestEnd, pair } = range;

  const fetch15mStart = subtractDays(backtestStart, 1);
  const fetch15mEnd = addHours(backtestEnd, 27);
  const result15m = await fetchBinanceCandles({
    symbol: pair,
    interval: "15m",
    startTimeUtc: fetch15mStart,
    endTimeUtc: fetch15mEnd,
  });

  const fetch4hStart = subtractDays(backtestStart, 45);
  const fetch4hEnd = addHours(backtestEnd, 27);
  const result4h = await fetchBinanceCandles({
    symbol: pair,
    interval: "4h",
    startTimeUtc: fetch4hStart,
    endTimeUtc: fetch4hEnd,
  });

  return buildBehaviorDailyCycleInputs({
    candles15m: result15m.candles,
    candles4h: result4h.candles,
    startDate: backtestStart,
    endDate: backtestEnd,
  });
}
