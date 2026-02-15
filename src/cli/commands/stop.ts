import type { OrderSide } from "../../../apps/api/src/exchange/types.js";
import type { Position } from "../../core/types";
import type { ParsedCliArgs } from "./cliTypes";
import { buildExchangeAdapter } from "./cliExchange";
import {
  createStateManager,
  isProcessAlive,
  readDaemonRecord,
  removeDaemonRecord
} from "./cliUtils";

/**
 * Run the stop command to halt one or more bots.
 */
export async function runStop(args: ParsedCliArgs): Promise<void> {
  // Step 1: Determine target bot(s) and mode.
  const botId = args.flags["bot-id"] ?? args.positionals[0];
  const stopAll = args.booleanFlags["all"] === true || botId === undefined;
  const force = args.booleanFlags["force"] === true;

  // Step 2: Initialize state manager for bot lookups.
  const stateManager = createStateManager("cli");

  // Step 3: Stop all bots or a single bot based on input.
  if (stopAll) {
    const bots = await stateManager.getAllBots();
    if (bots.length === 0) {
      console.log("No bots found.");
      return;
    }
    for (const bot of bots) {
      await stopBot({
        botId: bot.id,
        botName: bot.name,
        force,
        stateManager
      });
    }
    console.log(`Stopped ${bots.length} bot(s).`);
    return;
  }

  await stopBot({
    botId,
    botName: botId,
    force,
    stateManager
  });
}

/**
 * Stop a single bot, optionally forcing position closure.
 */
async function stopBot(args: Readonly<{
  botId: string;
  botName: string;
  force: boolean;
  stateManager: ReturnType<typeof createStateManager>;
}>): Promise<void> {
  // Step 1: Load bot record to validate existence.
  const bot = await args.stateManager.getBot(args.botId);
  if (bot === null) {
    throw new Error(`Bot ${args.botId} not found.`);
  }

  // Step 2: Stop the daemon process if registered.
  const daemonRecord = readDaemonRecord(args.botId);
  if (daemonRecord !== null) {
    if (isProcessAlive(daemonRecord.pid)) {
      try {
        process.kill(daemonRecord.pid, "SIGTERM");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to signal process ${daemonRecord.pid}: ${message}`);
      }
    }
    removeDaemonRecord(args.botId);
  }

  // Step 3: Force-close positions if requested.
  if (args.force) {
    await forceClosePositions(bot.config, args.botId, args.stateManager);
  }

  // Step 4: Update bot status and report.
  await args.stateManager.updateBotStatus(args.botId, "stopped");
  console.log(`🛑 Stopped bot: ${bot.name} (${args.botId})`);
}

/**
 * Force-close open positions by placing market orders.
 */
async function forceClosePositions(
  config: Parameters<typeof buildExchangeAdapter>[0],
  botId: string,
  stateManager: ReturnType<typeof createStateManager>
): Promise<void> {
  // Step 1: Fetch open positions and short-circuit if none exist.
  const openPositions = await stateManager.getOpenPositions(botId);
  if (openPositions.length === 0) {
    return;
  }

  // Step 2: Connect to the exchange adapter for closing orders.
  const adapter = buildExchangeAdapter(config);
  await adapter.connect();

  try {
    // Step 3: Place market orders to close each position.
    for (const position of openPositions) {
      const side = toExitSide(position);
      const order = await adapter.placeMarketOrder({
        side,
        quantity: position.quantity
      });
      const lastPrice = await adapter.getLastPrice();
      const exitPrice = order.averageFillPrice ?? lastPrice;

      await stateManager.closePosition(position.id, exitPrice, "force_stop");
    }

    // Step 4: Refresh equity after position closures.
    const balance = await adapter.getBalance();
    await stateManager.updateBotEquity(botId, balance.total);
  } finally {
    // Step 5: Ensure the adapter disconnects.
    await adapter.disconnect();
  }
}

/**
 * Convert a core position to the exit side for a market order.
 */
function toExitSide(position: Position): OrderSide {
  // Step 1: Map long/short positions to exit order side.
  return position.side === "LONG" ? "sell" : "buy";
}
