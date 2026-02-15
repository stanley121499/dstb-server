/**
 * @file High-performance in-memory batch backtest runner (JSON grid config).
 *
 * Goals:
 * - Read a JSON grid config describing symbols/intervals/date range + param overrides.
 * - Generate a Cartesian product of overrides.
 * - Fetch candles once per unique (symbol, interval, dateRange).
 * - Run backtests directly in-memory (no DB, no queue).
 * - Stream results to JSONL as they complete for Google Sheets analysis.
 *
 * Usage (from apps/api):
 *   npm run backtest:batch -- --config grid-config.json
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import { z } from "zod";

import { runBacktest } from "../backtest/runBacktest.js";
import { fetchBinanceCandles } from "../data/binanceDataSource.js";
import type { Candle, CandleFetchResult, YahooInterval } from "../data/yahooFinance.js";
import { strategyParamsSchema } from "../domain/strategyParams.js";
import type { StrategyParams } from "../domain/strategyParams.js";
import { setObjectPath } from "../utils/objectPath.js";

type OverrideValue = string | number | boolean;

type GridOverride = Readonly<{
  path: string;
  values: readonly OverrideValue[];
  description?: string;
}>;

type GridConfig = Readonly<{
  description?: string;
  symbols: readonly StrategyParams["symbol"][];
  intervals: readonly StrategyParams["interval"][];
  dateRange: Readonly<{ start: string; end: string }>;
  initialEquity: number;
  baseParams: Omit<StrategyParams, "symbol" | "interval">;
  overrides: readonly GridOverride[];
  options?: Readonly<{
    concurrency?: number;
    outputFile?: string;
  }>;
  notes?: readonly string[];
}>;

type BatchResultLine = Readonly<{
  runId: string;
  status: "completed" | "failed";
  symbol: StrategyParams["symbol"];
  interval: StrategyParams["interval"];
  finalEquity?: number;
  totalReturnPct?: number;
  maxDrawdownPct?: number;
  winRatePct?: number;
  profitFactor?: number;
  tradeCount?: number;
  params?: StrategyParams;
  dataFingerprint?: Record<string, unknown>;
  errorMessage?: string;
}>;

/**
 * Minimal `--flag value` argv parser.
 */
