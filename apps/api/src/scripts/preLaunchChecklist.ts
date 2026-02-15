/**
 * @file Pre-launch safety checklist for live trading.
 */

import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { z } from "zod";

import { createExchangeAdapter } from "../exchange/createAdapter.js";
import { botConfigSchema } from "../live/botConfigSchema.js";
import type { BotConfig } from "../live/botConfigSchema.js";

type ParsedArgs = Readonly<{
  configPath?: string;
  symbol: string;
  interval: BotConfig["interval"];
  marketType: "spot" | "futures";
}>;

const intervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);
const marketTypeSchema = z.union([z.literal("spot"), z.literal("futures")]);

/**
 * Parses CLI flags for the pre-launch checklist.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // Step 1: Gather flags into a map.
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

  // Step 2: Apply defaults.
  const symbol = flags.symbol ?? "BTC-USD";
  const interval = intervalSchema.parse(flags.interval ?? "15m");
  const marketType = marketTypeSchema.parse(flags.marketType ?? "spot");

  // Step 3: Return parsed args.
  const result: ParsedArgs =
    flags.config !== undefined
      ? {
          configPath: flags.config,
          symbol,
          interval,
          marketType
        }
      : {
          symbol,
          interval,
          marketType
        };

  return result;
}

/**
 * Reads a bot config when provided.
 */
async function readConfig(pathValue: string): Promise<BotConfig> {
  // Step 1: Resolve path and read file.
  const absolute = resolve(process.cwd(), pathValue);
  const raw = await readFile(absolute, { encoding: "utf-8" });
  // Step 2: Parse JSON into config.
  const parsed = JSON.parse(raw) as unknown;
  return botConfigSchema.parse(parsed);
}

/**
 * Prompts the user for a yes/no answer.
 */
async function promptYesNo(question: string, rl: ReturnType<typeof createInterface>): Promise<boolean> {
  // Step 1: Ask the question.
  const answer = await rl.question(`${question} (y/n): `);
  const normalized = answer.trim().toLowerCase();
  // Step 2: Interpret the answer.
  if (normalized === "y" || normalized === "yes") {
    return true;
  }
  if (normalized === "n" || normalized === "no") {
    return false;
  }
  // Step 3: Retry on invalid input.
  console.log("Please answer with \"y\" or \"n\".");
  return promptYesNo(question, rl);
}

/**
 * Validates Bitunix API keys by connecting to testnet.
 */
async function validateBitunixKeys(
  args: Readonly<{ apiKey: string; secretKey: string; symbol: string; interval: BotConfig["interval"]; marketType: "spot" | "futures" }>
): Promise<boolean> {
  // Step 1: Create the Bitunix adapter for testnet.
  const adapter = createExchangeAdapter({
    type: "bitunix",
    symbol: args.symbol,
    interval: args.interval,
    apiKey: args.apiKey,
    apiSecret: args.secretKey,
    testMode: true,
    marketType: args.marketType
  });

  // Step 2: Attempt to connect and read balance.
  try {
    await adapter.connect();
    await adapter.getBalance();
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown Bitunix validation error";
    console.error(`[pre-launch] Bitunix validation failed: ${message}`);
    return false;
  } finally {
    // Step 3: Always disconnect cleanly.
    await adapter.disconnect();
  }
}

/**
 * Collects failures from interactive checklist confirmations.
 */
