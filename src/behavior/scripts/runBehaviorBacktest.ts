import "dotenv/config";
import { fetchBinanceCandles } from "../../data/binanceDataSource.js";
import { BehaviorAnalyzer } from "../analyzer/BehaviorAnalyzer.js";
import { BehaviorSheetsReporter } from "../reporter/BehaviorSheetsReporter.js";
import { BehaviorDashboardReporter } from "../reporter/BehaviorDashboardReporter.js";
import { getCycleStartUtcMs, toDateString } from "../utils.js";
import type { Candle, DailyCycleInput, BehaviorRow } from "../types.js";

function subtractDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") - days * 86400000).toISOString();
}

function addHours(isoDate: string, hours: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + hours * 3600000).toISOString();
}

function buildCycles(args: {
  candles15m: readonly Candle[];
  candles4h: readonly Candle[];
  startDate: string;
  endDate: string;
}): readonly DailyCycleInput[] {
  const cycles: DailyCycleInput[] = [];

  const startMs = Date.parse(args.startDate + "T00:00:00Z");
  const endMs = Date.parse(args.endDate + "T00:00:00Z");

  for (let currentMs = startMs; currentMs <= endMs; currentMs += 86400000) {
    const day = new Date(currentMs).toISOString().split("T")[0]!;
    const cycleStartUtcMs = Date.parse(day + "T00:00:00Z");

    const windowStart = cycleStartUtcMs - 8 * 3600 * 1000;
    const windowEnd = cycleStartUtcMs + 26 * 3600 * 1000;
    const allCandles15m = args.candles15m.filter(
      c => c.timeUtcMs >= windowStart && c.timeUtcMs < windowEnd
    );

    const mainCandles = allCandles15m.filter(
      c => c.timeUtcMs >= cycleStartUtcMs && c.timeUtcMs < cycleStartUtcMs + 24 * 3600 * 1000
    );
    if (mainCandles.length === 0) {
      console.warn(`[buildCycles] Skipping ${day}: no 15M candles in main cycle window`);
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

export async function main(): Promise<void> {
  // Default to 2024-01-01 for maximum sample size (Darren's request: 2024 → present).
  // Override with env var to run a specific range, e.g. BEHAVIOR_BACKTEST_START=2025-10-01
  const backtestStart = process.env.BEHAVIOR_BACKTEST_START ?? "2024-01-01";
  const backtestEnd = process.env.BEHAVIOR_BACKTEST_END ?? new Date().toISOString().slice(0, 10);
  const pair = process.env.BEHAVIOR_PAIR ?? "BTC-USD";
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  const fetch15mStart = subtractDays(backtestStart, 1);
  // The last cycle's window extends 26h past its start (cycleStartUtcMs + 26h), so fetch
  // 27h past the end date's midnight to ensure all candles for that final day are included.
  const fetch15mEnd = addHours(backtestEnd, 27);
  const result15m = await fetchBinanceCandles({
    symbol: pair,
    interval: "15m",
    startTimeUtc: fetch15mStart,
    endTimeUtc: fetch15mEnd,
  });

  const fetch4hStart = subtractDays(backtestStart, 45);
  // Extend 4H fetch end by 27h as well so the final cycle's HTF context candles are complete.
  const fetch4hEnd = addHours(backtestEnd, 27);
  const result4h = await fetchBinanceCandles({
    symbol: pair,
    interval: "4h",
    startTimeUtc: fetch4hStart,
    endTimeUtc: fetch4hEnd,
  });

  const cycles = buildCycles({
    candles15m: result15m.candles,
    candles4h: result4h.candles,
    startDate: backtestStart,
    endDate: backtestEnd,
  });

  const analyzer = new BehaviorAnalyzer();
  const rows: BehaviorRow[] = [];
  for (const cycle of cycles) {
    const row = analyzer.analyze(cycle);
    rows.push(row);
    if (verbose) {
      console.log(
        `[${toDateString(cycle.cycleStartUtcMs)}]`,
        row.previousDayLevel, row.twoCandleBehavior,
        "→", row.resolvedDecisionOutput, row.resolvedOutcomeQuality,
        row.lifecycleCrossedDayBoundary === "YES" ? "[CROSSED]" : ""
      );
    }
  }

  if (!dryRun) {
    const reporter = BehaviorSheetsReporter.fromEnv();
    await reporter.bulkWrite(rows);
    console.log(`✅ Wrote ${rows.length} rows to Google Sheets.`);

    // Refresh the BEHAVIOR-OVERVIEW-DASHBOARD tab from the full row set
    const dashReporter = BehaviorDashboardReporter.fromEnv();
    await dashReporter.write(rows);
    console.log(`✅ Dashboard tab refreshed.`);
  }

  console.log(`✅ Backtest complete: ${rows.length} days analyzed.`);
}

if (process.argv[1] && process.argv[1].endsWith('runBehaviorBacktest.ts')) {
  main().catch((err) => {
    console.error("[behavior-backtest] Fatal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
