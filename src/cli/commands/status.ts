import type { Bot, Position } from "../../core/types";
import type { ParsedCliArgs } from "./cliTypes";
import { createStateManager, formatNumber, formatTable, toLocalDateString } from "./cliUtils";

/**
 * Run the status command for bots.
 */
export async function runStatus(args: ParsedCliArgs): Promise<void> {
  // Step 1: Determine whether to show a specific bot or all bots.
  const botId = args.flags["bot-id"] ?? args.positionals[0];
  const stateManager = createStateManager("cli");

  if (botId !== undefined) {
    // Step 2: Load bot details and print a detailed view.
    const bot = await stateManager.getBot(botId);
    if (bot === null) {
      throw new Error(`Bot ${botId} not found.`);
    }
    const positions = await stateManager.getOpenPositions(bot.id);
    const today = toLocalDateString(new Date());
    const dailyPnl = await stateManager.getDailyPnL(bot.id, today);
    console.log(formatBotDetail(bot, positions, dailyPnl));
    return;
  }

  // Step 3: Load all bots and print a summary table.
  const bots = await stateManager.getAllBots();
  if (bots.length === 0) {
    console.log("No bots found.");
    return;
  }

  console.log(formatBotSummary(bots));
}

/**
 * Format a detailed status view for a single bot.
 */
function formatBotDetail(bot: Bot, positions: readonly Position[], dailyPnl: number): string {
  // Step 1: Assemble base bot details and financial metrics.
  const totalPnl = bot.currentEquity - bot.initialBalance;
  const lines: string[] = [
    `Bot: ${bot.name} (${bot.id})`,
    `Status: ${bot.status}`,
    `Strategy: ${bot.strategy}`,
    `Symbol: ${bot.config.symbol}`,
    `Interval: ${bot.config.interval}`,
    "",
    "Financial:",
    `  Initial Balance:   ${formatNumber(bot.initialBalance, 2)}`,
    `  Current Equity:    ${formatNumber(bot.currentEquity, 2)}`,
    `  Total PnL:         ${formatNumber(totalPnl, 2)}`,
    `  Today PnL:         ${formatNumber(dailyPnl, 2)}`,
    "",
    "System:",
    `  Last Heartbeat:    ${formatHeartbeat(bot.lastHeartbeat)}`
  ];

  if (positions.length === 0) {
    // Step 2: Short-circuit when no positions are open.
    lines.push("", "Position: none");
    return lines.join("\n");
  }

  // Step 3: Include the first open position details.
  const position = positions[0];
  if (position === undefined) {
    return lines.join("\n");
  }
  const positionLines = [
    "",
    "Position:",
    `  Side:              ${position.side}`,
    `  Quantity:          ${formatNumber(position.quantity, 4)}`,
    `  Entry Price:       ${formatNumber(position.entryPrice, 2)}`,
    `  Stop Loss:         ${formatNumber(position.stopLoss ?? null, 2)}`,
    `  Take Profit:       ${formatNumber(position.takeProfit ?? null, 2)}`,
    `  Entry Time:        ${new Date(position.entryTime).toISOString()}`
  ];
  return lines.concat(positionLines).join("\n");
}

/**
 * Format a summary table for multiple bots.
 */
function formatBotSummary(bots: readonly Bot[]): string {
  // Step 1: Build table headers and rows.
  const headers = ["ID", "Name", "Status", "Symbol", "Equity", "PnL"];
  const rows = bots.map((bot) => {
    const pnl = bot.currentEquity - bot.initialBalance;
    return [
      bot.id,
      bot.name,
      bot.status,
      bot.config.symbol,
      formatNumber(bot.currentEquity, 2),
      formatNumber(pnl, 2)
    ];
  });

  return formatTable(headers, rows);
}

/**
 * Format a heartbeat timestamp for display.
 */
function formatHeartbeat(value: number | undefined): string {
  // Step 1: Return "n/a" when missing.
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  // Step 2: Render ISO timestamp for readability.
  return new Date(value).toISOString();
}
