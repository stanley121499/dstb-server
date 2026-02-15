import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Logger } from "../Logger";
import { StateManager } from "../StateManager";
import { BotConfig, OrderStatus, Position } from "../types";

/**
 * Format date as YYYY-MM-DD for PnL queries.
 */
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

/**
 * Build a minimal valid bot config.
 */
const buildConfig = (): BotConfig => {
  return {
    name: "State Test Bot",
    strategy: "test-strategy",
    exchange: "paper",
    symbol: "BTCUSDT",
    interval: "15m",
    initialBalance: 1000,
    riskManagement: {
      maxDailyLossPct: 5,
      maxPositionSizePct: 20
    },
    params: {}
  };
};

describe("StateManager", () => {
  it("creates, updates, and closes positions with trades", async () => {
    // Create temporary directories for the database and logs.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-state-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    // Initialize logger and state manager.
    const logger = new Logger("bot-test", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });

    // Insert a bot record.
    const botId = await state.createBot(buildConfig());
    const bot = await state.getBot(botId);

    expect(bot).not.toBeNull();
    expect(bot?.id).toBe(botId);

    // Create a position for the bot.
    const position: Position = {
      id: "unused",
      botId,
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 0.1,
      entryPrice: 40000,
      stopLoss: 39000,
      takeProfit: 42000,
      entryTime: Date.now()
    };

    const positionId = await state.createPosition(position);
    const openPositions = await state.getOpenPositions(botId);

    expect(openPositions.length).toBe(1);
    expect(openPositions[0]?.id).toBe(positionId);

    // Update the position stop loss.
    await state.updatePosition(positionId, { stopLoss: 39500 });
    const updatedPositions = await state.getOpenPositions(botId);

    expect(updatedPositions[0]?.stopLoss).toBe(39500);

    // Close the position and verify trade record creation.
    await state.closePosition(positionId, 41000, "take_profit");
    const remaining = await state.getOpenPositions(botId);
    const trades = await state.getTrades(botId);

    expect(remaining.length).toBe(0);
    expect(trades.length).toBe(1);

    // Verify daily PnL calculation.
    const date = formatDate(new Date());
    const dailyPnl = await state.getDailyPnL(botId, date);
    expect(dailyPnl).toBeGreaterThan(0);
  });

  it("creates and updates orders", async () => {
    // Create temporary directories for the database and logs.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-state-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    // Initialize logger and state manager.
    const logger = new Logger("bot-test", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });

    // Insert a bot record.
    const botId = await state.createBot(buildConfig());

    // Create an order record.
    const orderId = await state.createOrder({
      id: "unused",
      botId,
      clientOrderId: "client-1",
      exchangeOrderId: "exchange-1",
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 0.1,
      price: 40000,
      status: "NEW",
      createdAt: Date.now(),
      filledAt: undefined
    });

    expect(orderId.length).toBeGreaterThan(0);

    // Update order status and verify retrieval.
    await state.updateOrderStatus("client-1", "FILLED");
    const order = await state.getOrder("client-1");

    expect(order?.status).toBe<OrderStatus>("FILLED");
  });

  it("backs up the database", async () => {
    // Create temporary directories for the database and logs.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-state-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    // Initialize logger and state manager.
    const logger = new Logger("bot-test", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });

    // Perform a backup and check that the backup file exists.
    await state.backup();
    const backupDir = path.join(tempDir, "backups");
    const backups = fs.readdirSync(backupDir);

    expect(backups.length).toBeGreaterThan(0);
  });
});
