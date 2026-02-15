import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Candle, CandleFetchResult, YahooInterval } from "../../../apps/api/src/data/yahooFinance.js";
import { PaperTradingAdapter } from "../../../apps/api/src/exchange/PaperTradingAdapter.js";
import { Logger } from "../Logger";
import { StateManager } from "../StateManager";
import { TradingBot } from "../TradingBot";
import type { BotConfig } from "../types";
import type { Candle as StrategyCandle, IStrategy, Position as StrategyPosition, Signal } from "../../strategies/IStrategy";

const mockData = vi.hoisted(() => {
  const now = Date.now();
  const candles: Candle[] = [
    {
      timeUtcMs: now - 120_000,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000
    },
    {
      timeUtcMs: now - 60_000,
      open: 102,
      high: 106,
      low: 101,
      close: 104,
      volume: 900
    },
    {
      timeUtcMs: now,
      open: 104,
      high: 108,
      low: 103,
      close: 107,
      volume: 850
    }
  ];

  const buildFetchResult = (candlesInput: Candle[]): CandleFetchResult => {
    return {
      candles: candlesInput,
      fingerprint: {
        source: "yahoo",
        symbol: "BTCUSDT",
        interval: "1m",
        startTimeUtc: new Date(candlesInput[0]?.timeUtcMs ?? now).toISOString(),
        endTimeUtc: new Date(candlesInput[candlesInput.length - 1]?.timeUtcMs ?? now).toISOString(),
        fetchedAtUtc: new Date(now).toISOString(),
        rowCount: candlesInput.length,
        firstTimeUtc: new Date(candlesInput[0]?.timeUtcMs ?? now).toISOString(),
        lastTimeUtc: new Date(candlesInput[candlesInput.length - 1]?.timeUtcMs ?? now).toISOString(),
        sha256: "test"
      },
      warnings: []
    };
  };

  return { candles, buildFetchResult };
});

vi.mock("../../../apps/api/src/data/binanceDataSource.js", () => {
  return {
    fetchBinanceCandles: vi.fn(async () => mockData.buildFetchResult(mockData.candles))
  };
});

/**
 * Minimal strategy for testing TradingBot wiring.
 */
class HoldStrategy implements IStrategy {
  public name = "hold-test";
  public warmupPeriod = 2;
  public initializedWith: StrategyCandle[] = [];
  public onCandleCalls = 0;

  initialize(candles: StrategyCandle[]): void {
    this.initializedWith = [...candles];
  }

  onCandle(candle: StrategyCandle, _position: StrategyPosition | null): Signal {
    this.onCandleCalls += 1;
    return {
      type: "HOLD",
      price: candle.close,
      reason: "hold"
    };
  }

  onFill(_position: StrategyPosition): void {
    return;
  }

  getState(): Record<string, unknown> {
    return {};
  }
}

/**
 * Build a minimal bot config for tests.
 */
const buildConfig = (): BotConfig => {
  return {
    name: "TradingBot Test",
    strategy: "hold-test",
    exchange: "paper",
    symbol: "BTCUSDT",
    interval: "1m",
    initialBalance: 1000,
    riskManagement: {
      maxDailyLossPct: 5,
      maxPositionSizePct: 10
    },
    params: {}
  };
};

describe("TradingBot", () => {
  it("starts, initializes strategy, and updates heartbeat", async () => {
    // Step 1: Create temporary directories.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-bot-"));
    const logDir = path.join(tempDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    // Step 2: Initialize logger and state manager.
    const logger = new Logger("bot-test", logDir);
    const dbPath = path.join(tempDir, "bot-state.db");
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const state = new StateManager({ dbPath, schemaPath, logger });

    // Step 3: Build the exchange adapter and strategy.
    const interval: YahooInterval = "1m";
    const exchange = new PaperTradingAdapter({
      symbol: "BTCUSDT",
      interval,
      initialBalance: 1000,
      feesBps: 0,
      slippageBps: 0
    });
    const strategy = new HoldStrategy();

    // Step 4: Start the bot with a single iteration.
    const bot = new TradingBot({
      config: buildConfig(),
      strategy,
      exchange,
      stateManager: state,
      logger,
      maxIterations: 1,
      candleIntervalMsOverride: 1
    });

    await bot.start();

    // Step 5: Verify bot state and strategy initialization.
    const botId = bot.getId();
    expect(botId.length).toBeGreaterThan(0);
    expect(strategy.initializedWith.length).toBeGreaterThan(0);
    expect(strategy.onCandleCalls).toBeGreaterThan(0);

    // Step 6: Verify heartbeat updated in SQLite.
    const record = await state.getBot(botId);
    expect(record?.lastHeartbeat).toBeDefined();
  });
});
