import fs from "node:fs";
import path from "node:path";

import type { Candle } from "../../apps/api/src/data/yahooFinance.js";
import { fetchBinanceCandles } from "../../apps/api/src/data/binanceDataSource.js";
import { runBacktest } from "../../apps/api/src/backtest/runBacktest.js";
import { strategyParamsSchema } from "../../apps/api/src/domain/strategyParams.js";
import { ConfigLoader } from "../core/ConfigLoader";
import { Logger } from "../core/Logger";
import { StateManager } from "../core/StateManager";
import { TradingBot } from "../core/TradingBot";
import { createStrategy } from "../strategies/factory";
import type { BotConfig } from "../core/types";
import { ReplayExchangeAdapter } from "./helpers/replayAdapter";

type ParsedArgs = Readonly<{
  configPath: string;
  hours: number;
  variancePct: number;
  startTimeUtc: string;
  endTimeUtc: string;
  outputDir: string;
}>;

type PaperMetrics = Readonly<{
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number | null;
  tradeCount: number;
  finalEquity: number;
}>;

type ComparisonReport = Readonly<{
  configPath: string;
  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  variancePct: number;
  backtest: Readonly<{
    totalReturnPct: number;
    winRatePct: number;
    profitFactor: number;
    tradeCount: number;
    finalEquity: number;
  }>;
  paper: PaperMetrics;
  variance: Readonly<{
    totalReturnPctDiff: number;
    withinThreshold: boolean;
  }>;
}>;

/**
 * Parse CLI args for paper trading validation.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // Step 1: Initialize defaults.
  const defaults = {
    configPath: "configs/strategies/orb-btc-15m.json",
    hours: 48,
    variancePct: 5,
    outputDir: "docs/reports"
  };

  // Step 2: Collect flag values.
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for flag "--${key}".`);
    }
    flags[key] = value;
    index += 1;
  }

  // Step 3: Resolve time window.
  const hours = flags.hours === undefined ? defaults.hours : Number(flags.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Expected --hours to be a positive number.");
  }
  const now = new Date();
  const endTimeUtc = flags.end ?? now.toISOString();
  const endMs = new Date(endTimeUtc).getTime();
  if (!Number.isFinite(endMs)) {
    throw new Error("Invalid --end timestamp.");
  }
  const startTimeUtc = flags.start ?? new Date(endMs - hours * 60 * 60 * 1000).toISOString();
  const startMs = new Date(startTimeUtc).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error("Invalid --start timestamp.");
  }
  if (startMs >= endMs) {
    throw new Error("Start time must be before end time.");
  }

  // Step 4: Resolve variance and output path.
  const variancePct = flags.variance === undefined ? defaults.variancePct : Number(flags.variance);
  if (!Number.isFinite(variancePct) || variancePct <= 0) {
    throw new Error("Expected --variance to be a positive number.");
  }

  // Step 5: Return parsed values.
  return {
    configPath: flags.config ?? defaults.configPath,
    hours,
    variancePct,
    startTimeUtc,
    endTimeUtc,
    outputDir: flags.outputDir ?? defaults.outputDir
  };
}

/**
 * Compute summary metrics from paper trading trades.
 */
function computePaperMetrics(trades: readonly Readonly<{ pnl: number }>[], initialBalance: number): PaperMetrics {
  // Step 1: Aggregate PnL stats.
  const tradeCount = trades.length;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const winners = trades.filter((trade) => trade.pnl > 0);
  const losers = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));

  // Step 2: Compute derived metrics.
  const totalReturnPct = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;
  const winRatePct = tradeCount > 0 ? (winners.length / tradeCount) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const finalEquity = initialBalance + totalPnl;

  // Step 3: Return metrics.
  return {
    totalReturnPct,
    winRatePct,
    profitFactor,
    tradeCount,
    finalEquity
  };
}

/**
 * Runs a deterministic paper trading replay and returns metrics.
 */
async function runPaperReplay(
  config: BotConfig,
  candles: readonly Candle[],
  execution: Readonly<{ feeBps: number; slippageBps: number }>
): Promise<PaperMetrics> {
  // Step 1: Create temporary state storage.
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "data", "paper-validation-"));
  const logDir = path.join(tempDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logger = new Logger("paper-validation", logDir);
  const dbPath = path.join(tempDir, "bot-state.db");
  const schemaPath = path.join(process.cwd(), "data", "schema.sql");
  const state = new StateManager({ dbPath, schemaPath, logger });

  // Step 2: Build exchange adapter and bot dependencies.
  const strategy = createStrategy(config.strategy, config.params);
  const adapter = new ReplayExchangeAdapter({
    candles,
    symbol: config.symbol,
    interval: strategyParamsSchema.shape.interval.parse(config.interval),
    initialBalance: config.initialBalance,
    feeBps: execution.feeBps,
    slippageBps: execution.slippageBps
  });
  const bot = new TradingBot({
    config,
    strategy,
    exchange: adapter,
    stateManager: state,
    logger,
    maxIterations: candles.length,
    candleIntervalMsOverride: 1
  });

  // Step 3: Run the replay.
  await adapter.connect();
  await bot.start();

  // Step 4: Compute metrics from trades.
  const trades = await state.getTrades(bot.getId());
  return computePaperMetrics(trades, config.initialBalance);
}

