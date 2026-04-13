import fs from "node:fs";
import path from "node:path";

import { runBacktestWithYahoo } from "../../backtest/runBacktestWithYahoo.js";
import type { ParsedCliArgs } from "./cliTypes";
import { assertNonEmptyString, isRecord, readJsonFile } from "./cliUtils";

/**
 * Run the backtest command using Yahoo candle data.
 */
export async function runBacktest(args: ParsedCliArgs): Promise<void> {
  // Step 1: Validate required flags and config input.
  const configPath = args.flags["config"];
  if (configPath === undefined) {
    throw new Error("Missing --config <path>.");
  }

  const start = args.flags["start"];
  const end = args.flags["end"];
  if (start === undefined || end === undefined) {
    throw new Error("Missing --start <date> or --end <date>.");
  }

  // Step 2: Load config and build strategy parameters.
  const outputPath = args.flags["output"];
  const config = loadConfig(configPath);

  const startIso = toIsoString(start);
  const endIso = toIsoString(end);

  const bt = await runBacktestWithYahoo({
    strategy: config.strategy,
    symbol: config.symbol,
    interval: config.interval,
    initialBalance: config.initialBalance,
    paramsBody: config.params,
    startDate: startIso.slice(0, 10),
    endDate: endIso.slice(0, 10)
  });

  if (!bt.ok) {
    throw new Error(bt.error);
  }

  const { result } = bt;
  const candleResult = { warnings: bt.candleWarnings };

  // Step 5: Print summary results and warnings.
  const lines = [
    "Running backtest...",
    `  Symbol: ${config.symbol}`,
    `  Interval: ${config.interval}`,
    `  Period: ${startIso} to ${endIso}`,
    `  Initial Equity: ${config.initialBalance}`,
    "",
    "Results:",
    `  Final Equity:       ${result.metrics.finalEquity.toFixed(2)}`,
    `  Total Return:       ${result.metrics.totalReturnPct.toFixed(2)}%`,
    `  Max Drawdown:       ${result.metrics.maxDrawdownPct.toFixed(2)}%`,
    `  Win Rate:           ${result.metrics.winRatePct.toFixed(2)}%`,
    `  Profit Factor:      ${formatProfitFactor(result.metrics.profitFactor)}`,
    `  Total Trades:       ${result.metrics.tradeCount}`
  ];
  console.log(lines.join("\n"));

  if (candleResult.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of candleResult.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Strategy Warnings:");
    for (const warning of result.warnings) {
      console.log(`  - ${warning.message}`);
    }
  }

  // Step 6: Persist results when output path is provided.
  if (outputPath !== undefined) {
    const payload = {
      config,
      params: { ...config.params, symbol: config.symbol, interval: config.interval },
      metrics: result.metrics,
      trades: result.trades,
      equity: result.equityPoints,
      warnings: result.warnings
    };
    const absolute = path.resolve(process.cwd(), outputPath);
    fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`✅ Results saved to: ${absolute}`);
  }
}

/**
 * Load a bot config from JSON.
 */
function loadConfig(pathValue: string): Readonly<{
  name: string;
  strategy: string;
  exchange: string;
  symbol: string;
  interval: string;
  initialBalance: number;
  riskManagement: Record<string, unknown>;
  params: Record<string, unknown>;
}> {
  // Step 1: Load raw JSON and validate required fields.
  const raw = readJsonFile(pathValue);
  if (!isRecord(raw)) {
    throw new Error("Config file must be a JSON object.");
  }
  const name = raw.name;
  const strategy = raw.strategy;
  const exchange = raw.exchange;
  const symbol = raw.symbol;
  const interval = raw.interval;
  const params = raw.params;
  if (!isRecord(params)) {
    throw new Error("Config params must be an object.");
  }
  const risk = raw.riskManagement;
  if (!isRecord(risk)) {
    throw new Error("Config riskManagement must be an object.");
  }
  const initialBalance = Number(raw.initialBalance);
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    throw new Error("Config initialBalance must be a positive number.");
  }

  assertNonEmptyString(name, "config.name");
  assertNonEmptyString(strategy, "config.strategy");
  assertNonEmptyString(exchange, "config.exchange");
  assertNonEmptyString(symbol, "config.symbol");
  assertNonEmptyString(interval, "config.interval");

  // Step 2: Normalize and return a typed config snapshot.
  return {
    name,
    strategy,
    exchange,
    symbol,
    interval,
    initialBalance,
    riskManagement: risk,
    params
  };
}

/**
 * Convert a date string into an ISO string, validating parseability.
 */
function toIsoString(value: string): string {
  // Step 1: Validate parsable date input.
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD or ISO format.`);
  }
  // Step 2: Return a normalized ISO timestamp.
  return new Date(parsed).toISOString();
}

/**
 * Format profit factor for display.
 */
function formatProfitFactor(value: number): string {
  // Step 1: Handle non-finite values gracefully.
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(2);
}
