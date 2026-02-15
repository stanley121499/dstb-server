/**
 * @file End-to-end paper trading validation script.
 *
 * This script starts a paper trading bot, performs periodic validations,
 * and compares final performance against backtest expectations.
 */

import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import { createExchangeAdapter } from "../exchange/createAdapter.js";
import { createSupabaseServerClient } from "../supabase/client.js";
import { readEnv } from "../server/env.js";
import { BotLifecycleManager } from "./BotLifecycleManager.js";
import { botConfigSchema } from "./botConfigSchema.js";
import type { BotConfig } from "./botConfigSchema.js";
import { PerformanceMonitor } from "./PerformanceMonitor.js";
import type { PerformanceReport } from "./PerformanceMonitor.js";
import { RiskManager } from "./RiskManager.js";

type MetricKey = "totalReturn" | "sharpe" | "profitFactor" | "winRate";

type ParsedArgs = Readonly<{
  configPath?: string;
  inputPath: string;
  metric: MetricKey;
  hours: number;
  variancePct: number;
  checkIntervalMinutes: number;
}>;

type BacktestMetrics = Readonly<{
  totalReturnPct: number | null;
  sharpe: number | null;
  profitFactor: number | null;
  winRatePct: number | null;
}>;

type ValidationSnapshot = Readonly<{
  signals: number;
  orders: number;
  filledOrders: number;
  positions: number;
  trades: number;
  snapshots: number;
  logs: number;
  heartbeatOk: boolean;
  riskLimitOk: boolean;
}>;

const metricSchema = z.union([
  z.literal("totalReturn"),
  z.literal("sharpe"),
  z.literal("profitFactor"),
  z.literal("winRate")
]);

const runSchema = z
  .object({
    runId: z.string().min(1),
    status: z.string().min(1),
    symbol: z.string().min(1),
    interval: z.string().min(1),
    totalReturnPct: z.number().optional(),
    totalReturn: z.number().optional(),
    sharpe: z.number().optional(),
    sharpeRatio: z.number().optional(),
    profitFactor: z.number().optional(),
    winRatePct: z.number().optional(),
    winRate: z.number().optional(),
    params: strategyParamsSchema
  })
  .passthrough();

/**
 * Parses CLI flags for the paper trading test.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // Step 1: Initialize defaults.
  const defaults: ParsedArgs = {
    inputPath: "optimization-results/run2.jsonl",
    metric: "totalReturn",
    hours: 48,
    variancePct: 5,
    checkIntervalMinutes: 30
  };

  // Step 2: Collect flag values.
  const flags: Record<string, string> = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      index += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }
    const key = token.slice(2).trim();
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for flag "--${key}".`);
    }
    flags[key] = value;
    index += 2;
  }

  // Step 3: Resolve numeric inputs.
  const hours = flags.hours === undefined ? defaults.hours : Number(flags.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Expected --hours to be a positive number.");
  }

  const variancePct = flags.variance === undefined ? defaults.variancePct : Number(flags.variance);
  if (!Number.isFinite(variancePct) || variancePct <= 0) {
    throw new Error("Expected --variance to be a positive number.");
  }

  const checkIntervalMinutes =
    flags.checkIntervalMinutes === undefined ? defaults.checkIntervalMinutes : Number(flags.checkIntervalMinutes);
  if (!Number.isFinite(checkIntervalMinutes) || checkIntervalMinutes <= 0) {
    throw new Error("Expected --checkIntervalMinutes to be a positive number.");
  }

  // Step 4: Validate metric selection.
  const metricValue = flags.metric === undefined ? defaults.metric : metricSchema.parse(flags.metric);

  // Step 5: Return parsed arguments.
  const result: ParsedArgs =
    flags.config !== undefined
      ? {
          configPath: flags.config,
          inputPath: flags.input ?? defaults.inputPath,
          metric: metricValue,
          hours,
          variancePct,
          checkIntervalMinutes
        }
      : {
          inputPath: flags.input ?? defaults.inputPath,
          metric: metricValue,
          hours,
          variancePct,
          checkIntervalMinutes
        };

  return result;
}

/**
 * Loads a JSON file relative to the working directory.
 */
async function readJsonFile(pathValue: string): Promise<unknown> {
  // Step 1: Resolve the absolute path.
  const absolute = resolve(process.cwd(), pathValue);
  // Step 2: Read the file from disk.
  const raw = await readFile(absolute, { encoding: "utf-8" });
  // Step 3: Parse JSON.
  return JSON.parse(raw) as unknown;
}

/**
 * Loads optimization runs from a JSONL file.
 */
