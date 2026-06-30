import "dotenv/config";
import { BehaviorAnalyzer } from "../analyzer/BehaviorAnalyzer.js";
import { BehaviorSheetsReporter } from "../reporter/BehaviorSheetsReporter.js";
import { BehaviorDashboardReporter } from "../reporter/BehaviorDashboardReporter.js";
import { toDateString } from "../utils.js";
import type { BehaviorRow } from "../types.js";
import {
  loadBehaviorDailyCycleInputsForRange,
  readBehaviorBacktestRangeFromEnv,
} from "./behaviorBacktestData.js";

/** Returns yesterday's date in UTC as "YYYY-MM-DD". */
function yesterdayUtc(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

/** Adds one calendar day to a "YYYY-MM-DD" string. */
function addOneDay(isoDate: string): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
}

export async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const fullRun = process.argv.includes("--full");

  const reporter = dryRun ? null : BehaviorSheetsReporter.fromEnv();

  // --- Determine date range ---
  // Incremental mode: read the last date from the sheet and only fetch what's new.
  // Full mode (--full flag, or sheet is empty): fetch from BEHAVIOR_BACKTEST_START.
  let backtestStart: string;
  let isIncremental = false;

  const envRange = readBehaviorBacktestRangeFromEnv();

  if (!fullRun && reporter !== null) {
    const lastDate = await reporter.readLastRowDate();
    if (lastDate !== null) {
      const nextDay = addOneDay(lastDate);
      const yesterday = yesterdayUtc();
      if (nextDay > yesterday) {
        console.log(`✅ Sheet already up to date (last row: ${lastDate}). Nothing to do.`);
        return;
      }
      backtestStart = nextDay;
      isIncremental = true;
      console.log(`[behavior-backtest] Incremental run: fetching ${nextDay} → ${yesterday}`);
    } else {
      backtestStart = envRange.backtestStart;
      console.log(`[behavior-backtest] Sheet is empty — full backfill from ${backtestStart}`);
    }
  } else {
    backtestStart = envRange.backtestStart;
    console.log(`[behavior-backtest] Full run from ${backtestStart}`);
  }

  const backtestEnd = envRange.backtestEnd;
  const pair = envRange.pair;

  const cycles = await loadBehaviorDailyCycleInputsForRange({ backtestStart, backtestEnd, pair });

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

  if (!dryRun && reporter !== null) {
    if (isIncremental) {
      // Append only the new rows — do not clear the sheet.
      await reporter.appendRows(rows);
      console.log(`✅ Appended ${rows.length} new row(s) to Google Sheets.`);
    } else {
      // Full run: clear and rewrite everything, then refresh the dashboard.
      await reporter.bulkWrite(rows);
      console.log(`✅ Wrote ${rows.length} rows to Google Sheets.`);

      const dashReporter = BehaviorDashboardReporter.fromEnv();
      await dashReporter.write(rows);
      console.log(`✅ Dashboard tab refreshed.`);
    }
  }

  console.log(`✅ Backtest complete: ${rows.length} days analyzed.`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("runBehaviorBacktest.ts")) {
  main().catch((err) => {
    console.error("[behavior-backtest] Fatal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
