import { randomUUID } from "node:crypto";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import { fetchYahooCandles } from "../data/yahooFinance.js";
import { runBacktest, type BacktestResult } from "./runBacktest.js";

export type RunBacktestWithYahooOk = Readonly<{
  ok: true;
  runId: string;
  result: BacktestResult;
  candleWarnings: readonly string[];
}>;

export type RunBacktestWithYahooErr = Readonly<{
  ok: false;
  error: string;
}>;

export type RunBacktestWithYahooResult = RunBacktestWithYahooOk | RunBacktestWithYahooErr;

/**
 * Fetches Yahoo candles and runs the ORB-ATR backtest engine (shared by CLI and HTTP).
 */
export async function runBacktestWithYahoo(args: Readonly<{
  strategy: string;
  symbol: string;
  interval: string;
  initialBalance: number;
  paramsBody: Record<string, unknown>;
  startDate: string;
  endDate: string;
}>): Promise<RunBacktestWithYahooResult> {
  if (args.strategy !== "orb-atr") {
    return { ok: false, error: `Unsupported strategy for Yahoo backtest: "${args.strategy}"` };
  }

  const startMs = Date.parse(args.startDate);
  const endMs = Date.parse(args.endDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { ok: false, error: "Invalid start or end date." };
  }
  if (startMs >= endMs) {
    return { ok: false, error: "start must be before end." };
  }

  const maxRangeDays = 800;
  const rangeDays = (endMs - startMs) / (86_400_000);
  if (rangeDays > maxRangeDays) {
    return {
      ok: false,
      error: `Date range too large (${Math.floor(rangeDays)} days). Maximum is ${String(maxRangeDays)} days.`
    };
  }

  const merged = strategyParamsSchema.safeParse({
    ...args.paramsBody,
    symbol: args.symbol,
    interval: args.interval
  });
  if (!merged.success) {
    const msg = merged.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { ok: false, error: msg };
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  let candles;
  try {
    const candleResult = await fetchYahooCandles({
      symbol: merged.data.symbol,
      interval: merged.data.interval,
      startTimeUtc: startIso,
      endTimeUtc: endIso
    });
    candles = candleResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Candle fetch failed: ${msg}` };
  }

  const runId = randomUUID();
  const result = runBacktest({
    runId,
    candles: candles.candles,
    candlesSorted: true,
    params: merged.data,
    startTimeUtc: startIso,
    endTimeUtc: endIso,
    initialEquity: args.initialBalance
  });

  return {
    ok: true,
    runId,
    result,
    candleWarnings: candles.warnings
  };
}