async function loadOptimizationRuns(pathValue: string): Promise<readonly z.infer<typeof runSchema>[]> {
  // Step 1: Resolve and read the file.
  const absolute = resolve(process.cwd(), pathValue);
  const raw = await readFile(absolute, { encoding: "utf-8" });
  // Step 2: Split into lines and parse JSON.
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const runs: z.infer<typeof runSchema>[] = [];
  for (const line of lines) {
    const parsed = JSON.parse(line) as unknown;
    const result = runSchema.safeParse(parsed);
    if (result.success) {
      runs.push(result.data);
    }
  }
  return runs;
}

/**
 * Metric extractors keyed by metric name.
 */
const metricExtractors: Record<MetricKey, (run: z.infer<typeof runSchema>) => number | null> = {
  totalReturn: (run) => {
    const pct = run.totalReturnPct;
    if (typeof pct === "number" && Number.isFinite(pct)) {
      return pct;
    }
    const raw = run.totalReturn;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  },
  winRate: (run) => {
    const pct = run.winRatePct;
    if (typeof pct === "number" && Number.isFinite(pct)) {
      return pct;
    }
    const raw = run.winRate;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  },
  profitFactor: (run) => {
    const profit = run.profitFactor;
    return typeof profit === "number" && Number.isFinite(profit) ? profit : null;
  },
  sharpe: (run) => {
    const sharpe = run.sharpe ?? run.sharpeRatio ?? null;
    return typeof sharpe === "number" && Number.isFinite(sharpe) ? sharpe : null;
  }
};

/**
 * Extracts a metric value for ranking runs.
 */
function extractMetric(metric: MetricKey, run: z.infer<typeof runSchema>): number | null {
  // Step 1: Delegate to the metric extractor.
  return metricExtractors[metric](run);
}

/**
 * Selects the best optimization run by the requested metric.
 */
function selectBestRun(metric: MetricKey, runs: readonly z.infer<typeof runSchema>[]): z.infer<typeof runSchema> {
  // Step 1: Filter completed runs only.
  const completed = runs.filter((run) => run.status === "completed");
  if (completed.length === 0) {
    throw new Error("No completed optimization runs found.");
  }

  // Step 2: Rank by metric value.
  let best: z.infer<typeof runSchema> | null = null;
  let bestValue: number | null = null;
  for (const run of completed) {
    const value = extractMetric(metric, run);
    if (value === null || !Number.isFinite(value)) {
      continue;
    }
    if (best === null || bestValue === null || value > bestValue) {
      best = run;
      bestValue = value;
    }
  }

  // Step 3: Ensure we found a valid run.
  if (best === null) {
    throw new Error(`No runs contained a usable "${metric}" metric.`);
  }
  return best;
}

/**
 * Builds a paper trading bot config from optimization parameters.
 */
function buildPaperBotConfig(run: z.infer<typeof runSchema>): BotConfig {
  // Step 1: Ensure params are valid.
  const params = strategyParamsSchema.parse(run.params);
  // Step 2: Build a paper trading config.
  return botConfigSchema.parse({
    name: `paper-${params.symbol}-${params.interval}`,
    exchange: "paper",
    symbol: params.symbol,
    interval: params.interval,
    initialBalance: 10000,
    riskManagement: {
      maxDailyLossPct: 5,
      maxPositionSizePct: 25
    },
    params
  });
}

/**
 * Loads or builds a bot config for the test run.
 */
async function resolveBotConfig(args: ParsedArgs): Promise<{
  config: BotConfig;
  expected: BacktestMetrics;
}> {
  // Step 1: Use explicit config when provided.
  if (args.configPath !== undefined) {
    const configRaw = await readJsonFile(args.configPath);
    const config = botConfigSchema.parse(configRaw);
    return {
      config,
      expected: {
        totalReturnPct: null,
        sharpe: null,
        profitFactor: null,
        winRatePct: null
      }
    };
  }

  // Step 2: Load optimization runs for best params.
  const runs = await loadOptimizationRuns(args.inputPath);
  const best = selectBestRun(args.metric, runs);

  // Step 3: Build a paper config from the selected run.
  const config = buildPaperBotConfig(best);

  // Step 4: Store expected backtest metrics for comparisons.
  return {
    config,
    expected: {
      totalReturnPct: best.totalReturnPct ?? best.totalReturn ?? null,
      sharpe: best.sharpe ?? best.sharpeRatio ?? null,
      profitFactor: best.profitFactor ?? null,
      winRatePct: best.winRatePct ?? best.winRate ?? null
    }
  };
}

/**
 * Loads counts and status information for validation.
 */
