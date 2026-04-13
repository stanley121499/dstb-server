import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { ExchangeCandle, Order as ExchangeOrder, Position as ExchangePosition } from "../exchange/types.js";
import { intervalToMs } from "../utils/interval.js";

import type { Candle, IStrategy, Position as StrategyPosition, Signal } from "../strategies/IStrategy";
import { Logger } from "./Logger";
import { OrderExecutor } from "./OrderExecutor";
import { PositionManager } from "./PositionManager";
import { RiskManager } from "./RiskManager";
import type { BotStateStore } from "./BotStateStore.js";
import { isBotStateStore } from "./BotStateStore.js";
import type { Bot, BotConfig, Position } from "./types.js";

/**
 * Optional alerting adapter for error notifications.
 */
export type AlertingAdapter = Readonly<{
  sendAlert: (args: Readonly<{ level: "CRITICAL" | "WARNING" | "INFO"; message: string; botId: string }>) => Promise<void>;
}>;

/**
 * TradingBot constructor options.
 */
export type TradingBotOptions = Readonly<{
  botId?: string;
  config: BotConfig;
  strategy: IStrategy;
  exchange: IExchangeAdapter;
  stateManager: BotStateStore;
  logger: Logger;
  alerting?: AlertingAdapter;
  maxIterations?: number;
  heartbeatIntervalMs?: number;
  candleIntervalMsOverride?: number;
}>;

/**
 * TradingBot orchestrates the strategy, exchange adapter, and persistence.
 */
export class TradingBot {
  private id: string;
  private readonly config: BotConfig;
  private readonly strategy: IStrategy;
  private readonly exchange: IExchangeAdapter;
  private readonly stateManager: BotStateStore;
  private readonly logger: Logger;
  private readonly alerting?: AlertingAdapter;
  private readonly positionManager: PositionManager;
  private readonly orderExecutor: OrderExecutor;
  private readonly riskManager: RiskManager;
  private readonly heartbeatIntervalMs: number;
  private readonly maxIterations?: number;
  private readonly candleIntervalMsOverride?: number;

  private isRunning = false;
  private errorCount = 0;
  private lastHeartbeatAt: number | null = null;
  private lastCandleTime: number | null = null;
  /** Throttle identical HOLD reasons in `bot_logs` while still capturing state changes. */
  private lastHoldLogAtMs = 0;
  private lastHoldReasonForLog: string | null = null;
  private static readonly HOLD_LOG_THROTTLE_MS = 300_000;

  /**
   * Creates a new TradingBot instance.
   *
   * Inputs:
   * - options: TradingBotOptions with dependencies and config.
   *
   * Outputs:
   * - TradingBot instance.
   *
   * Error behavior:
   * - Throws on invalid dependencies or config.
   */
  constructor(options: TradingBotOptions) {
    // Step 1: Validate dependencies.
    if (!this.isNonEmptyString(options.config?.name)) {
      throw new Error("TradingBot requires a valid BotConfig.");
    }
    if (!this.isNonEmptyString(options.strategy?.name)) {
      throw new Error("TradingBot requires a valid strategy instance.");
    }
    if (options.exchange === null || options.exchange === undefined) {
      throw new Error("TradingBot requires a valid exchange adapter.");
    }
    if (!isBotStateStore(options.stateManager)) {
      throw new Error("TradingBot requires a valid BotStateStore instance.");
    }
    if (!(options.logger instanceof Logger)) {
      throw new Error("TradingBot requires a valid Logger instance.");
    }

    // Step 2: Store dependencies and defaults.
    this.id = options.botId ?? "";
    this.config = options.config;
    this.strategy = options.strategy;
    this.exchange = options.exchange;
    this.stateManager = options.stateManager;
    this.logger = options.logger;
    if (options.alerting !== undefined) {
      this.alerting = options.alerting;
    }
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    if (options.maxIterations !== undefined) {
      this.maxIterations = options.maxIterations;
    }
    if (options.candleIntervalMsOverride !== undefined) {
      this.candleIntervalMsOverride = options.candleIntervalMsOverride;
    }

    // Step 3: Initialize managers.
    this.positionManager = new PositionManager(this.stateManager, this.logger);
    this.orderExecutor = new OrderExecutor(this.exchange, this.stateManager, this.logger);
    this.riskManager = new RiskManager(this.stateManager, this.logger);
  }