async function collectChecklistFailures(args: Readonly<{ rl: ReturnType<typeof createInterface> }>): Promise<string[]> {
  // Step 1: Ask paper trading duration confirmation.
  const failures: string[] = [];
  if (!(await promptYesNo("Have you tested with paper trading for 48+ hours?", args.rl))) {
    failures.push("Paper trading duration not confirmed.");
  }

  // Step 2: Ask backtest comparison confirmation.
  if (!(await promptYesNo("Does paper trading P&L match backtest expectations?", args.rl))) {
    failures.push("Paper trading P&L mismatch not confirmed.");
  }

  // Step 3: Confirm monitoring plan.
  if (!(await promptYesNo("Do you have a monitoring plan (check every 4 hours)?", args.rl))) {
    failures.push("Monitoring plan not confirmed.");
  }

  // Step 4: Confirm emergency stop knowledge.
  if (!(await promptYesNo("Do you understand the emergency stop procedure?", args.rl))) {
    failures.push("Emergency stop procedure not confirmed.");
  }

  // Step 5: Confirm backup funds availability.
  if (!(await promptYesNo("Do you have backup funds available outside the bot?", args.rl))) {
    failures.push("Backup funds not confirmed.");
  }

  return failures;
}

/**
 * Validates configuration-based checks.
 */
async function collectConfigFailures(args: Readonly<{
  rl: ReturnType<typeof createInterface>;
  config: BotConfig | null;
}>): Promise<string[]> {
  // Step 1: Initialize failure list.
  const failures: string[] = [];

  // Step 2: Validate daily loss limit.
  if (args.config !== null) {
    if (args.config.riskManagement.maxDailyLossPct <= 0 || args.config.riskManagement.maxDailyLossPct > 5) {
      failures.push("Daily loss limit must be > 0 and <= 5%.");
    }
  } else if (!(await promptYesNo("Is your daily loss limit set to 5% or less?", args.rl))) {
    failures.push("Daily loss limit not confirmed.");
  }

  // Step 3: Validate starting capital.
  if (args.config !== null) {
    if (args.config.initialBalance < 50 || args.config.initialBalance > 100) {
      failures.push("Initial balance should be between $50 and $100 for first live run.");
    }
  } else if (!(await promptYesNo("Are you starting with small capital ($50-$100)?", args.rl))) {
    failures.push("Initial capital size not confirmed.");
  }

  return failures;
}

/**
 * Validates Bitunix credentials for testnet usage.
 */
async function collectBitunixFailures(args: Readonly<{
  config: BotConfig | null;
  parsed: ParsedArgs;
}>): Promise<string[]> {
  // Step 1: Initialize failure list.
  const failures: string[] = [];

  // Step 2: Read API keys from environment.
  const apiKey = process.env.BITUNIX_API_KEY;
  const secretKey = process.env.BITUNIX_SECRET_KEY;
  if (apiKey === undefined || secretKey === undefined) {
    failures.push("Missing BITUNIX_API_KEY or BITUNIX_SECRET_KEY in environment.");
    return failures;
  }

  // Step 3: Validate keys against testnet.
  const bitunixOk = await validateBitunixKeys({
    apiKey,
    secretKey,
    symbol: args.config?.symbol ?? args.parsed.symbol,
    interval: args.config?.interval ?? args.parsed.interval,
    marketType: args.config?.bitunix?.marketType ?? args.parsed.marketType
  });
  if (!bitunixOk) {
    failures.push("Bitunix API keys failed validation on testnet.");
  }

  return failures;
}

/**
 * Executes the pre-launch checklist flow.
 */
async function main(): Promise<void> {
  // Step 1: Parse CLI args.
  const args = parseArgs(process.argv.slice(2));

  // Step 2: Load config if provided.
  const config = args.configPath === undefined ? null : await readConfig(args.configPath);

  // Step 3: Prepare interactive prompt.
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Step 4: Collect failures from each checklist segment.
    const failures = [
      ...(await collectChecklistFailures({ rl })),
      ...(await collectConfigFailures({ rl, config })),
      ...(await collectBitunixFailures({ config, parsed: args }))
    ];

    // Step 5: Fail if any checklist item was not satisfied.
    if (failures.length > 0) {
      console.error("Pre-launch checklist failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("Pre-launch checklist passed. You may proceed with live trading.");
  } finally {
    // Step 6: Close the readline interface.
    rl.close();
  }
}

try {
  await main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[pre-launch] Fatal error: ${message}`);
  process.exitCode = 1;
}