/**
 * Writes a JSON report and markdown summary to disk.
 */
function writeReport(report: ComparisonReport, outputDir: string): void {
  // Step 1: Ensure output directory exists.
  fs.mkdirSync(outputDir, { recursive: true });

  // Step 2: Write JSON output.
  const jsonPath = path.join(outputDir, "paper-trading-comparison.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), { encoding: "utf8" });

  // Step 3: Write markdown summary.
  const mdLines = [
    "# Paper Trading Comparison Report",
    "",
    `Config: ${report.configPath}`,
    `Symbol: ${report.symbol}`,
    `Interval: ${report.interval}`,
    `Window: ${report.startTimeUtc} → ${report.endTimeUtc}`,
    "",
    "## Backtest",
    `Total Return: ${report.backtest.totalReturnPct.toFixed(2)}%`,
    `Win Rate: ${report.backtest.winRatePct.toFixed(2)}%`,
    `Profit Factor: ${report.backtest.profitFactor.toFixed(2)}`,
    `Trades: ${report.backtest.tradeCount}`,
    `Final Equity: ${report.backtest.finalEquity.toFixed(2)}`,
    "",
    "## Paper Replay",
    `Total Return: ${report.paper.totalReturnPct.toFixed(2)}%`,
    `Win Rate: ${report.paper.winRatePct.toFixed(2)}%`,
    `Profit Factor: ${report.paper.profitFactor === null ? "N/A" : report.paper.profitFactor.toFixed(2)}`,
    `Trades: ${report.paper.tradeCount}`,
    `Final Equity: ${report.paper.finalEquity.toFixed(2)}`,
    "",
    "## Variance Check",
    `Total Return Difference: ${report.variance.totalReturnPctDiff.toFixed(2)}%`,
    `Within Threshold: ${report.variance.withinThreshold ? "YES" : "NO"}`
  ];
  const mdPath = path.join(outputDir, "paper-trading-comparison.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"), { encoding: "utf8" });
}

/**
 * Executes the paper trading validation flow.
 */
async function main(): Promise<void> {
  // Step 1: Parse CLI args and load config.
  const args = parseArgs(process.argv.slice(2));
  const config = ConfigLoader.loadBotConfig(args.configPath);
  if (config.exchange !== "paper") {
    throw new Error("Paper validation requires a paper exchange config.");
  }

  // Step 2: Fetch candles for the validation window.
  const candleResult = await fetchBinanceCandles({
    symbol: config.symbol,
    interval: strategyParamsSchema.shape.interval.parse(config.interval),
    startTimeUtc: args.startTimeUtc,
    endTimeUtc: args.endTimeUtc
  });
  if (candleResult.candles.length === 0) {
    throw new Error("No candles returned for the requested time window.");
  }

  // Step 3: Run backtest on the same candles.
  const params = strategyParamsSchema.parse({
    ...config.params,
    symbol: config.symbol,
    interval: config.interval
  });
  const backtest = runBacktest({
    runId: "paper-validation",
    candles: candleResult.candles,
    candlesSorted: true,
    params,
    startTimeUtc: args.startTimeUtc,
    endTimeUtc: args.endTimeUtc,
    initialEquity: config.initialBalance
  });

  // Step 4: Run paper replay using the same candles.
  const paper = await runPaperReplay(config, candleResult.candles, {
    feeBps: params.execution.feeBps,
    slippageBps: params.execution.slippageBps
  });

  // Step 5: Compare metrics and build report.
  const backtestReturn = backtest.metrics.totalReturnPct;
  const totalReturnPctDiff = Math.abs(paper.totalReturnPct - backtestReturn);
  const withinThreshold = totalReturnPctDiff <= args.variancePct;
  const report: ComparisonReport = {
    configPath: args.configPath,
    symbol: config.symbol,
    interval: config.interval,
    startTimeUtc: args.startTimeUtc,
    endTimeUtc: args.endTimeUtc,
    variancePct: args.variancePct,
    backtest: {
      totalReturnPct: backtest.metrics.totalReturnPct,
      winRatePct: backtest.metrics.winRatePct,
      profitFactor: backtest.metrics.profitFactor,
      tradeCount: backtest.metrics.tradeCount,
      finalEquity: backtest.metrics.finalEquity
    },
    paper,
    variance: {
      totalReturnPctDiff,
      withinThreshold
    }
  };

  // Step 6: Persist report files.
  writeReport(report, args.outputDir);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Paper validation failed: ${message}`);
  process.exitCode = 1;
});