function parseArgv(argv: readonly string[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) {
      i += 1;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}". Expected flags like --config.`);
    }

    const key = token.slice(2).trim();
    if (key.length === 0) {
      throw new Error(`Invalid flag "${token}".`);
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for flag "--${key}".`);
    }

    out[key] = value;
    i += 2;
  }

  return out;
}

function isValidDateString(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function padNumber(n: number, width: number): string {
  const raw = String(n);
  if (raw.length >= width) return raw;
  return `${"0".repeat(width - raw.length)}${raw}`;
}

function resolveOutputPath(outputFile: string): string {
  return isAbsolute(outputFile) ? outputFile : join(process.cwd(), outputFile);
}

class JsonlWriter {
  private readonly filePath: string;
  private writeCount = 0;

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
  }

  public async writeLine(obj: unknown): Promise<void> {
    const line = `${JSON.stringify(obj)}\n`;
    await appendFile(this.filePath, line, "utf-8");
    this.writeCount += 1;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getWriteCount(): number {
    return this.writeCount;
  }
}

/**
 * Returns total number of combinations for the overrides list.
 */
function combinationsCount(overrides: readonly GridOverride[]): number {
  return overrides.reduce((acc, o) => acc * Math.max(1, o.values.length), 1);
}

/**
 * Lazily iterates override assignments (Cartesian product).
 *
 * Each yielded item is an array of `{ path, value }` pairs.
 */
function* iterateOverrideAssignments(
  overrides: readonly GridOverride[]
): Generator<readonly Readonly<{ path: string; value: OverrideValue }>[]> {
  if (overrides.length === 0) {
    yield [];
    return;
  }

  // Indices into each override.values array.
  const indices: number[] = overrides.map(() => 0);

  while (true) {
    const pairs = overrides.map((o, idx) => {
      const i = indices[idx] ?? 0;
      const value = o.values[i];
      if (value === undefined) {
        // Defensive; should not happen because indices are bounded below.
        throw new Error(`Override "${o.path}" has no value at index ${i}`);
      }
      return { path: o.path, value } as const;
    });
    yield pairs;

    // Increment like an odometer.
    let carryIndex = overrides.length - 1;
    while (carryIndex >= 0) {
      const o = overrides[carryIndex];
      if (o === undefined) {
        throw new Error("Override index out of range");
      }
      const next = (indices[carryIndex] ?? 0) + 1;
      if (next < o.values.length) {
        indices[carryIndex] = next;
        break;
      }
      indices[carryIndex] = 0;
      carryIndex -= 1;
    }

    if (carryIndex < 0) {
      return;
    }
  }
}

function buildParamsForRun(args: Readonly<{
  symbol: StrategyParams["symbol"];
  interval: StrategyParams["interval"];
  baseParams: GridConfig["baseParams"];
  assignments: readonly Readonly<{ path: string; value: OverrideValue }>[];
}>): StrategyParams {
  // Start from base params and then apply symbol/interval and overrides.
  let obj: Record<string, unknown> = {
    ...structuredClone(args.baseParams),
    symbol: args.symbol,
    interval: args.interval
  };

  for (const a of args.assignments) {
    obj = setObjectPath({ obj, path: a.path, value: a.value });
  }

  return strategyParamsSchema.parse(obj);
}

async function fetchCandlesOnce(args: Readonly<{
  symbol: StrategyParams["symbol"];
  interval: StrategyParams["interval"];
  startTimeUtc: string;
  endTimeUtc: string;
}>): Promise<CandleFetchResult> {
  // `fetchBinanceCandles` expects YahooInterval union; our interval values match the engine schema.
  const interval = args.interval as YahooInterval;
  return await fetchBinanceCandles({
    symbol: args.symbol,
    interval,
    startTimeUtc: args.startTimeUtc,
    endTimeUtc: args.endTimeUtc
  });
}

async function runWithConcurrency<T>(args: Readonly<{
  concurrency: number;
  nextItem: () => T | null;
  worker: (item: T) => Promise<void>;
}>): Promise<void> {
  const workerCount = Math.max(1, Math.floor(args.concurrency));

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const item = args.nextItem();
      if (item === null) {
        return;
      }
      await args.worker(item);
    }
  });

  await Promise.all(runners);
}

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));
  const configPath = z.object({ config: z.string().trim().min(1) }).strict().parse(flags).config;

  const configJsonRaw = await readFile(configPath, "utf-8");
  const configUnknown: unknown = JSON.parse(configJsonRaw);

  const gridConfigSchema = z
    .object({
      description: z.string().trim().min(1).optional(),
      symbols: z.array(z.enum(["BTC-USD", "ETH-USD", "ZEC-USD"])).min(1),
      intervals: z.array(z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"])).min(1),
      dateRange: z
        .object({
          start: z.string().trim().min(1).refine(isValidDateString, { message: "dateRange.start must be a valid date string" }),
          end: z.string().trim().min(1).refine(isValidDateString, { message: "dateRange.end must be a valid date string" })
        })
        .strict(),
      initialEquity: z.number().positive(),
      baseParams: z.unknown(),
      overrides: z
        .array(
          z
            .object({
              path: z.string().trim().min(1),
              values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
              description: z.string().trim().min(1).optional()
            })
            .strict()
        )
        .default([]),
      options: z
        .object({
          concurrency: z.number().int().min(1).max(256).optional(),
          outputFile: z.string().trim().min(1).optional()
        })
        .strict()
        .optional(),
      notes: z.array(z.string()).optional()
    })
    .strict()
    .superRefine((v, ctx) => {
      const startMs = Date.parse(v.dateRange.start);
      const endMs = Date.parse(v.dateRange.end);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= endMs) {
        ctx.addIssue({ code: "custom", path: ["dateRange", "start"], message: "dateRange.start must be < dateRange.end" });
      }
    });

  const parsed = gridConfigSchema.parse(configUnknown);

  // Validate baseParams by attempting to parse as StrategyParams without symbol/interval.
  // We do this by injecting a placeholder symbol/interval (will be overwritten per-run).
  const baseParamsValidated = strategyParamsSchema
    .omit({ symbol: true, interval: true })
    .parse(parsed.baseParams);

  const overrides: readonly GridOverride[] = parsed.overrides.map((o) => ({
    path: o.path,
    values: o.values,
    ...(o.description !== undefined ? { description: o.description } : {})
  }));

  const optionsClean = (() => {
    if (parsed.options === undefined) {
      return undefined;
    }
    const o: { concurrency?: number; outputFile?: string } = {};
    if (parsed.options.concurrency !== undefined) {
      o.concurrency = parsed.options.concurrency;
    }
    if (parsed.options.outputFile !== undefined) {
      o.outputFile = parsed.options.outputFile;
    }
    return Object.keys(o).length > 0 ? o : undefined;
  })();

  const config: GridConfig = {
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    ...(optionsClean !== undefined ? { options: optionsClean } : {}),
    symbols: parsed.symbols,
    intervals: parsed.intervals,
    dateRange: parsed.dateRange,
    initialEquity: parsed.initialEquity,
    baseParams: baseParamsValidated,
    overrides
  };

  const concurrency = config.options?.concurrency ?? 10;
  const sessionId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputFile = config.options?.outputFile ?? `optimization-results/batch-results-${sessionId}.jsonl`;
  const outputPathAbs = resolveOutputPath(outputFile);

  const writer = new JsonlWriter(outputPathAbs);
  await writer.init();

  console.log(`[Batch] Loaded config from: ${configPath}`);
  if (config.description !== undefined) {
    console.log(`[Batch] ${config.description}`);
  }

  const overrideCombos = combinationsCount(config.overrides);
  const totalTests = config.symbols.length * config.intervals.length * overrideCombos;
  console.log(`[Batch] Generated ${totalTests.toLocaleString()} backtests (${config.symbols.length} symbols × ${config.intervals.length} intervals × ${overrideCombos.toLocaleString()} override combos)`);

  // Fetch candles once per (symbol, interval, date range)
  const totalFetches = config.symbols.length * config.intervals.length;
  console.log(`[Batch] Fetching data for ${totalFetches} unique (symbol, interval) pair${totalFetches > 1 ? "s" : ""}...`);
  const startTimeUtc = new Date(config.dateRange.start).toISOString();
  const endTimeUtc = new Date(config.dateRange.end).toISOString();

  const fetchMap = new Map<string, CandleFetchResult>();
  let fetchIndex = 0;
  for (const symbol of config.symbols) {
    for (const interval of config.intervals) {
      fetchIndex += 1;
      console.log(`[Batch] [${fetchIndex}/${totalFetches}] Fetching ${symbol} ${interval}...`);
      const key = `${symbol}:${interval}:${startTimeUtc}:${endTimeUtc}`;
      const fetched = await fetchCandlesOnce({ symbol, interval, startTimeUtc, endTimeUtc });
      const candlesSorted: Candle[] = [...fetched.candles].sort((a, b) => a.timeUtcMs - b.timeUtcMs);
      fetchMap.set(key, { ...fetched, candles: candlesSorted });
      console.log(`[Batch] [${fetchIndex}/${totalFetches}] ✓ Fetched ${symbol} ${interval}: ${candlesSorted.length.toLocaleString()} candles`);
    }
  }
  console.log(`[Batch] Data fetch complete! All candles loaded into memory.\n`);

  // Build work items lazily.
  const runIdWidth = Math.max(4, String(totalTests).length);

  type WorkItem = Readonly<{
    symbol: StrategyParams["symbol"];
    interval: StrategyParams["interval"];
    assignments: readonly Readonly<{ path: string; value: OverrideValue }>[];
    index: number;
  }>;

  // Expand work across symbols/intervals while reusing the same overrides iterator per pair.
  // To keep memory low, we materialize a queue of iterators (one per pair), each producing WorkItems.
  const pairGenerators: Array<Generator<WorkItem>> = [];
  for (const symbol of config.symbols) {
    for (const interval of config.intervals) {
      // New override iterator per pair (same override space).
      const localIter = iterateOverrideAssignments(config.overrides);
      const gen = (function* (): Generator<WorkItem> {
        let localIndex = 0;
        for (const assignments of localIter) {
          localIndex += 1;
          yield {
            symbol,
            interval,
            assignments,
            index: localIndex
          };
        }
      })();
      pairGenerators.push(gen);
    }
  }

  // Round-robin consume from pair generators to interleave symbols/intervals.
  let completed = 0;
  let failed = 0;
  const startedAt = Date.now();
  let globalIndex = 0;

  const nextItem = (() => {
    let genIndex = 0;
    return (): WorkItem | null => {
      while (pairGenerators.length > 0) {
        if (genIndex >= pairGenerators.length) {
          genIndex = 0;
        }
        const g = pairGenerators[genIndex];
        if (g === undefined) {
          return null;
        }
        const r = g.next();
        if (r.done) {
          pairGenerators.splice(genIndex, 1);
          continue;
        }
        genIndex += 1;
        globalIndex += 1;
        return { ...r.value, index: globalIndex };
      }
      return null;
    };
  })();

  let lastLogTime = startedAt;
  const logProgress = (force: boolean) => {
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const done = completed + failed;
    if (done === 0) {
      return;
    }
    const perTestMs = elapsedMs / done;
    const remaining = totalTests - done;
    const etaMs = remaining * perTestMs;
    const pct = (done / totalTests) * 100;
    
    // Log every 5 seconds, every 25 tests, or when forced
    const timeSinceLastLog = now - lastLogTime;
    const shouldLog = force || done % 25 === 0 || timeSinceLastLog >= 5000 || done === totalTests;

    if (shouldLog) {
      const elapsedSec = Math.round(elapsedMs / 1000);
      const etaSec = Math.max(0, Math.round(etaMs / 1000));
      const throughput = done > 0 ? (done / (elapsedMs / 1000)).toFixed(1) : "0.0";
      console.log(
        `[Batch] Progress: ${done.toLocaleString()}/${totalTests.toLocaleString()} (${pct.toFixed(1)}%) | Elapsed: ${elapsedSec}s | ETA: ~${etaSec}s | Speed: ${throughput} tests/sec | ✓${completed.toLocaleString()} ✗${failed.toLocaleString()}`
      );
      lastLogTime = now;
    }
  };

  console.log(`[Batch] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Batch] Starting ${totalTests.toLocaleString()} backtests (concurrency: ${concurrency})...`);
  console.log(`[Batch] Progress updates every 5 seconds or 25 tests\n`);

  await runWithConcurrency({
    concurrency,
    nextItem,
    worker: async (item) => {
      const runId = `batch-${padNumber(item.index, runIdWidth)}`;
      const cacheKey = `${item.symbol}:${item.interval}:${startTimeUtc}:${endTimeUtc}`;
      const fetchResult = fetchMap.get(cacheKey);
      if (fetchResult === undefined) {
        throw new Error(`Missing candle cache for ${cacheKey}`);
      }

      try {
        const params = buildParamsForRun({
          symbol: item.symbol,
          interval: item.interval,
          baseParams: config.baseParams,
          assignments: item.assignments
        });

        const sim = runBacktest({
          runId,
          candles: fetchResult.candles,
          candlesSorted: true,
          params,
          startTimeUtc,
          endTimeUtc,
          initialEquity: config.initialEquity,
          optimizationMode: true
        });

        const line: BatchResultLine = {
          runId,
          status: "completed",
          symbol: item.symbol,
          interval: item.interval,
          finalEquity: sim.metrics.finalEquity,
          totalReturnPct: sim.metrics.totalReturnPct,
          maxDrawdownPct: sim.metrics.maxDrawdownPct,
          winRatePct: sim.metrics.winRatePct,
          profitFactor: sim.metrics.profitFactor,
          tradeCount: sim.metrics.tradeCount,
          params,
          dataFingerprint: {
            data: fetchResult.fingerprint,
            effectiveInterval: item.interval,
            candleCount: fetchResult.candles.length,
            optimization_mode: true
          }
        };

        await writer.writeLine(line);
        completed += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const line: BatchResultLine = {
          runId,
          status: "failed",
          symbol: item.symbol,
          interval: item.interval,
          errorMessage: message
        };
        await writer.writeLine(line);
        failed += 1;
      } finally {
        logProgress(false);
      }
    }
  });

  logProgress(true);

  const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const avgTimePerTest = (durationSec / totalTests).toFixed(2);
  const relPath = relative(process.cwd(), writer.getFilePath()).replaceAll("\\", "/");
  
  console.log(`\n[Batch] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Batch] ✅ BATCH COMPLETE!`);
  console.log(`[Batch] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Batch] Results file: ${relPath}`);
  console.log(`[Batch] Total tests:  ${totalTests.toLocaleString()}`);
  console.log(`[Batch] Completed:    ${completed.toLocaleString()} (${((completed/totalTests)*100).toFixed(1)}%)`);
  console.log(`[Batch] Failed:       ${failed.toLocaleString()} (${((failed/totalTests)*100).toFixed(1)}%)`);
  console.log(`[Batch] Duration:     ${durationSec}s (${avgTimePerTest}s per test)`);
  console.log(`[Batch] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Batch] Next steps:`);
  console.log(`[Batch]   1. Convert to CSV: node scripts/jsonl-to-csv.js ${relPath} > results.csv`);
  console.log(`[Batch]   2. Import results.csv to Google Sheets for analysis`);
  console.log(`[Batch] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

try {
  await main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[Batch] Fatal error: ${message}`);
  if (stack !== undefined) {
    console.error(stack);
  }
  process.exitCode = 1;
}

