import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { YahooInterval } from "../../data/yahooFinance.js";
import { PaperTradingAdapter } from "../../exchange/PaperTradingAdapter.js";
import type { Candle as StrategyCandle, IStrategy, Position as StrategyPosition, Signal } from "../../strategies/IStrategy";
import { Logger } from "../Logger";
import { StateManager } from "../StateManager";
import { TradingBot } from "../TradingBot";
import type { BotConfig } from "../types";
import { buildCandleSeries, buildMockBinanceFetcher } from "./helpers/candleSeries";

const mockedBinance = vi.hoisted(() => {
  return {
    fetchBinanceCandles: vi.fn()
  };
});

vi.mock("../../data/binanceDataSource.js", () => {
  return {
    fetchBinanceCandles: mockedBinance.fetchBinanceCandles
  };
});

/**
 * Simple deterministic strategy that enters once and exits after N candles.
 */
class EntryExitStrategy implements IStrategy {
  public name = "entry-exit-test";
  public warmupPeriod = 0;
  private readonly exitAfter: number;
  private candleCount = 0;
  private hasEntered = false;

  /**
   * Creates a strategy that exits after a fixed candle count.
   */
  constructor(exitAfter: number) {
    if (!Number.isFinite(exitAfter) || exitAfter <= 0) {
      throw new Error("exitAfter must be a positive number.");
    }
    this.exitAfter = exitAfter;
  }

  initialize(_candles: StrategyCandle[]): void {
    return;
  }

  onCandle(candle: StrategyCandle, position: StrategyPosition | null): Signal {
    this.candleCount += 1;

    if (!this.hasEntered && position === null) {
      this.hasEntered = true;
      return {
        type: "ENTRY",
        side: "long",
        price: candle.close,
        stopLoss: candle.low,
        takeProfit: candle.high,
        reason: "entry-test"
      };
    }

    if (position !== null && this.candleCount >= this.exitAfter) {
      return {
        type: "EXIT",
        price: candle.close,
        reason: "exit-test"
      };
    }

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
    return {
      candles: this.candleCount,
      entered: this.hasEntered
    };
  }
}

/**
 * Strategy that throws once to exercise error recovery.
 */
class FlakyStrategy implements IStrategy {
  public name = "flaky-test";
  public warmupPeriod = 0;
  private hasThrown = false;

  initialize(_candles: StrategyCandle[]): void {
    return;
  }

  onCandle(candle: StrategyCandle, _position: StrategyPosition | null): Signal {
    if (!this.hasThrown) {
      this.hasThrown = true;
      throw new Error("Intentional strategy failure.");
    }

    return {
      type: "HOLD",
      price: candle.close,
      reason: "recovered"
    };
  }

  onFill(_position: StrategyPosition): void {
    return;
  }

  getState(): Record<string, unknown> {
    return {
      hasThrown: this.hasThrown
    };
  }
}

/**
 * Build a minimal bot config for tests.
 */
function buildConfig(name: string, interval: YahooInterval): BotConfig {
  return {
    name,
    strategy: "entry-exit-test",
    exchange: "paper",
    symbol: "BTC-USD",
    interval,
    initialBalance: 10_000,
    riskManagement: {
      maxDailyLossPct: 5,
      maxPositionSizePct: 100
    },
    params: {}
  };
}

/**
 * Creates a StateManager and Logger backed by a temp directory.
 */
function createTestState(
  testName: string
): Readonly<{ state: StateManager; logger: Logger; tempDir: string; dbPath: string; schemaPath: string }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `dstb-${testName}-`));
  const logDir = path.join(tempDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logger = new Logger(testName, logDir);
  const dbPath = path.join(tempDir, "bot-state.db");
  const schemaPath = path.join(process.cwd(), "data", "schema.sql");
  const state = new StateManager({ dbPath, schemaPath, logger });
  return { state, logger, tempDir, dbPath, schemaPath };
}