async function collectValidationSnapshot(supabase: ReturnType<typeof createSupabaseServerClient>, botId: string): Promise<ValidationSnapshot> {
  // Step 1: Count signals.
  const signalResult = await supabase
    .from("bot_logs")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("category", "signal");
  if (signalResult.error !== null) {
    throw signalResult.error;
  }

  // Step 2: Count orders.
  const ordersResult = await supabase
    .from("live_orders")
    .select("id,status", { count: "exact", head: true })
    .eq("bot_id", botId);
  if (ordersResult.error !== null) {
    throw ordersResult.error;
  }

  // Step 3: Count filled orders.
  const filledResult = await supabase
    .from("live_orders")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("status", "filled");
  if (filledResult.error !== null) {
    throw filledResult.error;
  }

  // Step 4: Count positions.
  const positionsResult = await supabase
    .from("live_positions")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId);
  if (positionsResult.error !== null) {
    throw positionsResult.error;
  }

  // Step 5: Count trades.
  const tradesResult = await supabase
    .from("live_trades")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId);
  if (tradesResult.error !== null) {
    throw tradesResult.error;
  }

  // Step 6: Count account snapshots.
  const snapshotsResult = await supabase
    .from("account_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId);
  if (snapshotsResult.error !== null) {
    throw snapshotsResult.error;
  }

  // Step 7: Count overall logs.
  const logsResult = await supabase
    .from("bot_logs")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId);
  if (logsResult.error !== null) {
    throw logsResult.error;
  }

  // Step 8: Validate heartbeat freshness.
  const botResult = await supabase.from("bots").select("id,last_heartbeat_at,max_daily_loss_pct").eq("id", botId).single();
  if (botResult.error !== null || botResult.data === null) {
    throw botResult.error ?? new Error("Failed to load bot for heartbeat validation.");
  }
  const lastHeartbeat = botResult.data.last_heartbeat_at === null ? null : Date.parse(botResult.data.last_heartbeat_at);
  const heartbeatOk = lastHeartbeat !== null && Date.now() - lastHeartbeat < 2 * 60 * 1000;

  // Step 9: Validate daily loss limit is set.
  const riskLimitOk = Number.isFinite(botResult.data.max_daily_loss_pct) && Number(botResult.data.max_daily_loss_pct) > 0;

  return {
    signals: signalResult.count ?? 0,
    orders: ordersResult.count ?? 0,
    filledOrders: filledResult.count ?? 0,
    positions: positionsResult.count ?? 0,
    trades: tradesResult.count ?? 0,
    snapshots: snapshotsResult.count ?? 0,
    logs: logsResult.count ?? 0,
    heartbeatOk,
    riskLimitOk
  };
}

/**
 * Calculates percentage variance between expected and actual values.
 */
function calculateVariancePct(expected: number, actual: number): number {
  // Step 1: Compute the absolute difference.
  const diff = Math.abs(actual - expected);
  // Step 2: Normalize by expected magnitude.
  const denominator = Math.max(1, Math.abs(expected));
  // Step 3: Convert to percentage.
  return (diff / denominator) * 100;
}

/**
 * Ensures the validation snapshot meets minimum expectations.
 */
function assertValidationSnapshot(snapshot: ValidationSnapshot): void {
  // Step 1: Ensure signals were generated.
  if (snapshot.signals === 0) {
    throw new Error("No signals were generated during the paper trading run.");
  }
  // Step 2: Ensure orders were created.
  if (snapshot.orders === 0) {
    throw new Error("No orders were created during the paper trading run.");
  }
  // Step 3: Ensure orders were filled.
  if (snapshot.filledOrders === 0) {
    throw new Error("No orders were filled during the paper trading run.");
  }
  // Step 4: Ensure positions were tracked.
  if (snapshot.positions === 0) {
    throw new Error("No positions were tracked during the paper trading run.");
  }
  // Step 5: Ensure snapshots exist.
  if (snapshot.snapshots === 0) {
    throw new Error("No P&L snapshots were captured during the paper trading run.");
  }
  // Step 6: Ensure logs were written.
  if (snapshot.logs === 0) {
    throw new Error("No logs were written during the paper trading run.");
  }
  // Step 7: Ensure heartbeat freshness.
  if (!snapshot.heartbeatOk) {
    throw new Error("Heartbeat updates are stale or missing.");
  }
  // Step 8: Ensure risk limits are configured.
  if (!snapshot.riskLimitOk) {
    throw new Error("Risk limits are missing or invalid.");
  }
}

/**
 * Compares live performance against backtest expectations.
 */
