/**
 * @file Backend-only backtest runner (CLI).
 *
 * Purpose:
 * - Run a single backtest from the terminal without HTTP.
 * - Force optimization mode so results are written to JSONL for easy analysis in Google Sheets.
 *
 * Usage (from apps/api):
 *   npm run backtest -- --symbol ZEC-USD --interval 15m --start 2025-01-01T00:00:00.000Z --end 2025-12-31T23:59:00.000Z --initialEquity 10000
 *
 * Notes:
 * - This script creates a minimal `backtest_runs` row in Supabase so the existing
 *   `processBacktestRun()` job can run unchanged (no DB schema changes).
 * - The strategy params used here are a baseline; edit them in this file to experiment.
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";
import { relative } from "node:path";

import { z } from "zod";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import type { StrategyParams } from "../domain/strategyParams.js";
import { processBacktestRun } from "../jobs/processBacktestRun.js";
import { ResultsFileWriter } from "../jobs/resultsFileWriter.js";
import { readEnv } from "../server/env.js";
import { createSupabaseServerClient } from "../supabase/client.js";
import { createBacktestRunsBulk } from "../supabase/backtestRunsRepo.js";

type CliArgs = Readonly<{
  symbol: "BTC-USD" | "ETH-USD" | "ZEC-USD";
  interval: "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d";
  start: string;
  end: string;
  initialEquity: number;
}>;

/**
 * Parses argv flags in the form: `--key value`.
 *
 * This is intentionally minimal and strict: any unknown flag or missing value will error.
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
      throw new Error(`Unexpected argument "${token}". Expected flags like --symbol.`);
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
    i += 2; // Skip value
  }

  return out;
}

function isValidIsoDateString(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/**
 * Baseline ORB+ATR strategy params.
 *
 * Modify these defaults for experimentation.
 */
function buildBaselineParams(args: Readonly<{ symbol: CliArgs["symbol"]; interval: CliArgs["interval"] }>): StrategyParams {
  const candidate: StrategyParams = {
    version: "1.0",
    symbol: args.symbol,
    interval: args.interval,
    session: {
      timezone: "America/New_York",
      startTime: "09:30",
      openingRangeMinutes: 30
    },
    entry: {
      // Note: engine currently hardcodes both directions as allowed; keep this payload field for compatibility.
      directionMode: "long_short",
      entryMode: "stop_breakout",
      breakoutBufferBps: 0,
      maxTradesPerSession: 1
    },
    atr: {
      atrLength: 14,
      atrFilter: {
        enabled: false,
        minAtrBps: 0,
        maxAtrBps: 1_000_000
      }
    },
    risk: {
      sizingMode: "fixed_risk_pct",
      riskPctPerTrade: 1,
      fixedNotional: 0,
      stopMode: "atr_multiple",
      atrStopMultiple: 2,
      takeProfitMode: "r_multiple",
      tpRMultiple: 2,
      trailingStopMode: "disabled",
      atrTrailMultiple: 2,
      timeExitMode: "disabled",
      barsAfterEntry: 0,
      sessionEndTime: "16:00"
    },
    execution: {
      feeBps: 10,
      slippageBps: 5
    }
  };

  // Validate baseline params against the authoritative schema.
  return strategyParamsSchema.parse(candidate);
}

async function main(): Promise<void> {
  const rawFlags = parseArgv(process.argv.slice(2));

  const parsed = z
    .object({
      symbol: z.enum(["BTC-USD", "ETH-USD", "ZEC-USD"]),
      interval: z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]),
      start: z
        .string()
        .trim()
        .min(1)
        .refine((v) => isValidIsoDateString(v), { message: "start must be a valid date string (ISO recommended)" }),
      end: z
        .string()
        .trim()
        .min(1)
        .refine((v) => isValidIsoDateString(v), { message: "end must be a valid date string (ISO recommended)" }),
      initialEquity: z
        .union([z.number(), z.string().trim().transform(Number)])
        .refine((v) => Number.isFinite(v) && v > 0, { message: "initialEquity must be a finite number > 0" })
    })
    .strict()
    .superRefine((v, ctx) => {
      const startMs = Date.parse(v.start);
      const endMs = Date.parse(v.end);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= endMs) {
        ctx.addIssue({
          code: "custom",
          path: ["start"],
          message: "start must be < end"
        });
      }
    })
    .parse(rawFlags) as CliArgs;

  // Validate env early per docs/18-dev-standards.md
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);

  const runId = randomUUID();
  const paramsSnapshot = buildBaselineParams({ symbol: parsed.symbol, interval: parsed.interval });

  // Insert a single run using the bulk insert path so `data_fingerprint.optimization_mode` is set to true.
  await createBacktestRunsBulk({
    supabase,
    runs: [
      {
        id: runId,
        parameterSetId: null,
        paramsSnapshot,
        engineVersion: env.ENGINE_VERSION,
        symbol: parsed.symbol,
        interval: parsed.interval,
        startTimeUtc: new Date(parsed.start).toISOString(),
        endTimeUtc: new Date(parsed.end).toISOString(),
        initialEquity: parsed.initialEquity
      }
    ]
  });

  // Create a JSONL results writer (same convention as the server).
  const sessionId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const resultsWriter = new ResultsFileWriter(sessionId);

  console.log(`[backtest-cli] Run ID: ${runId}`);
  console.log(`[backtest-cli] Writing JSONL to: ${resultsWriter.getFilePath()}`);

  await processBacktestRun({ supabase, runId, resultsWriter });

  const absolutePath = resultsWriter.getFilePath();
  const relativePath = relative(process.cwd(), absolutePath).replaceAll("\\", "/");
  console.log(`Results written to: ${relativePath}`);
}

try {
  await main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[backtest-cli] Fatal error: ${message}`);
  if (stack !== undefined) {
    console.error(stack);
  }
  process.exitCode = 1;
}

