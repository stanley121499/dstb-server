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

export async function main(): Promise<void> {
  const range = readBehaviorBacktestRangeFromEnv();
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  const cycles = await loadBehaviorDailyCycleInputsForRange(range);

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

    const dashReporter = BehaviorDashboardReporter.fromEnv();
    await dashReporter.write(rows);
    console.log(`✅ Dashboard tab refreshed.`);
  }

  console.log(`✅ Backtest complete: ${rows.length} days analyzed.`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("runBehaviorBacktest.ts")) {
  main().catch((err) => {
    console.error("[behavior-backtest] Fatal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
