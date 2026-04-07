import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { ConfigLoader } from "../../core/ConfigLoader";
import { TradingBot } from "../../core/TradingBot";
import type { BotConfig } from "../../core/types";
import { GoogleSheetsReporter } from "../../monitoring/GoogleSheetsReporter";
import { TelegramAlerter } from "../../monitoring/TelegramAlerter";
import { createStrategy } from "../../strategies/factory";
import type { ParsedCliArgs } from "./cliTypes";
import { buildExchangeAdapter } from "./cliExchange";
import {
  createBotLogger,
  createStateManager,
  ensureDirectory,
  isProcessAlive,
  isRecord,
  listDaemonRecords,
  readJsonFile,
  removeDaemonRecord,
  resolveBotPaths,
  resolveCliEntryPath,
  writeDaemonRecord
} from "./cliUtils";

/**
 * Run the start command to launch a trading bot.
 */
export async function runStart(args: ParsedCliArgs): Promise<void> {
  // Step 1: Validate required flags and parse mode switches.
  const configPath = args.flags["config"];
  if (configPath === undefined) {
    throw new Error("Missing --config <path>.");
  }

  const daemonRequested = args.booleanFlags["daemon"] === true;
  const isDaemonChild = args.booleanFlags["daemon-child"] === true;
  const paperOverride = args.booleanFlags["paper"] === true;
  const dryRun = args.booleanFlags["dry-run"] === true;
  const botIdOverride = args.flags["bot-id"];

  // Step 2: Apply exchange overrides for paper or dry-run modes.
  const overrides: Readonly<{
    exchange?: "paper";
  }> = paperOverride || dryRun ? { exchange: "paper" } : {};

  // Step 3: Load and validate config before branching.
  const config = loadBotConfig(configPath, overrides);

  // Step 4: Single-instance guard — skip when re-entering as daemon child.
  if (!isDaemonChild) {
    const absConfigPath = path.resolve(process.cwd(), configPath);
    const existing = listDaemonRecords();
    for (const record of existing) {
      if (record.configPath !== absConfigPath) {
        continue;
      }
      if (isProcessAlive(record.pid)) {
        console.error(
          [
            `\n⚠️  Bot already running for this config.`,
            `   Config:  ${absConfigPath}`,
            `   Bot ID:  ${record.botId}`,
            `   PID:     ${record.pid}`,
            `   Started: ${record.startedAt}`,
            ``,
            `   Use "npm run bot -- stop ${record.botId}" to stop it first.`,
            `   Or "npm run bot -- status" to inspect running bots.`
          ].join("\n")
        );
        process.exit(1);
      }
      // Stale record (process dead) — clean it up silently.
      removeDaemonRecord(record.botId);
    }
  }

  // Step 5: Spawn daemon or run in foreground.
  if (daemonRequested && !isDaemonChild) {
    await startDaemon(configPath, config, paperOverride, dryRun);
    return;
  }

  await startInForeground({
    config,
    configPath,
    ...(botIdOverride !== undefined ? { botIdOverride } : {}),
    isDaemonChild
  });
}

/**
 * Start a bot in a detached daemon process.
 */
async function startDaemon(
  configPath: string,
  config: BotConfig,
  paperOverride: boolean,
  dryRun: boolean
): Promise<void> {
  // Step 1: Create the bot record so the daemon can reuse the ID.
  const stateManager = createStateManager("cli");
  const botId = await stateManager.createBot(config);
  if (botId.length === 0) {
    throw new Error("Failed to create bot record.");
  }

  // Step 2: Spawn a detached child process for the bot.
  const entryPath = resolveCliEntryPath();
  const args: string[] = [
    "--loader",
    "tsx",
    entryPath,
    "start",
    "--config",
    path.resolve(process.cwd(), configPath),
    "--daemon-child",
    "--bot-id",
    botId
  ];
  if (paperOverride) {
    args.push("--paper");
  }
  if (dryRun) {
    args.push("--dry-run");
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore"
  });

  // Step 3: Persist daemon metadata for stop/status commands.
  if (child.pid === undefined) {
    throw new Error("Failed to spawn daemon process.");
  }

  child.unref();

  const paths = resolveBotPaths();
  ensureDirectory(paths.daemonDir);

  writeDaemonRecord({
    botId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    configPath: path.resolve(process.cwd(), configPath)
  });

  // Step 4: Emit a startup summary for the user.
  const output = [
    `🚀 Starting bot: ${config.name}`,
    `Bot ID: ${botId}`,
    `Strategy: ${config.strategy}`,
    `Exchange: ${config.exchange}${paperOverride || dryRun ? " (paper mode)" : ""}`,
    `Symbol: ${config.symbol}`,
    `Initial Balance: ${config.initialBalance.toFixed(2)}`,
    "",
    "✅ Bot started successfully",
    "Status: running"
  ];
  console.log(output.join("\n"));
}

