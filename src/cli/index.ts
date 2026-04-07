import "dotenv/config";

import { runBacktest } from "./commands/backtest";
import { runLogs } from "./commands/logs";
import { runReconcile } from "./commands/reconcile";
import { runStart } from "./commands/start";
import { runStatus } from "./commands/status";
import { runStop } from "./commands/stop";
import { runBehaviorBacktest } from "./commands/behaviorBacktest";
import { runBehaviorLive } from "./commands/behaviorLive";
import type { CliCommand, ParsedCliArgs } from "./commands/cliTypes";
import { parseArgv } from "./commands/cliUtils";

const supportedCommands: Readonly<CliCommand[]> = [
  "start",
  "stop",
  "status",
  "logs",
  "backtest",
  "reconcile",
  "behavior:backtest",
  "behavior:live"
];

const booleanFlags = [
  "help",
  "verbose",
  "paper",
  "daemon",
  "daemon-child",
  "dry-run",
  "force",
  "all",
  "follow",
  "json",
  "fix"
];

/**
 * CLI entrypoint for DSTB bot control.
 */
async function main(): Promise<void> {
  // Step 1: Parse raw argv and handle global help.
  const raw = parseArgv(process.argv.slice(2), booleanFlags);
  const helpRequested = raw.booleanFlags["help"] === true || raw.command === null;

  if (helpRequested) {
    printHelp();
    return;
  }

  // Step 2: Validate and normalize the command.
  const command = raw.command;
  if (command === null || !supportedCommands.includes(command as CliCommand)) {
    throw new Error(`Unsupported command "${command ?? "unknown"}".`);
  }

  // Step 3: Dispatch to the specific command handler.
  const parsed: ParsedCliArgs = {
    command: command as CliCommand,
    flags: raw.flags,
    booleanFlags: raw.booleanFlags,
    positionals: raw.positionals
  };

  switch (parsed.command) {
    case "start":
      await runStart(parsed);
      return;
    case "stop":
      await runStop(parsed);
      return;
    case "status":
      await runStatus(parsed);
      return;
    case "logs":
      await runLogs(parsed);
      return;
    case "backtest":
      await runBacktest(parsed);
      return;
    case "reconcile":
      await runReconcile(parsed);
      return;
    case "behavior:backtest":
      await runBehaviorBacktest(parsed);
      return;
    case "behavior:live":
      await runBehaviorLive(parsed);
      return;
    default:
      throw new Error(`Unsupported command "${parsed.command}".`);
  }
}

/**
 * Print CLI usage help text.
 */
function printHelp(): void {
  const lines = [
    "DSTB CLI",
    "",
    "Usage:",
    "  bot <command> [options]",
    "",
    "Commands:",
    "  start       Start a trading bot",
    "  stop        Stop a trading bot",
    "  status      Show bot status",
    "  logs        View bot logs",
    "  backtest    Run a backtest",
    "  reconcile   Reconcile state with exchange",
    "  behavior:backtest   Run S2 behavior backtest",
    "  behavior:live       Start S2 behavior live bot",
    "",
    "Global Options:",
    "  --help      Show help for command",
    "  --verbose   Enable verbose errors"
  ];
  console.log(lines.join("\n"));
}

(async () => {
  try {
    await main();
  } catch (error) {
    const verbose = process.argv.includes("--verbose");
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bot-cli] Error: ${message}`);
    if (verbose && error instanceof Error && error.stack !== undefined) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
})();
