import { main } from "../../behavior/scripts/runBehaviorBacktest.js";
import type { ParsedCliArgs } from "./cliTypes.js";

export async function runBehaviorBacktest(args: ParsedCliArgs): Promise<void> {
  const { flags, booleanFlags } = args;

  // Forward flags to process.env and process.argv since the script reads them
  if (flags["start"]) {
    process.env.BEHAVIOR_BACKTEST_START = flags["start"];
  }
  if (flags["end"]) {
    process.env.BEHAVIOR_BACKTEST_END = flags["end"];
  }

  if (booleanFlags["dry-run"] && !process.argv.includes("--dry-run")) {
    process.argv.push("--dry-run");
  }
  if (booleanFlags["verbose"] && !process.argv.includes("--verbose")) {
    process.argv.push("--verbose");
  }

  await main();
}

export const runBehaviorBacktestCommand = runBehaviorBacktest;
