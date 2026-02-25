import fs from "node:fs";
import path from "node:path";

import type { ExchangeCandle } from "../exchange/types.js";
import { intervalToMs } from "../utils/interval.js";
import { strategyParamsSchema } from "../domain/strategyParams.js";
import { ConfigLoader } from "../core/ConfigLoader";
import { Logger } from "../core/Logger";
import { StateManager } from "../core/StateManager";
import { TradingBot } from "../core/TradingBot";
import type { BotConfig } from "../core/types";
import type { Candle as StrategyCandle, IStrategy, Position as StrategyPosition, Signal } from "../strategies/IStrategy";
import { ReplayExchangeAdapter } from "./helpers/replayAdapter";

type ParsedArgs = Readonly<{
  configPath: string;
  candleCount: number;
  outputDir: string;
}>;

type BenchmarkReport = Readonly<{
  configPath: string;
  candleCount: number;
  intervalMs: number;
  durationMs: number;
  candlesPerSecond: number;
  candlesPerDayCapacity: number;
  memoryRssBytes: number;
  memoryDeltaBytes: number;
  cpuUsagePct: number;
  thresholds: Readonly<{
    candlesPerDay: number;
    maxMemoryBytes: number;
    maxCpuPct: number;
  }>;
  pass: Readonly<{
    throughput: boolean;
    memory: boolean;
    cpu: boolean;
    memoryLeakSuspected: boolean;
  }>;
}>;

/**
 * Parse CLI args for performance benchmark.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // Step 1: Set defaults.
  const defaults = {
    configPath: "configs/strategies/orb-btc-15m.json",
    candleCount: 1000,
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

  // Step 3: Validate candle count.
  const candleCount = flags.candles === undefined ? defaults.candleCount : Number(flags.candles);
  if (!Number.isFinite(candleCount) || candleCount <= 0) {
    throw new Error("Expected --candles to be a positive number.");
  }

  // Step 4: Return parsed args.
  return {
    configPath: flags.config ?? defaults.configPath,
    candleCount,
    outputDir: flags.outputDir ?? defaults.outputDir
  };
}

/**
 * Build deterministic candles for benchmark.
 */
function buildSyntheticCandles(args: Readonly<{ startTimeMs: number; intervalMs: number; count: number }>): ExchangeCandle[] {
  // Step 1: Validate inputs.
  if (!Number.isFinite(args.startTimeMs)) {
    throw new Error("startTimeMs must be a finite number.");
  }
  if (!Number.isFinite(args.intervalMs) || args.intervalMs <= 0) {
    throw new Error("intervalMs must be a positive number.");
  }
  if (!Number.isFinite(args.count) || args.count <= 0) {
    throw new Error("count must be a positive number.");
  }

  // Step 2: Generate a deterministic wave.
  const candles: ExchangeCandle[] = [];
  const basePrice = 100;
  const volatility = 2;
  for (let index = 0; index < args.count; index += 1) {
    const timeUtcMs = args.startTimeMs + index * args.intervalMs;
    const wave = Math.sin(index / 5);
    const open = basePrice + wave * volatility;
    const close = basePrice + Math.sin((index + 1) / 5) * volatility;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    candles.push({
      timeUtcMs,
      open,
      high,
      low,
      close,
      volume: 1000 + index
    });
  }

  // Step 3: Return candles.
  return candles;
}

/**
 * Minimal strategy that always holds for benchmark runs.
 */
class HoldStrategy implements IStrategy {
  public name = "hold-benchmark";
  public warmupPeriod = 0;

  initialize(_candles: StrategyCandle[]): void {
    return;
  }

  onCandle(candle: StrategyCandle, _position: StrategyPosition | null): Signal {
    return {
      type: "HOLD",
      price: candle.close,
      reason: "benchmark-hold"
    };
  }

  onFill(_position: StrategyPosition): void {
    return;
  }

  getState(): Record<string, unknown> {
    return {};
  }
}

/**
 * Runs the performance benchmark and returns report data.
 */
