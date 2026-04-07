import { randomUUID } from "node:crypto";

import type { Balance, Position as ExchangePosition } from "../../exchange/types.js";
import type { Bot, Position } from "../../core/types";
import type { ParsedCliArgs, ReconcileResult } from "./cliTypes";
import { buildExchangeAdapter } from "./cliExchange";
import { createStateManager } from "./cliUtils";

/**
 * Run the reconcile command to detect and fix discrepancies.
 */
export async function runReconcile(args: ParsedCliArgs): Promise<void> {
  // Step 1: Determine target bots and fix mode.
  const botId = args.flags["bot-id"] ?? args.positionals[0];
  const fix = args.booleanFlags["fix"] === true;
  const stateManager = createStateManager("cli");

  // Step 2: Load bots to reconcile.
  const bots = botId !== undefined ? await loadSingleBot(stateManager, botId) : await stateManager.getAllBots();
  if (bots.length === 0) {
    console.log("No bots found.");
    return;
  }

  // Step 3: Reconcile each bot and collect results.
  const results: ReconcileResult[] = [];
  for (const bot of bots) {
    const result = await reconcileBot(bot, fix, stateManager);
    results.push(result);
  }

  // Step 4: Print summary output.
  printResults(results);
}

/**
 * Load a single bot or throw if missing.
 */
async function loadSingleBot(stateManager: ReturnType<typeof createStateManager>, botId: string): Promise<Bot[]> {
  // Step 1: Load the bot record or throw when missing.
  const bot = await stateManager.getBot(botId);
  if (bot === null) {
    throw new Error(`Bot ${botId} not found.`);
  }
  return [bot];
}

/**
 * Reconcile a bot against exchange state.
 */
async function reconcileBot(
  bot: Bot,
  fix: boolean,
  stateManager: ReturnType<typeof createStateManager>
): Promise<ReconcileResult> {
  // Step 1: Connect to the exchange adapter.
  const adapter = buildExchangeAdapter(bot.config);
  await adapter.connect();

  try {
    // Step 2: Load exchange state and DB positions.
    const [balance, exchangePosition, dbPositions] = await Promise.all([
      adapter.getBalance(),
      adapter.getPosition(),
      stateManager.getOpenPositions(bot.id)
    ]);

    // Step 3: Detect issues and optionally fix them.
    const issues = detectIssues(exchangePosition, dbPositions);
    if (fix && issues.length > 0) {
      await applyFixes({
        bot,
        balance,
        exchangePosition,
        dbPositions,
        stateManager,
        adapter
      });
    }

    // Step 4: Return the reconciliation result summary.
    return {
      botId: bot.id,
      botName: bot.name,
      exchange: bot.config.exchange,
      issues,
      fixed: fix && issues.length > 0
    };
  } finally {
    // Step 5: Always disconnect the adapter.
    await adapter.disconnect();
  }
}

/**
 * Detect discrepancies between exchange and DB positions.
 */
function detectIssues(
  exchangePosition: ExchangePosition | null,
  dbPositions: readonly Position[]
): string[] {
  // Step 1: Compare exchange and DB position presence.
  const issues: string[] = [];

  if (exchangePosition === null && dbPositions.length > 0) {
    issues.push("Exchange has no open position but DB has open positions.");
  }

  if (exchangePosition !== null && dbPositions.length === 0) {
    issues.push("Exchange has an open position but DB is missing it.");
  }

  if (dbPositions.length > 1) {
    issues.push("DB has multiple open positions for a single-symbol bot.");
  }

  // Step 2: Compare position fields when both sides have a record.
  if (exchangePosition !== null && dbPositions.length > 0) {
    const db = dbPositions[0];
    if (db !== undefined) {
      if (exchangePosition.symbol !== db.symbol) {
        issues.push("Position symbol mismatch between exchange and DB.");
      }
      if (!roughEqual(exchangePosition.quantity, db.quantity)) {
        issues.push("Position quantity mismatch between exchange and DB.");
      }
      const dbSide = db.side === "LONG" ? "long" : "short";
      if (exchangePosition.side !== dbSide) {
        issues.push("Position side mismatch between exchange and DB.");
      }
    }
  }

  return issues;
}

/**
 * Apply reconciliation fixes by aligning DB state with exchange.
 */
async function applyFixes(args: Readonly<{
  bot: Bot;
  balance: Balance;
  exchangePosition: ExchangePosition | null;
  dbPositions: readonly Position[];
  stateManager: ReturnType<typeof createStateManager>;
  adapter: ReturnType<typeof buildExchangeAdapter>;
}>): Promise<void> {
  // Step 1: Close DB positions when exchange shows none.
  if (args.exchangePosition === null && args.dbPositions.length > 0) {
    const lastPrice = await args.adapter.getLastPrice();
    for (const position of args.dbPositions) {
      await args.stateManager.closePosition(position.id, lastPrice, "reconcile_close");
    }
  }

  // Step 2: Insert a DB position when exchange has one but DB does not.
  if (args.exchangePosition !== null && args.dbPositions.length === 0) {
    const openedAt = Date.parse(args.exchangePosition.openedAtUtc);
    const entryTime = Number.isFinite(openedAt) ? openedAt : Date.now();
    await args.stateManager.createPosition({
      id: randomUUID(),
      botId: args.bot.id,
      symbol: args.exchangePosition.symbol,
      side: args.exchangePosition.side === "long" ? "LONG" : "SHORT",
      quantity: args.exchangePosition.quantity,
      entryPrice: args.exchangePosition.entryPrice,
      entryTime
    });
  }

  // Step 3: Reset DB position when both exist but mismatch.
  if (args.exchangePosition !== null && args.dbPositions.length > 0) {
    for (const position of args.dbPositions) {
      await args.stateManager.closePosition(position.id, args.exchangePosition.entryPrice, "reconcile_reset");
    }
    const openedAt = Date.parse(args.exchangePosition.openedAtUtc);
    const entryTime = Number.isFinite(openedAt) ? openedAt : Date.now();
    await args.stateManager.createPosition({
      id: randomUUID(),
      botId: args.bot.id,
      symbol: args.exchangePosition.symbol,
      side: args.exchangePosition.side === "long" ? "LONG" : "SHORT",
      quantity: args.exchangePosition.quantity,
      entryPrice: args.exchangePosition.entryPrice,
      entryTime
    });
  }

  // Step 4: Update equity from exchange balance.
  await args.stateManager.updateBotEquity(args.bot.id, args.balance.total);
}

/**
 * Compare two numbers with a tolerance.
 */
function roughEqual(left: number, right: number, tolerance = 1e-6): boolean {
  // Step 1: Compare with absolute tolerance.
  return Math.abs(left - right) <= tolerance;
}

/**
 * Print reconciliation results.
 */
function printResults(results: readonly ReconcileResult[]): void {
  // Step 1: Print each bot reconciliation summary.
  for (const result of results) {
    const header = `Reconcile ${result.botName} (${result.botId})`;
    console.log(header);
    if (result.issues.length === 0) {
      console.log("  ✅ No issues found");
    } else {
      for (const issue of result.issues) {
        console.log(`  ⚠️  ${issue}`);
      }
      if (result.fixed) {
        console.log("  ✅ Fixes applied");
      }
    }
    console.log("");
  }
}
