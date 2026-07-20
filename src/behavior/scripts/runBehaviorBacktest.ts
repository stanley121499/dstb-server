import "dotenv/config";
import { BehaviorAnalyzer } from "../analyzer/BehaviorAnalyzer.js";
import { BehaviorSheetsReporter } from "../reporter/BehaviorSheetsReporter.js";
import { BehaviorDashboardReporter } from "../reporter/BehaviorDashboardReporter.js";
import { toDateString, yesterdayGmt8Iso } from "../utils.js";
import type { BehaviorRow } from "../types.js";
import {
  loadBehaviorDailyCycleInputsForRange,
  readBehaviorBacktestRangeFromEnv,
} from "./behaviorBacktestData.js";

/** Adds one calendar day to a "YYYY-MM-DD" string. */
function addOneDay(isoDate: string): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
}

/**
 * Rebuilds BEHAVIOR-OVERVIEW-DASHBOARD from every row currently on the raw sheet.
 * Required after incremental appends so the overview tab does not lag behind
 * append-only nightly writes (new rows alone are not enough to recompute counts).
 */
async function refreshDashboardFromSheet(reporter: BehaviorSheetsReporter): Promise<void> {
  const allRows = await reporter.readAllBehaviorRows();
  const dashReporter = BehaviorDashboardReporter.fromEnv();
  await dashReporter.write(allRows);
  console.log(`✅ Dashboard tab refreshed from ${allRows.length} sheet row(s).`);
}

export async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const fullRun = process.argv.includes("--full");

  const reporter = dryRun ? null : BehaviorSheetsReporter.fromEnv();

  // --- Determine date range ---
  // Incremental mode: read the last date from the sheet and only fetch what's new.
  // Full mode (--full flag, or sheet is empty): fetch from BEHAVIOR_BACKTEST_START.
  const envRange = readBehaviorBacktestRangeFromEnv();
  let backtestStart: string;
  let backtestEnd = envRange.backtestEnd;
  let isIncremental = false;

  if (!fullRun && reporter !== null) {
    const lastMeta = await reporter.readLastDataRowMeta();
    if (lastMeta !== null) {
      const lastDate = lastMeta.isoDate;
      const nextDay = addOneDay(lastDate);
      const yesterday = yesterdayGmt8Iso();
      if (nextDay > yesterday) {
        console.log(
          `✅ Sheet already up to date (last row ${lastMeta.rowNumber}: ${lastDate}, ${reporter.describeTarget()}).`
        );
        // Heal stale overview clusters left behind by older append-only runs.
        await refreshDashboardFromSheet(reporter);
        return;
      }
      backtestStart = nextDay;
      backtestEnd = yesterday;
      isIncremental = true;
      console.log(
        `[behavior-backtest] Incremental run: fetching ${nextDay} → ${yesterday} (after row ${lastMeta.rowNumber} date ${lastDate}, ${reporter.describeTarget()})`
      );
    } else {
      backtestStart = envRange.backtestStart;
      console.log(
        `[behavior-backtest] Sheet is empty — full backfill from ${backtestStart} (${reporter.describeTarget()})`
      );
    }
  } else {
    backtestStart = envRange.backtestStart;
    console.log(`[behavior-backtest] Full run from ${backtestStart}`);
  }
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
      const verify = await reporter.readLastDataRowMeta();
      console.log(
        `✅ Appended ${rows.length} new row(s) to Google Sheets (${reporter.describeTarget()}).`
      );
      if (verify !== null) {
        console.log(
          `[behavior-backtest] Sheet last row after write: row ${verify.rowNumber}, date ${verify.isoDate}`
        );
      }
      // Recompute overview from the full sheet (new rows alone undercount clusters).
      await refreshDashboardFromSheet(reporter);
    } else {
      // Full run: clear and rewrite everything, then refresh the dashboard.
      await reporter.bulkWrite(rows);
      console.log(`✅ Wrote ${rows.length} rows to Google Sheets (${reporter.describeTarget()}).`);

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