function comparePerformance(
  expected: BacktestMetrics,
  performance: PerformanceReport,
  variancePct: number
): string[] {
  // Step 1: Collect comparison outputs.
  const comparisons: string[] = [];

  // Step 2: Validate total return.
  if (expected.totalReturnPct !== null) {
    const variance = calculateVariancePct(expected.totalReturnPct, performance.totalReturnPct);
    comparisons.push(`totalReturnPct variance=${variance.toFixed(2)}%`);
    if (variance > variancePct) {
      throw new Error(`Total return variance exceeded ${variancePct}% (got ${variance.toFixed(2)}%).`);
    }
  }

  // Step 3: Validate win rate.
  if (expected.winRatePct !== null) {
    const variance = calculateVariancePct(expected.winRatePct, performance.winRatePct);
    comparisons.push(`winRatePct variance=${variance.toFixed(2)}%`);
    if (variance > variancePct) {
      throw new Error(`Win rate variance exceeded ${variancePct}% (got ${variance.toFixed(2)}%).`);
    }
  }

  // Step 4: Validate profit factor.
  if (expected.profitFactor !== null && performance.profitFactor !== null) {
    const variance = calculateVariancePct(expected.profitFactor, performance.profitFactor);
    comparisons.push(`profitFactor variance=${variance.toFixed(2)}%`);
    if (variance > variancePct) {
      throw new Error(`Profit factor variance exceeded ${variancePct}% (got ${variance.toFixed(2)}%).`);
    }
  }

  // Step 5: Validate sharpe ratio.
  if (expected.sharpe !== null && performance.sharpeRatio !== null) {
    const variance = calculateVariancePct(expected.sharpe, performance.sharpeRatio);
    comparisons.push(`sharpe variance=${variance.toFixed(2)}%`);
    if (variance > variancePct) {
      throw new Error(`Sharpe variance exceeded ${variancePct}% (got ${variance.toFixed(2)}%).`);
    }
  }

  return comparisons;
}

/**
 * Sleeps for the requested duration.
 */
async function sleepMs(ms: number): Promise<void> {
  // Step 1: Wrap setTimeout in a promise.
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes the paper trading test flow.
 */
async function main(): Promise<void> {
  // Step 1: Parse CLI flags.
  const args = parseArgs(process.argv.slice(2));

  // Step 2: Resolve bot config and backtest expectations.
  const { config, expected } = await resolveBotConfig(args);
  if (config.exchange !== "paper") {
    throw new Error("Paper trading test requires exchange to be set to \"paper\".");
  }

  // Step 3: Prepare Supabase client and manager.
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const manager = new BotLifecycleManager({ supabase });

  // Step 4: Start the bot.
  const bot = await manager.startBot(config);
  console.log(`Started paper bot ${bot.id} for ${args.hours} hours.`);

  // Step 5: Create a risk manager for quick checks.
  const riskAdapter = createExchangeAdapter({
    type: "paper",
    symbol: config.symbol,
    interval: config.interval,
    initialBalance: config.initialBalance,
    feesBps: config.params.execution.feeBps,
    slippageBps: config.params.execution.slippageBps,
    currency: "USD"
  });
  const riskManager = new RiskManager({
    supabase,
    adapter: riskAdapter,
    botId: bot.id,
    params: config.params
  });

  // Step 6: Run periodic validation checks until the end time.
  const deadlineMs = Date.now() + args.hours * 60 * 60 * 1000;
  let lastSnapshot: ValidationSnapshot | null = null;
  try {
    while (Date.now() < deadlineMs) {
      const snapshot = await collectValidationSnapshot(supabase, bot.id);
      lastSnapshot = snapshot;

      const riskStatus = await riskManager.checkDailyLoss(bot.id);
      const riskLimitOk = riskStatus.limit > 0 && !Number.isNaN(riskStatus.limit);

      console.log(
        [
          "[paper-test] snapshot",
          `signals=${snapshot.signals}`,
          `orders=${snapshot.orders}`,
          `filled=${snapshot.filledOrders}`,
          `positions=${snapshot.positions}`,
          `trades=${snapshot.trades}`,
          `snapshots=${snapshot.snapshots}`,
          `logs=${snapshot.logs}`,
          `heartbeatOk=${snapshot.heartbeatOk}`,
          `riskLimitOk=${riskLimitOk}`
        ].join(" ")
      );

      await sleepMs(args.checkIntervalMinutes * 60 * 1000);
    }
  } finally {
    // Step 7: Stop the bot regardless of test outcome.
    await manager.stopBot(bot.id, true);
  }

  // Step 8: Assert validation requirements after the run.
  if (lastSnapshot === null) {
    throw new Error("No validation snapshots captured.");
  }
  assertValidationSnapshot(lastSnapshot);

  // Step 9: Compare live performance with backtest expectations.
  const days = Math.max(1, Math.ceil(args.hours / 24));
  const monitor = new PerformanceMonitor({ supabase, botId: bot.id, exchange: config.exchange });
  const performance = await monitor.calculatePerformance(bot.id, days);

  const comparisons = comparePerformance(expected, performance, args.variancePct);

  if (comparisons.length === 0) {
    console.warn("No comparable metrics were available for backtest validation.");
  } else {
    console.log(`Backtest comparison passed: ${comparisons.join(", ")}`);
  }

  // Step 10: Final success output.
  console.log("Paper trading validation complete.");
}

try {
  await main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[paper-test] Fatal error: ${message}`);
  process.exitCode = 1;
}