  /**
   * Persists a structured decision or outcome row to `bot_logs` (non-blocking).
   */
  private persistThought(args: Readonly<{
    level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>): void {
    if (!this.isNonEmptyString(this.id)) {
      return;
    }
    void this.stateManager
      .insertBotLog({
        botId: this.id,
        level: args.level,
        event: args.event,
        message: args.message,
        metadata: args.metadata ?? {}
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(`insertBotLog failed: ${msg}`, { event: "bot_log_insert_failed" });
      });
  }

  /**
   * Compact JSON snapshot of strategy internal state for `bot_logs` (length-capped).
   */
  private summarizeStrategyStateForLog(): Record<string, unknown> {
    try {
      const s = this.strategy.getState();
      const json = JSON.stringify(s);
      const cap = 2000;
      return {
        strategyStateJson: json.length > cap ? `${json.slice(0, cap)}…` : json
      };
    } catch {
      return { strategyStateJson: "(unserializable)" };
    }
  }

  /**
   * Starts the trading bot lifecycle.
   *
   * Inputs:
   * - None.
   *
   * Outputs:
   * - Promise resolved when the bot stops.
   *
   * Error behavior:
   * - Throws on unrecoverable startup failures.
   */
  async start(): Promise<void> {
    // Step 1: Mark bot as running and reset error count.
    this.isRunning = true;
    this.errorCount = 0;

    this.logger.info("Trading bot starting", {
      event: "bot_start",
      botName: this.config.name
    });

    // Step 2: Ensure exchange connection is active.
    const isConnected = await this.exchange.isConnected();
    if (!isConnected) {
      await this.exchange.connect();
    }

    // Step 3: Load state from database.
    await this.loadState();

    // Step 4: Reconcile positions with exchange.
    await this.reconcilePositions();

    // Step 4b: Cancel any orphaned open orders left by previous crashed sessions.
    await this.cancelOrphanedOrders();

    // Step 5: Initialize strategy with historical candles.
    await this.initializeStrategy();

    // Step 6: Sync equity from live exchange balance before entering the loop.
    // This ensures /status shows the real account balance, not the config's initialBalance.
    try {
      const balance = await this.exchange.getBalance();
      if (typeof balance.total === "number" && balance.total > 0) {
        await this.stateManager.updateBotEquity(this.id, balance.total);
        this.logger.info(`Equity synced from exchange: ${balance.total} ${balance.currency}`, {
          event: "equity_sync",
          equity: balance.total,
          currency: balance.currency
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not sync equity from exchange: ${msg}`, {
        event: "equity_sync_failed"
      });
    }

    this.persistThought({
      level: "INFO",
      event: "bot_session_start",
      message: `Session started: ${this.config.name}`,
      metadata: {
        symbol: this.config.symbol,
        strategy: this.strategy.name,
        exchange: this.config.exchange,
        interval: this.config.interval
      }
    });

    // Step 7: Start main loop.
    await this.mainLoop();

  }

  /**
   * Stops the trading bot and disconnects from the exchange.
   */
  async stop(): Promise<void> {
    // Step 1: Mark bot as stopped.
    this.isRunning = false;

    this.persistThought({
      level: "INFO",
      event: "bot_session_stop",
      message: "Trading bot stopping (disconnecting exchange)",
      metadata: {}
    });

    // Step 2: Disconnect exchange.
    await this.exchange.disconnect();

    this.logger.info("Trading bot stopped", {
      event: "bot_stop",
      botId: this.id
    });
  }

  /**
   * Returns the current bot identifier.
   */
  getId(): string {
    return this.id;
  }

  /**
   * Main trading loop that processes candles and signals.
   */
  private async mainLoop(): Promise<void> {
    let iterations = 0;

    while (this.isRunning) {
      try {
        // Step 1: Fetch latest candle.
        const candle = await this.fetchLatestCandle();
        if (candle === null) {
          await this.waitForNextCandle();
          continue;
        }

        // Step 2: Avoid re-processing the same candle.
        if (this.lastCandleTime !== null && candle.timeUtcMs <= this.lastCandleTime) {
          await this.waitForNextCandle();
          continue;
        }
        this.lastCandleTime = candle.timeUtcMs;

        // Step 3: Sync DB position with exchange (detects SL/TP fills, prevents stale state).
        await this.syncPositionWithExchange();

        // Step 4: Load current DB position.
        const dbPosition = await this.positionManager.getOpenPosition(this.id);
        const strategyPosition = dbPosition ? this.toStrategyPosition(dbPosition) : null;

        // Step 4b: If no open position, sweep any orphaned orders (e.g. from failed entries).
        if (dbPosition === null) {
          await this.cancelOrphanedOrders();
        }

        // Step 5: Ask strategy for a signal.
        const signal = this.strategy.onCandle(this.toStrategyCandle(candle), strategyPosition);

        // Step 6: Execute signal actions.
        if (signal.type === "ENTRY") {
          await this.handleEntry(signal, dbPosition);
        } else if (signal.type === "EXIT") {
          await this.handleExit(signal, dbPosition);
        } else {
          const nowMs = Date.now();
          const reasonChanged = signal.reason !== this.lastHoldReasonForLog;
          const throttleElapsed = nowMs - this.lastHoldLogAtMs >= TradingBot.HOLD_LOG_THROTTLE_MS;
          if (reasonChanged || throttleElapsed) {
            this.lastHoldReasonForLog = signal.reason;
            this.lastHoldLogAtMs = nowMs;
            this.persistThought({
              level: "INFO",
              event: "strategy_hold",
              message: signal.reason,
              metadata: {
                candleTimeUtcMs: candle.timeUtcMs,
                symbol: this.config.symbol,
                strategy: this.strategy.name,
                hasOpenPosition: strategyPosition !== null,
                ...this.summarizeStrategyStateForLog()
              }
            });
          }
          this.logger.debug("Strategy hold signal", {
            event: "strategy_hold",
            reason: signal.reason
          });
        }

        // Step 7: Update heartbeat if due.
        await this.updateHeartbeatIfNeeded();

        // Step 8: Respect interval pacing.
        await this.waitForNextCandle();

        iterations += 1;
        if (this.maxIterations !== undefined && iterations >= this.maxIterations) {
          await this.stop();
        }
      } catch (error) {
        await this.handleError(error);
        await this.waitForNextCandle();
      }
    }
  }

  /**
   * Syncs the DB position with the live exchange position every loop iteration.
   * This detects when SL/TP orders have been filled on the exchange and closes
   * the corresponding DB position, preventing stale open positions.
   */
  private async syncPositionWithExchange(): Promise<void> {
    const dbPosition = await this.positionManager.getOpenPosition(this.id);

    // Only sync if we think we have an open position in the DB.
    if (dbPosition === null) {
      return;
    }

    // Check what the exchange actually shows.
    const exchangePosition = await this.exchange.getPosition();

    if (exchangePosition === null) {
      // Exchange is flat but DB still has an open position.
      // This means SL/TP was hit on the exchange (or manually closed).
      const marketPrice = await this.exchange.getLastPrice();
      const closePrice = this.isPositiveNumber(marketPrice) ? marketPrice : dbPosition.entryPrice;

      await this.stateManager.closePosition(dbPosition.id, closePrice, "exchange_closed_externally");

      this.logger.warn("DB position closed: exchange position no longer exists (SL/TP or manual close)", {
        event: "position_sync_closed",
        botId: this.id,
        positionId: dbPosition.id,
        closePrice
      });

      this.persistThought({
        level: "WARN",
        event: "position_closed_externally",
        message: "DB position closed: exchange no longer had an open position (SL/TP hit or manual close).",
        metadata: {
          positionId: dbPosition.id,
          closePrice,
          symbol: this.config.symbol
        }
      });

      // Update equity after external close.
      const balance = await this.exchange.getBalance();
      if (this.isPositiveNumber(balance.total)) {
        await this.stateManager.updateBotEquity(this.id, balance.total);
      }
    }
  }

  /**
   * Handles entry signals with risk checks and order placement.
   */
  private async handleEntry(signal: Signal, dbPosition: Position | null): Promise<void> {
    // Step 1: Validate entry signal shape.
    if (signal.type !== "ENTRY" || signal.side === undefined) {
      this.logger.warn("Ignored invalid ENTRY signal", {
        event: "signal_entry_invalid",
        reason: signal.reason
      });
      this.persistThought({
        level: "WARN",
        event: "entry_blocked_invalid_signal",
        message: `Invalid ENTRY shape: ${signal.reason}`,
        metadata: { symbol: this.config.symbol }
      });
      return;
    }

    this.persistThought({
      level: "INFO",
      event: "strategy_entry_intent",
      message: signal.reason,
      metadata: {
        side: signal.side,
        price: signal.price,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        symbol: this.config.symbol,
        strategy: this.strategy.name,
        ...this.summarizeStrategyStateForLog()
      }
    });

    // Step 1b: Block entry if already in a position (DB or exchange).
    if (dbPosition !== null) {
      this.logger.debug("Entry blocked: already in a DB position", {
        event: "entry_blocked_db_position",
        positionId: dbPosition.id,
        side: dbPosition.side
      });
      this.persistThought({
        level: "INFO",
        event: "entry_blocked_open_db_position",
        message: "Strategy wanted ENTRY but bot already has an open DB position.",
        metadata: {
          positionId: dbPosition.id,
          side: dbPosition.side,
          strategyReason: signal.reason,
          symbol: this.config.symbol
        }
      });
      return;
    }

    // Also check exchange directly to prevent stacking even if DB is stale.
    const exchangePosition = await this.exchange.getPosition();
    if (exchangePosition !== null) {
      this.logger.warn("Entry blocked: exchange already has an open position (DB may be stale)", {
        event: "entry_blocked_exchange_position",
        exchangeSide: exchangePosition.side,
        exchangeQty: exchangePosition.quantity
      });
      this.persistThought({
        level: "WARN",
        event: "entry_blocked_exchange_position",
        message: "Strategy ENTRY blocked: exchange already shows an open position.",
        metadata: {
          exchangeSide: exchangePosition.side,
          exchangeQty: exchangePosition.quantity,
          strategyReason: signal.reason,
          symbol: this.config.symbol
        }
      });
      return;
    }

    // Step 2: Fetch market price and balance.
    const marketPrice = signal.price ?? (await this.exchange.getLastPrice());
    if (!this.isPositiveNumber(marketPrice)) {
      this.logger.warn("Entry blocked: invalid market price", {
        event: "entry_invalid_price",
        price: marketPrice
      });
      this.persistThought({
        level: "WARN",
        event: "entry_blocked_invalid_price",
        message: "ENTRY blocked: market price missing or non-positive.",
        metadata: { price: marketPrice, strategyReason: signal.reason, symbol: this.config.symbol }
      });
      return;
    }

    const balance = await this.exchange.getBalance();

    // 🔍 CRITICAL: Log balance details for debugging
    this.logger.info("💰 Balance fetched for position sizing", {
      event: "balance_fetch",
      available: balance.available,
      locked: balance.locked,
      total: balance.total,
      currency: balance.currency,
      marketPrice,
      stopLoss: signal.stopLoss,
      riskPerUnit: signal.stopLoss ? Math.abs(marketPrice - signal.stopLoss) : 0
    });

    if (!this.isPositiveNumber(balance.total)) {
      this.logger.warn("Entry blocked: invalid equity", {
        event: "entry_invalid_equity",
        equity: balance.total
      });
      this.persistThought({
        level: "WARN",
        event: "entry_blocked_invalid_equity",
        message: "ENTRY blocked: account equity missing or non-positive.",
        metadata: { equity: balance.total, strategyReason: signal.reason, symbol: this.config.symbol }
      });
      return;
    }

    // ⚠️ SAFETY CHECK: Verify balance is reasonable (not leveraged equity)
    let effectiveBalance = balance.total;
    if (balance.total > this.config.initialBalance * 2) {
      effectiveBalance = Math.min(balance.total, this.config.initialBalance);
      this.logger.warn("⚠️ Balance appears inflated (possibly leveraged equity). Using conservative value.", {
        event: "balance_warning",
        reportedBalance: balance.total,
        configInitialBalance: this.config.initialBalance,
        usingBalance: effectiveBalance
      });
    }

    // Step 3: Determine order quantity.
    let quantity: number;
    try {
      quantity = this.calculateQuantity(signal, marketPrice, effectiveBalance);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Entry blocked: position sizing failed: ${msg}`, {
        event: "entry_sizing_failed",
        strategyReason: signal.reason
      });
      this.persistThought({
        level: "WARN",
        event: "entry_blocked_sizing_failed",
        message: msg,
        metadata: {
          marketPrice,
          effectiveBalance,
          strategyReason: signal.reason,
          symbol: this.config.symbol,
          stopLoss: signal.stopLoss
        }
      });
      return;
    }

    const positionNotional = quantity * marketPrice;

    // 🚨 CRITICAL SAFETY CHECK: Position size sanity check
    if (positionNotional > balance.total * 10) {
      const errorMsg =
        `🚨 CRITICAL: Position size too large! ` +
        `Notional: ${positionNotional.toFixed(2)} ${balance.currency}, ` +
        `Balance: ${balance.total.toFixed(2)} ${balance.currency}. ` +
        `This would be ${(positionNotional / balance.total).toFixed(1)}x your balance. ` +
        `Check your leverage settings and risk parameters.`;
      this.logger.error(errorMsg, { event: "position_too_large" });
      this.persistThought({
        level: "CRITICAL",
        event: "entry_blocked_position_too_large",
        message: errorMsg,
        metadata: {
          positionNotional,
          balanceTotal: balance.total,
          symbol: this.config.symbol,
          strategyReason: signal.reason
        }
      });
      await this.alerting?.sendAlert({
        level: "CRITICAL",
        message: errorMsg,
        botId: this.id
      });
      return;
    }

    // ✅ Log final position size calculation
    this.logger.info("✅ Position size calculated", {
      event: "position_size_calc",
      quantity,
      marketPrice,
      positionNotional,
      balanceUsed: effectiveBalance,
      notionalPctOfBalance: `${((positionNotional / effectiveBalance) * 100).toFixed(2)}%`,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit
    });

    // Step 4: Run risk checks.
    const riskCheck = await this.riskManager.checkEntry({
      botId: this.id,
      config: this.config,
      signal,
      marketPrice,
      quantity,
      currentEquity: balance.total,
      openPosition: dbPosition
    });

    if (!riskCheck.allowed) {
      this.logger.warn(`Entry blocked: ${riskCheck.reason}`, {
        event: "risk_blocked",
        botId: this.id
      });
      this.persistThought({
        level: "WARN",
        event: "entry_blocked_risk",
        message: riskCheck.reason,
        metadata: {
          symbol: this.config.symbol,
          quantity,
          marketPrice,
          strategyReason: signal.reason,
          ...(riskCheck.details !== undefined ? { details: riskCheck.details } : {})
        }
      });
      return;
    }

    // Step 5: Execute entry order.
    let result: Awaited<ReturnType<OrderExecutor["executeEntry"]>>;
    try {
      result = await this.orderExecutor.executeEntry({
        botId: this.id,
        symbol: this.config.symbol,
        signal,
        quantity,
        marketPrice
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.persistThought({
        level: "ERROR",
        event: "order_entry_failed",
        message: msg,
        metadata: {
          symbol: this.config.symbol,
          side: signal.side,
          quantity,
          marketPrice,
          strategyReason: signal.reason
        }
      });
      await this.handleError(err);
      return;
    }
    const entryOrder: ExchangeOrder = result.exchangeOrder;

    // Step 6: Notify strategy of fill.
    this.strategy.onFill(this.toStrategyPosition(result.position));

    // Step 7: Update equity in SQLite.
    const updatedBalance = await this.exchange.getBalance();
    await this.stateManager.updateBotEquity(this.id, updatedBalance.total);

    this.logger.info("Position opened", {
      event: "position_opened",
      side: signal.side,
      quantity,
      price: result.position.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      orderId: entryOrder.id
    });

    this.persistThought({
      level: "INFO",
      event: "position_opened",
      message: `Opened ${signal.side} — ${signal.reason}`,
      metadata: {
        side: signal.side,
        quantity,
        entryPrice: result.position.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        orderId: entryOrder.id,
        positionId: result.position.id,
        symbol: this.config.symbol
      }
    });
  }

  /**
   * Handles exit signals with order placement and DB updates.
   */
  private async handleExit(signal: Signal, dbPosition: Position | null): Promise<void> {
    // Step 1: Ensure there is a position to close.
    if (dbPosition === null) {
      this.logger.warn("Exit signal ignored: no open position", {
        event: "signal_exit_no_position",
        reason: signal.reason
      });
      this.persistThought({
        level: "INFO",
        event: "exit_ignored_no_position",
        message: `EXIT signal ignored — no open position: ${signal.reason}`,
        metadata: { symbol: this.config.symbol, strategy: this.strategy.name }
      });
      return;
    }

    this.persistThought({
      level: "INFO",
      event: "strategy_exit_intent",
      message: signal.reason,
      metadata: {
        positionId: dbPosition.id,
        side: dbPosition.side,
        quantity: dbPosition.quantity,
        symbol: this.config.symbol,
        strategy: this.strategy.name,
        ...this.summarizeStrategyStateForLog()
      }
    });

    // Step 2: Fetch market price and balance.
    const marketPrice = signal.price ?? (await this.exchange.getLastPrice());
    if (!this.isPositiveNumber(marketPrice)) {
      this.logger.warn("Exit blocked: invalid market price", {
        event: "exit_invalid_price",
        price: marketPrice
      });
      this.persistThought({
        level: "WARN",
        event: "exit_blocked_invalid_price",
        message: "EXIT blocked: invalid market price.",
        metadata: { price: marketPrice, positionId: dbPosition.id, symbol: this.config.symbol }
      });
      return;
    }

    const balance = await this.exchange.getBalance();
    if (!this.isPositiveNumber(balance.total)) {
      this.logger.warn("Exit blocked: invalid equity", {
        event: "exit_invalid_equity",
        equity: balance.total
      });
      this.persistThought({
        level: "WARN",
        event: "exit_blocked_invalid_equity",
        message: "EXIT blocked: invalid equity.",
        metadata: { equity: balance.total, positionId: dbPosition.id, symbol: this.config.symbol }
      });
      return;
    }

    // Step 3: Execute exit order.
    let result: Awaited<ReturnType<OrderExecutor["executeExit"]>>;
    try {
      result = await this.orderExecutor.executeExit({
        botId: this.id,
        position: dbPosition,
        marketPrice,
        reason: signal.reason
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.persistThought({
        level: "ERROR",
        event: "order_exit_failed",
        message: msg,
        metadata: {
          symbol: this.config.symbol,
          positionId: dbPosition.id,
          side: dbPosition.side,
          quantity: dbPosition.quantity,
          exitReason: signal.reason
        }
      });
      await this.handleError(err);
      return;
    }
    const exitOrder: ExchangeOrder = result.exchangeOrder;

    // Step 4: Update equity in SQLite.
    const updatedBalance = await this.exchange.getBalance();
    await this.stateManager.updateBotEquity(this.id, updatedBalance.total);

    this.logger.info("Position closed", {
      event: "position_closed",
      side: dbPosition.side,
      quantity: dbPosition.quantity,
      exitPrice: result.exitPrice,
      reason: signal.reason,
      orderId: exitOrder.id
    });

    this.persistThought({
      level: "INFO",
      event: "position_closed",
      message: signal.reason,
      metadata: {
        side: dbPosition.side,
        quantity: dbPosition.quantity,
        exitPrice: result.exitPrice,
        orderId: exitOrder.id,
        positionId: dbPosition.id,
        symbol: this.config.symbol
      }
    });
  }

  /**
   * Loads bot state from SQLite and ensures a bot record exists.
   */
  private async loadState(): Promise<Bot> {
    // Step 1: Fetch existing bot when an id was provided.
    if (this.isNonEmptyString(this.id)) {
      const existing = await this.stateManager.getBot(this.id);
      if (existing !== null) {
        await this.stateManager.updateBotHeartbeat(existing.id);
        return existing;
      }
    }

    // Step 2: Create a new bot record when missing.
    const newId = await this.stateManager.createBot(this.config);
    this.id = newId;

    const created = await this.stateManager.getBot(this.id);
    if (created === null) {
      throw new Error("Failed to create or load bot state.");
    }

    await this.stateManager.updateBotHeartbeat(created.id);
    return created;
  }

  /**
   * Cancels all open orders on the exchange for this symbol.
   * Called on startup to clean up orphaned orders left by previous crashed sessions.
   */
  private async cancelOrphanedOrders(): Promise<void> {
    try {
      const openOrders = await this.exchange.getOpenOrders();
      if (openOrders.length === 0) return;

      this.logger.info(`Cancelling ${openOrders.length} orphaned open order(s) from previous session.`, {
        event: "orphan_order_cancel",
        count: openOrders.length
      });

      for (const order of openOrders) {
        try {
          await this.exchange.cancelOrder(order.id);
          this.logger.debug(`Cancelled orphaned order ${order.id}`, {
            event: "orphan_order_cancelled",
            orderId: order.id
          });
        } catch (err: unknown) {
          // Non-fatal — log and continue.
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to cancel orphaned order ${order.id}: ${msg}`, {
            event: "orphan_order_cancel_failed",
            orderId: order.id
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not fetch open orders for cleanup: ${msg}`, {
        event: "orphan_order_fetch_failed"
      });
    }
  }

  /**
   * Reconciles DB positions with the exchange snapshot.
   */
  private async reconcilePositions(): Promise<void> {
    // Step 1: Load current exchange position and market price.
    const exchangePosition: ExchangePosition | null = await this.exchange.getPosition();
    const marketPrice = await this.exchange.getLastPrice();

    // Step 2: Perform reconciliation.
    const result = await this.positionManager.reconcilePosition({
      botId: this.id,
      symbol: this.config.symbol,
      exchangePosition,
      marketPrice
    });

    this.logger.info("Position reconciliation complete", {
      event: "position_reconcile",
      action: result.action,
      reason: result.reason
    });
  }

  /**
   * Initializes strategy with historical candles.
   */
  private async initializeStrategy(): Promise<void> {
    // Step 1: Skip when warmup period is zero.
    const warmup = this.strategy.warmupPeriod;
    if (!Number.isFinite(warmup) || warmup <= 0) {
      this.persistThought({
        level: "INFO",
        event: "strategy_initialized",
        message: "Strategy started with no historical warmup (warmupPeriod <= 0).",
        metadata: {
          symbol: this.config.symbol,
          strategy: this.strategy.name,
          ...this.summarizeStrategyStateForLog()
        }
      });
      return;
    }

    // Step 2: Fetch warmup candles from exchange.
    const candles = await this.exchange.getLatestCandles({ limit: warmup });
    const strategyCandles = candles.map((candle) => this.toStrategyCandle(candle));

    // Step 3: Initialize strategy.
    this.strategy.initialize(strategyCandles);

    this.logger.info("Strategy initialized", {
      event: "strategy_initialized",
      warmupCount: strategyCandles.length
    });

    this.persistThought({
      level: "INFO",
      event: "strategy_initialized",
      message: `Strategy warmed up with ${String(strategyCandles.length)} candles`,
      metadata: {
        warmupCount: strategyCandles.length,
        symbol: this.config.symbol,
        strategy: this.strategy.name,
        ...this.summarizeStrategyStateForLog()
      }
    });
  }

  /**
   * Fetches the latest candle from the exchange.
   */
  private async fetchLatestCandle(): Promise<ExchangeCandle | null> {
    // Step 1: Retrieve candles with a limit of 1.
    const candles = await this.exchange.getLatestCandles({ limit: 1 });
    if (candles.length === 0) {
      this.logger.warn("No candles returned from exchange", {
        event: "candle_empty"
      });
      return null;
    }

    // Step 2: Use the last candle in the response.
    return candles[candles.length - 1] ?? null;
  }

  /**
   * Updates bot heartbeat when interval elapsed.
   */
  private async updateHeartbeatIfNeeded(): Promise<void> {
    const now = Date.now();
    if (this.lastHeartbeatAt === null || now - this.lastHeartbeatAt >= this.heartbeatIntervalMs) {
      await this.stateManager.updateBotHeartbeat(this.id);
      this.lastHeartbeatAt = now;

      // Sync live equity from exchange on every heartbeat so /status stays accurate.
      try {
        const balance = await this.exchange.getBalance();
        if (typeof balance.total === "number" && balance.total > 0) {
          await this.stateManager.updateBotEquity(this.id, balance.total);
        }
      } catch {
        // Non-fatal — stale equity is acceptable between heartbeats.
      }
    }
  }

  /**
   * Waits until the next candle interval, waking periodically so `last_heartbeat` stays fresh.
   *
   * Without chunking, a 4h bot would only write Supabase `bots.last_heartbeat` every ~4h because
   * the main loop sleeps the full bar length after each iteration (including "same candle" waits).
   */
  private async waitForNextCandle(): Promise<void> {
    const intervalMs =
      this.candleIntervalMsOverride ?? intervalToMs(this.config.interval);
    const sliceMs = Math.min(this.heartbeatIntervalMs, intervalMs);
    let remaining = intervalMs;
    while (remaining > 0 && this.isRunning) {
      const step = Math.min(sliceMs, remaining);
      await this.sleep(step);
      remaining -= step;
      await this.updateHeartbeatIfNeeded();
    }
  }

  /**
   * Handles unexpected errors and optionally sends alerts.
   */
  private async handleError(error: unknown): Promise<void> {
    // Step 1: Track error count.
    this.errorCount += 1;

    // Step 2: Log the error.
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error("Bot error", {
      event: "bot_error",
      error: message
    });

    this.persistThought({
      level: "ERROR",
      event: "bot_loop_error",
      message,
      metadata: { errorCount: this.errorCount, symbol: this.config.symbol }
    });

    // Step 3: Send alert when configured.
    if (this.alerting !== undefined) {
      await this.alerting.sendAlert({
        level: "CRITICAL",
        message: `Bot error: ${message}`,
        botId: this.id
      });
    }

    // Step 4: Stop the bot after too many errors.
    if (this.errorCount > 10) {
      this.logger.critical("Too many errors, stopping bot", {
        event: "bot_error_limit",
        errorCount: this.errorCount
      });
      await this.stop();
    }
  }

  /**
   * Converts exchange candles to strategy candles.
   */
  private toStrategyCandle(candle: ExchangeCandle): Candle {
    return {
      timestamp: candle.timeUtcMs,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    };
  }

  /**
   * Converts core DB positions to strategy positions.
   */
  private toStrategyPosition(position: Position): StrategyPosition {
    const base: StrategyPosition = {
      id: position.id,
      side: position.side === "LONG" ? "long" : "short",
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      stopLoss: position.stopLoss ?? position.entryPrice,
      entryTime: position.entryTime
    };
    return position.takeProfit !== undefined ? { ...base, takeProfit: position.takeProfit } : base;
  }

  /**
   * Calculates order quantity based on signal and risk limits.
   */
  private calculateQuantity(signal: Signal, marketPrice: number, equity: number): number {
    // Step 1: Use signal quantity when provided.
    if (this.isPositiveNumber(signal.quantity)) {
      return signal.quantity;
    }

    // Step 2: Get risk parameters with fallback to defaults
    const rawRisk = this.config.params["risk"];
    const riskParams =
      rawRisk !== undefined && typeof rawRisk === "object" && rawRisk !== null
        ? (rawRisk as Record<string, unknown>)
        : undefined;
    let quantity: number;

    if (riskParams?.["sizingMode"] === "fixed_risk_pct") {
      // Risk-based position sizing: risk% of equity per trade
      if (!signal.stopLoss || !this.isPositiveNumber(signal.stopLoss)) {
        throw new Error("Cannot calculate risk-based position size without stop loss.");
      }

      const riskPct = riskParams["riskPctPerTrade"];
      const riskPctNum = typeof riskPct === "number" ? riskPct : Number(riskPct);
      const riskAmount = equity * (riskPctNum / 100);
      const riskPerUnit = Math.abs(marketPrice - signal.stopLoss);
      quantity = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;

    } else if (riskParams?.["sizingMode"] === "fixed_notional") {
      // Fixed notional position sizing
      const fn = riskParams["fixedNotional"];
      const fixedNotional = typeof fn === "number" ? fn : Number(fn);
      quantity = fixedNotional / marketPrice;

    } else {
      // Fallback: use max position size percent
      const maxPositionValue = (equity * this.config.riskManagement.maxPositionSizePct) / 100;
      quantity = maxPositionValue / marketPrice;

      this.logger.debug("Using fallback position sizing", {
        event: "position_sizing_fallback",
        reason: riskParams ? "Unknown sizing mode" : "No risk params configured",
        maxPositionValue,
        quantity
      });
    }

    if (!this.isPositiveNumber(quantity)) {
      throw new Error("Calculated quantity is invalid.");
    }

    // Apply max position size cap
    const maxPositionValue = (equity * this.config.riskManagement.maxPositionSizePct) / 100;
    const maxQuantity = maxPositionValue / marketPrice;

    return Math.min(quantity, maxQuantity);
  }

  /**
   * Sleep helper with Promise.
   */
  private async sleep(durationMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }

  /**
   * Validates a non-empty string.
   */
  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  /**
   * Validates positive numbers.
   */
  private isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}
