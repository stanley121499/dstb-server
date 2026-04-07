import * as fs from "node:fs";
import * as path from "node:path";
import { BitunixAdapter } from "../../exchange/BitunixAdapter.js";
import { TelegramAlerter } from "../../monitoring/TelegramAlerter.js";
import { BehaviorSheetsReporter } from "../../behavior/reporter/BehaviorSheetsReporter.js";
import { BehaviorDashboardReporter } from "../../behavior/reporter/BehaviorDashboardReporter.js";
import { BehaviorBot } from "../../behavior/bot/BehaviorBot.js";
import { Logger } from "../../core/Logger.js";
import { readJsonFile, resolveProjectRoot, createStateManager } from "./cliUtils.js";
import type { ParsedCliArgs } from "./cliTypes.js";

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing environment variable: ${key}`);
  return val;
}

export async function runBehaviorLive(args: ParsedCliArgs): Promise<void> {
  const configPath = args.flags["config"];
  if (!configPath) {
    throw new Error("Missing --config flag. Usage: bot behavior:live --config <path/to/config.json>");
  }

  const absolutePath = path.resolve(resolveProjectRoot(), configPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found at: ${absolutePath}`);
  }

  const rawConfig = readJsonFile(configPath) as any;
  const apiKey = rawConfig.exchangeApiKey ?? process.env.BITUNIX_API_KEY;
  const secretKey = rawConfig.exchangeApiSecret ?? process.env.BITUNIX_API_SECRET;
  const symbol = rawConfig.symbol ?? "BTC-USD";

  if (!apiKey || !secretKey) {
    throw new Error("Missing Bitunix credentials in config or environment");
  }

  const logger = new Logger("behavior-live", path.resolve(resolveProjectRoot(), "logs"));

  const exchangeAdapter = new BitunixAdapter({
    symbol,
    interval: "15m",
    apiKey,
    secretKey,
    marketType: "futures"
  });
  const marketApi = exchangeAdapter.market;

  let telegramAlerter: TelegramAlerter | null = null;
  if (process.env.TELEGRAM_BOT_TOKEN) {
    // Need BotStateStore for TelegramAlerter
    const stateManager = createStateManager("behavior-live");
    telegramAlerter = TelegramAlerter.fromEnv({ stateManager, logger });
  }

  const sheetsReporter = BehaviorSheetsReporter.fromEnv();

  // Dashboard reporter is optional — only activated when GOOGLE_SHEETS_ID is present (same creds)
  let dashboardReporter: BehaviorDashboardReporter | null = null;
  try {
    dashboardReporter = BehaviorDashboardReporter.fromEnv();
  } catch {
    logger.info("Dashboard reporter not configured — BEHAVIOR-OVERVIEW-DASHBOARD will not be refreshed.");
  }

  const startUid = parseInt(process.env.BEHAVIOR_START_UID ?? "1", 10);

  // 6. Fetch initial PDH/PDL (demonstration/warmup as per prompt, actual value used inside BehaviorBot.start)
  const klines = await marketApi.getKline({ symbol: "BTCUSDT", interval: "1d", limit: 2 });
  const prevCandle = klines[klines.length - 2];
  const pdh = prevCandle?.high ?? 0;
  const pdl = prevCandle?.low ?? 0;
  logger.info("Fetched initial 1D candles", { pdh, pdl });

  const bot = new BehaviorBot({
    exchangeAdapter,
    marketApi,
    telegramAlerter,
    sheetsReporter,
    dashboardReporter,
    pair: symbol,
    startUid,
    logger
  });

  await bot.start();

  const shutdown = (): void => {
    logger.info("Received shutdown signal, stopping bot...");
    bot.stop().catch(console.error).finally(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export const runBehaviorLiveCommand = runBehaviorLive;