async function runBenchmark(
  config: BotConfig,
  configPath: string,
  candleCount: number
): Promise<BenchmarkReport> {
  // Step 1: Prepare state and candles.
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "data", "benchmark-"));
  const logDir = path.join(tempDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logger = new Logger("benchmark", logDir);
  const dbPath = path.join(tempDir, "bot-state.db");
  const schemaPath = path.join(process.cwd(), "data", "schema.sql");
  const state = new StateManager({ dbPath, schemaPath, logger });
  const intervalMs = intervalToMs(config.interval);
  const candles = buildSyntheticCandles({
    startTimeMs: Date.now() - intervalMs * candleCount,
    intervalMs,
    count: candleCount
  });

  // Step 2: Build replay adapter and bot.
  const adapter = new ReplayExchangeAdapter({
    candles,
    symbol: config.symbol,
    interval: strategyParamsSchema.shape.interval.parse(config.interval),
    initialBalance: config.initialBalance,
    feeBps: 0,
    slippageBps: 0
  });
  const bot = new TradingBot({
    config,
    strategy: new HoldStrategy(),
    exchange: adapter,
    stateManager: state,
    logger,
    maxIterations: candleCount,
    candleIntervalMsOverride: 1
  });

  // Step 3: Measure CPU/memory usage.
  const cpuStart = process.cpuUsage();
  const memStart = process.memoryUsage().rss;
  const startedAt = Date.now();
  await adapter.connect();
  await bot.start();
  const durationMs = Date.now() - startedAt;
  const cpuEnd = process.cpuUsage(cpuStart);
  const memEnd = process.memoryUsage().rss;

  // Step 4: Compute performance metrics.
  const cpuMicros = cpuEnd.user + cpuEnd.system;
  const cpuUsagePct = durationMs > 0 ? (cpuMicros / (durationMs * 1000)) * 100 : 0;
  const candlesPerSecond = durationMs > 0 ? candleCount / (durationMs / 1000) : 0;
  const candlesPerDayCapacity = candlesPerSecond * 24 * 60 * 60;
  const memoryDeltaBytes = memEnd - memStart;

  // Step 5: Apply thresholds.
  const thresholds = {
    candlesPerDay: 1000,
    maxMemoryBytes: 500 * 1024 * 1024,
    maxCpuPct: 50
  };
  const pass = {
    throughput: candlesPerDayCapacity >= thresholds.candlesPerDay,
    memory: memEnd <= thresholds.maxMemoryBytes,
    cpu: cpuUsagePct <= thresholds.maxCpuPct,
    memoryLeakSuspected: memoryDeltaBytes > 50 * 1024 * 1024
  };

  // Step 6: Return report.
  return {
    configPath,
    candleCount,
    intervalMs,
    durationMs,
    candlesPerSecond,
    candlesPerDayCapacity,
    memoryRssBytes: memEnd,
    memoryDeltaBytes,
    cpuUsagePct,
    thresholds,
    pass
  };
}

/**
 * Writes benchmark report outputs to disk.
 */
function writeReport(report: BenchmarkReport, outputDir: string): void {
  // Step 1: Ensure output directory exists.
  fs.mkdirSync(outputDir, { recursive: true });

  // Step 2: Write JSON output.
  const jsonPath = path.join(outputDir, "performance-benchmark.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), { encoding: "utf8" });

  // Step 3: Write markdown summary.
  const mdLines = [
    "# Performance Benchmark Report",
    "",
    `Config: ${report.configPath}`,
    `Candle Count: ${report.candleCount}`,
    `Interval: ${report.intervalMs} ms`,
    `Duration: ${report.durationMs} ms`,
    "",
    "## Throughput",
    `Candles/sec: ${report.candlesPerSecond.toFixed(2)}`,
    `Candles/day capacity: ${Math.round(report.candlesPerDayCapacity)}`,
    `Threshold: ${report.thresholds.candlesPerDay}`,
    `Pass: ${report.pass.throughput ? "YES" : "NO"}`,
    "",
    "## Memory",
    `RSS: ${(report.memoryRssBytes / (1024 * 1024)).toFixed(2)} MB`,
    `Delta: ${(report.memoryDeltaBytes / (1024 * 1024)).toFixed(2)} MB`,
    `Threshold: ${(report.thresholds.maxMemoryBytes / (1024 * 1024)).toFixed(0)} MB`,
    `Pass: ${report.pass.memory ? "YES" : "NO"}`,
    `Leak Suspected: ${report.pass.memoryLeakSuspected ? "YES" : "NO"}`,
    "",
    "## CPU",
    `CPU Usage: ${report.cpuUsagePct.toFixed(2)}%`,
    `Threshold: ${report.thresholds.maxCpuPct}%`,
    `Pass: ${report.pass.cpu ? "YES" : "NO"}`
  ];
  const mdPath = path.join(outputDir, "performance-benchmark.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"), { encoding: "utf8" });
}

/**
 * Executes the performance benchmark.
 */
async function main(): Promise<void> {
  // Step 1: Parse args and load config.
  const args = parseArgs(process.argv.slice(2));
  const config = ConfigLoader.loadBotConfig(args.configPath);

  // Step 2: Run benchmark and write reports.
  const report = await runBenchmark(config, args.configPath, args.candleCount);
  writeReport(report, args.outputDir);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Performance benchmark failed: ${message}`);
  process.exitCode = 1;
});