/**
 * Start a bot in the current process (foreground).
 */
async function startInForeground(args: Readonly<{
  config: BotConfig;
  configPath: string;
  botIdOverride?: string;
  isDaemonChild: boolean;
}>): Promise<void> {
  // Step 1: Ensure a bot record exists for this run.
  const stateManager = createStateManager("cli");
  let botId = args.botIdOverride;
  if (botId !== undefined) {
    const existing = await stateManager.getBot(botId);
    if (existing === null) {
      botId = await stateManager.createBot(args.config);
    }
  } else {
    botId = await stateManager.createBot(args.config);
  }
  if (botId.length === 0) {
    throw new Error("Failed to create bot record.");
  }

  // Step 2: Build bot dependencies.
  const logger = createBotLogger(botId);
  const strategy = createStrategy(args.config.strategy, args.config.params);
  const exchange = buildExchangeAdapter(args.config);

  // Step 3: Build optional monitoring services from env vars.
  let telegram: TelegramAlerter | null = null;
  let sheets: GoogleSheetsReporter | null = null;

  try {
    telegram = TelegramAlerter.fromEnv({ stateManager, logger });
    logger.info("Telegram alerter initialised", { event: "telegram_init" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Telegram alerts disabled: ${msg}`, { event: "telegram_skip" });
  }

  try {
    sheets = GoogleSheetsReporter.fromEnv({ stateManager, logger });
    logger.info("Google Sheets reporter initialised", { event: "sheets_init" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Google Sheets reporting disabled: ${msg}`, { event: "sheets_skip" });
  }

  const bot = new TradingBot({
    botId,
    config: args.config,
    strategy,
    exchange,
    stateManager,
    logger,
    ...(telegram !== null ? { alerting: telegram } : {})
  });

  // Step 4: Register signal handlers for graceful shutdown.
  const handleSignal = async (signal: string): Promise<void> => {
    logger.info("Shutdown signal received", { event: "bot_shutdown", signal });
    await bot.stop();
  };

  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });

  try {
    // Step 5: Start monitoring before the bot loop.
    telegram?.startPolling();
    sheets?.start();

    // Send startup notification to Telegram group.
    if (telegram !== null) {
      await telegram.sendAlert({
        level: "INFO",
        message: [
          `🚀 <b>Bot started:</b> ${args.config.name}`,
          `📊 Strategy: <code>${args.config.strategy}</code>`,
          `💱 Symbol: <code>${args.config.symbol}</code>`,
          `🏦 Exchange: <code>${args.config.exchange}</code>`
        ].join("\n"),
        botId
      });
    }

    // Step 6: Mark running, write daemon record, then start.
    await stateManager.updateBotStatus(botId, "running");
    writeDaemonRecord({
      botId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath: path.resolve(process.cwd(), args.configPath)
    });

    await bot.start();
  } catch (error) {
    // Step 7: Flag errors in bot status for visibility.
    await stateManager.updateBotStatus(botId, "error");
    throw error;
  } finally {
    // Step 8: Stop monitoring and clean up.
    telegram?.stopPolling();
    sheets?.stop();
    await stateManager.updateBotStatus(botId, "stopped");
    removeDaemonRecord(botId);
  }
}

/**
 * Load and validate bot config with overrides.
 */
function loadBotConfig(pathValue: string, overrides: Readonly<{ exchange?: "paper" }>): BotConfig {
  // Step 1: Load raw JSON and validate shape.
  const raw = readJsonFile(pathValue);
  if (!isRecord(raw)) {
    throw new Error("Config file must be a JSON object.");
  }

  // Step 2: Apply CLI overrides before validation.
  const merged: Record<string, unknown> = { ...raw };
  if (overrides.exchange !== undefined) {
    merged.exchange = overrides.exchange;
  }

  // Step 3: Validate config using core schema.
  return ConfigLoader.validateConfig(merged);
}

/**
 * Build the exchange adapter for a given bot config.
 */
