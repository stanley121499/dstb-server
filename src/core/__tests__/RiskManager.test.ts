import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Logger } from "../Logger";
import { RiskManager } from "../RiskManager";
import { StateManager } from "../StateManager";
import type { BotConfig, Position } from "../types";
import type { Signal } from "../../strategies/IStrategy";

/**
 * Build a minimal bot config for risk testing.
 */
const buildConfig = (overrides?: Partial<BotConfig>): BotConfig => {
  return {
    name: "Risk Test Bot",
    strategy: "test-strategy",
    exchange: "paper",
    symbol: "BTCUSDT",
    interval: "15m",
    initialBalance: 1000,
    riskManagement: {
      maxDailyLossPct: 5,
      maxPositionSizePct: 10
    },
    params: {},
    ...overrides
  };
};

/**
 * Build an entry signal for tests.
 */
const buildEntrySignal = (price: number): Signal => {
  return {
    type: "ENTRY",
    side: "long",
    price,
    reason: "test-entry"
  };
};

describe("RiskManager", () => {
  it("blocks entries when daily loss limit exceeded", async () => {
    // Step 1: Set up SQLite state.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-risk-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const logger = new Logger("bot-risk", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });
    const config = buildConfig();
    const botId = await state.createBot(config);

    // Step 2: Create a losing trade to exceed max daily loss.
    const position: Position = {
      id: "unused",
      botId,
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 1,
      entryPrice: 100,
      stopLoss: 90,
      takeProfit: 120,
      entryTime: Date.now()
    };
    const positionId = await state.createPosition(position);
    await state.closePosition(positionId, 40, "loss");

    // Step 3: Run the risk check.
    const riskManager = new RiskManager(state, logger);
    const result = await riskManager.checkEntry({
      botId,
      config,
      signal: buildEntrySignal(100),
      marketPrice: 100,
      quantity: 1,
      currentEquity: 1000,
      openPosition: null
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily loss");
  });

  it("blocks entries when position size exceeds maxPositionSizePct", async () => {
    // Step 1: Set up SQLite state.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-risk-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const logger = new Logger("bot-risk", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });
    const config = buildConfig({ riskManagement: { maxDailyLossPct: 5, maxPositionSizePct: 10 } });
    const botId = await state.createBot(config);

    // Step 2: Run the risk check with oversized position.
    const riskManager = new RiskManager(state, logger);
    const result = await riskManager.checkEntry({
      botId,
      config,
      signal: buildEntrySignal(200),
      marketPrice: 200,
      quantity: 1,
      currentEquity: 1000,
      openPosition: null
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("maxPositionSizePct");
  });

  it("blocks entries when a position is already open", async () => {
    // Step 1: Set up SQLite state.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-risk-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const logger = new Logger("bot-risk", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });
    const config = buildConfig();
    const botId = await state.createBot(config);

    // Step 2: Provide an open position to the risk check.
    const openPosition: Position = {
      id: "position-1",
      botId,
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 1,
      entryPrice: 100,
      stopLoss: 90,
      takeProfit: 120,
      entryTime: Date.now()
    };

    const riskManager = new RiskManager(state, logger);
    const result = await riskManager.checkEntry({
      botId,
      config,
      signal: buildEntrySignal(100),
      marketPrice: 100,
      quantity: 1,
      currentEquity: 1000,
      openPosition
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Open position");
  });

  it("allows entries when checks pass", async () => {
    // Step 1: Set up SQLite state.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-risk-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const logger = new Logger("bot-risk", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });
    const config = buildConfig();
    const botId = await state.createBot(config);

    // Step 2: Run the risk check with valid inputs.
    const riskManager = new RiskManager(state, logger);
    const result = await riskManager.checkEntry({
      botId,
      config,
      signal: buildEntrySignal(100),
      marketPrice: 100,
      quantity: 0.5,
      currentEquity: 1000,
      openPosition: null
    });

    expect(result.allowed).toBe(true);
  });
});
