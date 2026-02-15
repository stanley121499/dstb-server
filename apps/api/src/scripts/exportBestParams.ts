/**
 * @file Export the best optimization run into a bot-config.json file.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import { botConfigSchema } from "../live/botConfigSchema.js";
import type { BotConfig } from "../live/botConfigSchema.js";

type MetricKey = "totalReturn" | "sharpe" | "profitFactor" | "winRate";

type ParsedArgs = Readonly<{
  inputPath: string;
  outputPath: string;
  metric: MetricKey;
  name?: string;
  exchange: "paper" | "bitunix";
  initialBalance: number;
  maxDailyLossPct: number;
  maxPositionSizePct: number;
  bitunixApiKey?: string;
  bitunixSecretKey?: string;
  bitunixTestMode: boolean;
  bitunixMarketType: "spot" | "futures";
}>;

const metricSchema = z.union([
  z.literal("totalReturn"),
  z.literal("sharpe"),
  z.literal("profitFactor"),
  z.literal("winRate")
]);

const exchangeSchema = z.union([z.literal("paper"), z.literal("bitunix")]);
const marketTypeSchema = z.union([z.literal("spot"), z.literal("futures")]);
const booleanStringSchema = z.union([z.literal("true"), z.literal("false")]).transform((value) => value === "true");

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
 * Parses flags into a key/value map.
 */
function parseFlags(argv: readonly string[]): Record<string, string> {
  // Step 1: Initialize the map.
  const flags: Record<string, string> = {};
  // Step 2: Iterate over argv tokens.
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
  return flags;
}

/**
 * Parses a required flag from the map.
 */
function requireFlag(flags: Record<string, string>, name: string): string {
  // Step 1: Load the flag value.
  const value = flags[name];
  if (value === undefined) {
    throw new Error(`Missing required flag --${name} <value>.`);
  }
  return value;
}

/**
 * Parses a positive number flag.
 */
function parsePositiveNumber(flagValue: string | undefined, fallback: number, label: string): number {
  // Step 1: Resolve the raw value.
  const raw = flagValue === undefined ? fallback : Number(flagValue);
  // Step 2: Validate it is finite and positive.
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Expected --${label} to be a positive number.`);
  }
  return raw;
}

/**
 * Parses CLI arguments for exporting params.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // Step 1: Initialize defaults.
  const defaults = {
    metric: "totalReturn" as MetricKey,
    exchange: "paper" as const,
    initialBalance: 10000,
    maxDailyLossPct: 5,
    maxPositionSizePct: 25,
    bitunixTestMode: false,
    bitunixMarketType: "spot" as const
  };

  // Step 2: Parse flags and required values.
  const flags = parseFlags(argv);
  const inputPath = requireFlag(flags, "input");
  const outputPath = requireFlag(flags, "output");

  // Step 3: Validate metric and exchange.
  const metric = metricSchema.parse(flags.metric ?? defaults.metric);
  const exchange = exchangeSchema.parse(flags.exchange ?? defaults.exchange);

  // Step 4: Parse numeric fields.
  const initialBalance = parsePositiveNumber(flags.initialBalance, defaults.initialBalance, "initialBalance");
  const maxDailyLossPct = parsePositiveNumber(flags.maxDailyLossPct, defaults.maxDailyLossPct, "maxDailyLossPct");
  const maxPositionSizePct = parsePositiveNumber(
    flags.maxPositionSizePct,
    defaults.maxPositionSizePct,
    "maxPositionSizePct"
  );

  // Step 5: Parse Bitunix options.
  const bitunixTestMode =
    flags.bitunixTestMode === undefined ? defaults.bitunixTestMode : booleanStringSchema.parse(flags.bitunixTestMode);
  const bitunixMarketType =
    flags.bitunixMarketType === undefined ? defaults.bitunixMarketType : marketTypeSchema.parse(flags.bitunixMarketType);

  // Step 6: Return the parsed args.
  return {
    inputPath,
    outputPath,
    metric,
    ...(flags.name !== undefined && { name: flags.name }),
    exchange,
    initialBalance,
    maxDailyLossPct,
    maxPositionSizePct,
    ...(flags.bitunixApiKey !== undefined && { bitunixApiKey: flags.bitunixApiKey }),
    ...(flags.bitunixSecretKey !== undefined && { bitunixSecretKey: flags.bitunixSecretKey }),
    bitunixTestMode,
    bitunixMarketType
  } as ParsedArgs;
}

/**
 * Loads optimization runs from a JSONL file.
 */
async function loadRuns(pathValue: string): Promise<readonly z.infer<typeof runSchema>[]> {
  // Step 1: Resolve and read the file.
  const absolute = resolve(process.cwd(), pathValue);
  const raw = await readFile(absolute, { encoding: "utf-8" });
  // Step 2: Parse JSONL rows.
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
 * Extracts a metric value for ranking.
 */
function extractMetric(metric: MetricKey, run: z.infer<typeof runSchema>): number | null {
  // Step 1: Delegate to the metric extractor.
  return metricExtractors[metric](run);
}

/**
 * Selects the best run by metric value.
 */
function selectBestRun(metric: MetricKey, runs: readonly z.infer<typeof runSchema>[]): z.infer<typeof runSchema> {
  // Step 1: Filter completed runs.
  const completed = runs.filter((run) => run.status === "completed");
  if (completed.length === 0) {
    throw new Error("No completed optimization runs found.");
  }

  // Step 2: Choose the highest metric value.
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

  // Step 3: Ensure a run was selected.
  if (best === null) {
    throw new Error(`No runs contained a usable "${metric}" metric.`);
  }
  return best;
}

/**
 * Builds a bot config for export.
 */
function buildBotConfig(args: ParsedArgs, run: z.infer<typeof runSchema>): BotConfig {
  // Step 1: Normalize params from the run.
  const params = strategyParamsSchema.parse(run.params);
  const name = args.name ?? `bot-${params.symbol}-${params.interval}`;

  // Step 2: Build the base config.
  const base = {
    name,
    exchange: args.exchange,
    symbol: params.symbol,
    interval: params.interval,
    initialBalance: args.initialBalance,
    riskManagement: {
      maxDailyLossPct: args.maxDailyLossPct,
      maxPositionSizePct: args.maxPositionSizePct
    },
    params
  };

  // Step 3: Add Bitunix credentials if requested.
  if (args.exchange === "bitunix") {
    if (args.bitunixApiKey === undefined || args.bitunixSecretKey === undefined) {
      throw new Error("Bitunix exchange requires --bitunixApiKey and --bitunixSecretKey.");
    }
    return botConfigSchema.parse({
      ...base,
      bitunix: {
        apiKey: args.bitunixApiKey,
        secretKey: args.bitunixSecretKey,
        testMode: args.bitunixTestMode,
        marketType: args.bitunixMarketType
      }
    });
  }

  return botConfigSchema.parse(base);
}

/**
 * Main entry for export script.
 */
async function main(): Promise<void> {
  // Step 1: Parse CLI args.
  const args = parseArgs(process.argv.slice(2));

  // Step 2: Load optimization runs.
  const runs = await loadRuns(args.inputPath);
  const best = selectBestRun(args.metric, runs);

  // Step 3: Build the bot config.
  const config = buildBotConfig(args, best);

  // Step 4: Write the config file.
  const outputPath = resolve(process.cwd(), args.outputPath);
  await writeFile(outputPath, JSON.stringify(config, null, 2), { encoding: "utf-8" });

  console.log(`Exported bot config to ${outputPath}`);
}

try {
  await main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[export-params] Fatal error: ${message}`);
  process.exitCode = 1;
}