describe("TradingBot integration", () => {
  it("runs full lifecycle with the paper adapter", async () => {
    // Step 1: Prepare deterministic candles and mock Binance fetch.
    vi.useFakeTimers();
    const intervalMs = 60_000;
    const startTimeMs = Date.now() - intervalMs * 20;
    const candles = buildCandleSeries({
      startTimeMs,
      intervalMs,
      count: 60,
      basePrice: 100,
      volatility: 5
    });
    mockedBinance.fetchBinanceCandles.mockImplementation(
      buildMockBinanceFetcher({ symbol: "BTC-USD", interval: "1m", candles })
    );

    // Step 2: Build bot dependencies.
    const { state, logger, dbPath, schemaPath } = createTestState("lifecycle");
    const exchange = new PaperTradingAdapter({
      symbol: "BTC-USD",
      interval: "1m",
      initialBalance: 10_000,
      feesBps: 0,
      slippageBps: 0
    });
    const strategy = new EntryExitStrategy(3);
    const bot = new TradingBot({
      config: buildConfig("Lifecycle Bot", "1m"),
      strategy,
      exchange,
      stateManager: state,
      logger,
      maxIterations: 5,
      candleIntervalMsOverride: intervalMs
    });

    // Step 3: Run the bot using fast-forwarded timers.
    const runPromise = bot.start();
    await vi.advanceTimersByTimeAsync(intervalMs * 6);
    await runPromise;

    // Step 4: Validate persisted trades and positions.
    const botId = bot.getId();
    const trades = await state.getTrades(botId);
    const openPositions = await state.getOpenPositions(botId);

    expect(botId.length).toBeGreaterThan(0);
    expect(trades.length).toBeGreaterThan(0);
    expect(openPositions.length).toBe(0);

    // Step 5: Reload state manager to confirm persistence.
    const reloadedState = new StateManager({ dbPath, schemaPath, logger });
    const reloadedBot = await reloadedState.getBot(botId);
    expect(reloadedBot).not.toBeNull();

    vi.useRealTimers();
  });

  it("handles multiple bots concurrently", async () => {
    // Step 1: Prepare deterministic candles and mock Binance fetch.
    vi.useFakeTimers();
    const intervalMs = 60_000;
    const startTimeMs = Date.now() - intervalMs * 10;
    const candles = buildCandleSeries({
      startTimeMs,
      intervalMs,
      count: 50,
      basePrice: 200,
      volatility: 10
    });
    mockedBinance.fetchBinanceCandles.mockImplementation(
      buildMockBinanceFetcher({ symbol: "BTC-USD", interval: "1m", candles })
    );

    // Step 2: Build shared state and two bot instances.
    const { state, logger } = createTestState("multi");
    const exchangeA = new PaperTradingAdapter({
      symbol: "BTC-USD",
      interval: "1m",
      initialBalance: 10_000,
      feesBps: 0,
      slippageBps: 0
    });
    const exchangeB = new PaperTradingAdapter({
      symbol: "BTC-USD",
      interval: "1m",
      initialBalance: 10_000,
      feesBps: 0,
      slippageBps: 0
    });
    const botA = new TradingBot({
      config: buildConfig("Multi Bot A", "1m"),
      strategy: new EntryExitStrategy(2),
      exchange: exchangeA,
      stateManager: state,
      logger,
      maxIterations: 3,
      candleIntervalMsOverride: intervalMs
    });
    const botB = new TradingBot({
      config: buildConfig("Multi Bot B", "1m"),
      strategy: new EntryExitStrategy(2),
      exchange: exchangeB,
      stateManager: state,
      logger,
      maxIterations: 3,
      candleIntervalMsOverride: intervalMs
    });

    // Step 3: Run bots concurrently.
    const runPromise = Promise.all([botA.start(), botB.start()]);
    await vi.advanceTimersByTimeAsync(intervalMs * 4);
    await runPromise;

    // Step 4: Verify both bot records and trade history exist.
    const bots = await state.getAllBots();
    expect(bots.length).toBeGreaterThanOrEqual(2);
    const tradesA = await state.getTrades(botA.getId());
    const tradesB = await state.getTrades(botB.getId());
    expect(tradesA.length).toBeGreaterThan(0);
    expect(tradesB.length).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it("recovers from transient strategy errors", async () => {
    // Step 1: Prepare deterministic candles and mock Binance fetch.
    vi.useFakeTimers();
    const intervalMs = 60_000;
    const startTimeMs = Date.now() - intervalMs * 5;
    const candles = buildCandleSeries({
      startTimeMs,
      intervalMs,
      count: 20,
      basePrice: 150,
      volatility: 3
    });
    mockedBinance.fetchBinanceCandles.mockImplementation(
      buildMockBinanceFetcher({ symbol: "BTC-USD", interval: "1m", candles })
    );

    // Step 2: Build bot dependencies.
    const { state, logger } = createTestState("error-recovery");
    const exchange = new PaperTradingAdapter({
      symbol: "BTC-USD",
      interval: "1m",
      initialBalance: 10_000,
      feesBps: 0,
      slippageBps: 0
    });
    const bot = new TradingBot({
      config: buildConfig("Flaky Bot", "1m"),
      strategy: new FlakyStrategy(),
      exchange,
      stateManager: state,
      logger,
      maxIterations: 2,
      candleIntervalMsOverride: intervalMs
    });

    // Step 3: Run the bot to ensure it survives the error.
    const runPromise = bot.start();
    await vi.advanceTimersByTimeAsync(intervalMs * 3);
    await runPromise;

    // Step 4: Validate bot state persisted despite error.
    const botId = bot.getId();
    const record = await state.getBot(botId);
    expect(record).not.toBeNull();

    vi.useRealTimers();
  });
});
