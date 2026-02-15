import { DateTime } from "luxon";

import { ExchangeError } from "../exchange/ExchangeError.js";
import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { ExchangeCandle, OrderSide } from "../exchange/types.js";
import { StrategyStateManager } from "../strategy/StrategyStateManager.js";
import {
  calculateStopLoss,
  calculateTakeProfit,
  calculateTrailingStop,
  checkExitConditions,
  generateSignals
} from "../strategy/orbAtrStrategy.js";
import type { Signal, StrategyPosition } from "../strategy/types.js";
import type { SupabaseClient } from "../supabase/client.js";
import type { Database } from "../supabase/database.js";
import { intervalToMinutes } from "../utils/interval.js";

import { BotLogger } from "./BotLogger.js";
import type { BotConfig } from "./botConfigSchema.js";
import { updateBotBalance, updateBotHeartbeat, updateBotStatus } from "./botRepo.js";
import { OrderExecutor } from "./OrderExecutor.js";
import { PerformanceMonitor } from "./PerformanceMonitor.js";
import { PositionManager } from "./PositionManager.js";
import { RiskManager } from "./RiskManager.js";

type LivePositionRow = Database["public"]["Tables"]["live_positions"]["Row"];
type LiveOrderRow = Database["public"]["Tables"]["live_orders"]["Row"];

type TradingBotDependencies = Readonly<{
  strategyStateManager: StrategyStateManager;
  positionManager: PositionManager;
  orderExecutor: OrderExecutor;
  riskManager: RiskManager;
  performanceMonitor: PerformanceMonitor;
  logger: BotLogger;
}>;

type TradingBotArgs = Readonly<{
  botId: string;
  botConfig: BotConfig;
  exchangeAdapter: IExchangeAdapter;
  supabaseClient: SupabaseClient;
  dependencies?: TradingBotDependencies;
}>;

type EntryDecision = Readonly<{
  quantity: number;
  riskAmount: number | null;
  stopLossPrice: number;
  takeProfitPrice: number | null;
}>;

/**
 * Orchestrates live trading for a single bot instance.
 */
export class TradingBot {
  private readonly botId: string;
  private readonly config: BotConfig;
  private readonly adapter: IExchangeAdapter;
  private readonly supabase: SupabaseClient;
  private readonly strategyState: StrategyStateManager;
  private readonly positionManager: PositionManager;
  private readonly orderExecutor: OrderExecutor;
  private readonly riskManager: RiskManager;
  private readonly performanceMonitor: PerformanceMonitor;
  private readonly logger: BotLogger;

  private isActive: boolean;
  private isStopping: boolean;
  private heartbeatHandle: NodeJS.Timeout | null;
  private readonly pollIntervalMs: number;
  private lastCandleTimeMs: number | null;
  private lastHeartbeatAtMs: number | null;
  private lastSnapshotAtMs: number | null;
  private errorStreak: number;
  private errorCount: number;
  private readonly positionEntryIndex: Map<string, number>;
  private lastCandles: readonly ExchangeCandle[];

  /**
   * Creates a new trading bot instance.
   *
   * @param args - Core bot configuration and optional pre-built dependencies.
   */
  public constructor(args: TradingBotArgs) {
    // Step 1: Assign core inputs.
    this.botId = args.botId;
    this.config = args.botConfig;
    this.adapter = args.exchangeAdapter;
    this.supabase = args.supabaseClient;
    // Step 2: Reuse injected dependencies when provided.
    const injected = args.dependencies;
    // Step 3: Build the strategy state manager if not injected.
    this.strategyState =
      injected?.strategyStateManager ??
      new StrategyStateManager({
        timezone: args.botConfig.params.session.timezone,
        startTime: args.botConfig.params.session.startTime,
        openingRangeMinutes: args.botConfig.params.session.openingRangeMinutes,
        atrLength: args.botConfig.params.atr.atrLength,
        intervalMinutes: intervalToMinutes(args.botConfig.params.interval)
      });
    // Step 4: Build the position manager if not injected.
    this.positionManager = injected?.positionManager ?? new PositionManager({ supabase: this.supabase });
    // Step 5: Build the order executor if not injected.
    this.orderExecutor =
      injected?.orderExecutor ??
      new OrderExecutor({
        supabase: this.supabase,
        adapter: this.adapter,
        botId: this.botId,
        exchange: this.config.exchange,
        symbol: this.config.symbol
      });
    // Step 6: Build the risk manager if not injected.
    this.riskManager =
      injected?.riskManager ??
      new RiskManager({
        supabase: this.supabase,
        adapter: this.adapter,
        botId: this.botId,
        params: this.config.params
      });
    // Step 7: Build the performance monitor if not injected.
    this.performanceMonitor =
      injected?.performanceMonitor ??
      new PerformanceMonitor({
        supabase: this.supabase,
        botId: this.botId,
        exchange: this.config.exchange,
        adapter: this.adapter
      });
    // Step 8: Build the logger if not injected.
    this.logger = injected?.logger ?? new BotLogger({ supabase: this.supabase, botId: this.botId });

    // Step 9: Initialize runtime state.
    this.isActive = false;
    this.isStopping = false;
    this.heartbeatHandle = null;
    this.pollIntervalMs = 15_000;
    this.lastCandleTimeMs = null;
    this.lastHeartbeatAtMs = null;
    this.lastSnapshotAtMs = null;
    this.errorStreak = 0;
    this.errorCount = 0;
    this.positionEntryIndex = new Map<string, number>();
    this.lastCandles = [];
  }

  /**
   * Starts the bot by loading state, connecting to exchange, and running the main loop.
   */
  public async start(): Promise<void> {
    this.isStopping = false;
    this.isActive = true;
    await updateBotStatus({
      supabase: this.supabase,
      id: this.botId,
      status: "running",
      startedAt: new Date().toISOString(),
      errorMessage: null
    });

    await this.logger.logInfo({ message: "Bot starting" });
    await this.loadStateFromDb();
    
    // Retry connection with exponential backoff
    await this.logger.logInfo({ message: "Connecting to exchange..." });
    await this.retryWithBackoff(
      async () => {
        await this.adapter.connect();
      },
      { operationName: "connect to exchange", maxAttempts: 5 }
    );
    await this.logger.logInfo({ message: "Connected to exchange" });
    
    // Retry seeding candles with backoff
    await this.logger.logInfo({ message: "Seeding initial candles..." });
    await this.retryWithBackoff(
      async () => {
        await this.seedInitialCandles();
      },
      { operationName: "seed candles", maxAttempts: 3 }
    );
    await this.logger.logInfo({ message: "Seeded initial candles", context: { candleCount: this.lastCandles.length } });
    
    // Retry reconciliation with backoff
    await this.logger.logInfo({ message: "Reconciling with exchange..." });
    await this.retryWithBackoff(
      async () => {
        await this.reconcileWithExchange();
      },
      { operationName: "reconcile with exchange", maxAttempts: 3 }
    );
    await this.logger.logInfo({ message: "Reconciliation complete" });

    this.heartbeatHandle = setInterval(() => {
      this.updateHeartbeat().catch((err: unknown) => {
        this.logger.logError({
          message: "Heartbeat update failed",
          context: { error: String(err) }
        }).catch(() => {
          console.error("[TradingBot] Failed to log heartbeat error:", err);
        });
      });
    }, 30_000);

    await this.logger.logInfo({ message: "Starting main loop..." });
    await this.mainLoop();
  }

  /**
   * Stops the bot and tears down resources.
   */
  public async stop(graceful = true): Promise<void> {
    this.isStopping = true;
    this.isActive = false;

    if (graceful) {
      await this.closeAllPositions("stop_request");
      await this.cancelAllPendingOrders();
    }

    await this.adapter.disconnect();
    await updateBotStatus({
      supabase: this.supabase,
      id: this.botId,
      status: "stopped",
      stoppedAt: new Date().toISOString()
    });

    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }

    await this.logger.logInfo({ message: "Bot stopped" });
    this.logger.close(); // Close file stream
  }

  /**
   * Runs the main trading loop until stopped.
   */
  public async mainLoop(): Promise<void> {
    while (this.isActive && !this.isStopping) {
      try {
        await this.mainLoopOnce();
        this.errorStreak = 0;
      } catch (err: unknown) {
        await this.handleLoopError(err);
        const backoffMs = this.getBackoffMs();
        await this.sleep(backoffMs);
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Executes a single iteration of the main loop.
   */
  private async mainLoopOnce(): Promise<void> {
    const candles = await this.adapter.getLatestCandles({ limit: 2 });
    const latest = candles.at(-1);
    if (latest === undefined) {
      await this.logger.logInfo({ message: "No candles available" });
      return;
    }

    if (this.lastCandleTimeMs === latest.timeUtcMs) {
      await this.monitorPositions(latest);
      return;
    }

    this.lastCandleTimeMs = latest.timeUtcMs;
    this.lastCandles = candles;
    this.strategyState.update(latest);

    const openPositions = await this.positionManager.getOpenPositions(this.botId);
    const openPosition = openPositions[0] ?? null;
    const strategyPosition = openPosition === null ? null : this.mapPositionToStrategy(openPosition, candles);
    const state = this.strategyState.getState();

    await this.logger.logInfo({
      message: "Main loop iteration",
      context: {
        candleTime: new Date(latest.timeUtcMs).toISOString(),
        candleClose: latest.close,
        atr: state.atr,
        sessionActive: state.sessionState.isSessionActive,
        orComplete: state.sessionState.openingRangeComplete,
        orLevels: state.openingRangeLevels,
        tradesThisSession: state.tradesThisSession,
        sessionEntryAllowed: state.sessionEntryAllowed,
        hasPosition: openPosition !== null
      }
    });

    const signal = generateSignals({
      currentCandle: latest,
      previousCandles: state.atrBuffer,
      sessionState: state.sessionState,
      atr: state.atr,
      params: this.config.params,
      currentPosition: strategyPosition,
      tradesThisSession: state.tradesThisSession,
      sessionEntryAllowed: state.sessionEntryAllowed
    });

    this.strategyState.recordSignal(signal);
    
    // Log signal with full context
    await this.logger.logInfo({
      message: `📊 Signal: ${signal.type}`,
      context: {
        signalType: signal.type,
        reason: signal.reason,
        price: latest.close,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        trailingStop: signal.trailingStopPrice,
        size: signal.size
      }
    });
    await this.logger.logSignal({ signal });

    if (signal.type === "ENTRY_LONG" || signal.type === "ENTRY_SHORT") {
      await this.logger.logInfo({
        message: `🚀 ENTRY SIGNAL: ${signal.type} at ${latest.close}`,
        context: {
          side: signal.type === "ENTRY_LONG" ? "LONG" : "SHORT",
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          size: signal.size,
          reason: signal.reason
        }
      });
      await this.executeEntrySignal(signal, latest);
    } else if (signal.type === "EXIT" && openPosition !== null) {
      await this.logger.logInfo({
        message: `🛑 EXIT SIGNAL: ${signal.reason} at ${latest.close}`,
        context: {
          positionSide: openPosition.side,
          entryPrice: openPosition.entryPrice,
          currentPrice: latest.close,
          pnl: (latest.close - openPosition.entryPrice) * openPosition.size * (openPosition.side === "long" ? 1 : -1)
        }
      });
      await this.executeExitSignal(openPosition, signal.reason ?? "strategy_exit");
    } else if (signal.type === "UPDATE_STOPS" && openPosition !== null) {
      await this.logger.logInfo({
        message: `📍 UPDATE STOPS: trailing stop to ${signal.trailingStopPrice}`,
        context: {
          oldStopLoss: openPosition.stopLoss,
          newTrailingStop: signal.trailingStopPrice,
          currentPrice: latest.close
        }
      });
      await this.updateTrailingStop(openPosition, signal.trailingStopPrice);
    } else if (signal.type === "HOLD") {
      // Only log HOLD periodically (every 10th iteration) to avoid spam
      if (Math.random() < 0.1) {
        await this.logger.logInfo({
          message: `⏸️  HOLD: ${signal.reason || "waiting for conditions"}`,
          context: {
            sessionActive: state.sessionState.isSessionActive,
            orComplete: state.sessionState.openingRangeComplete,
            hasPosition: openPosition !== null
          }
        });
      }
    }

    await this.monitorPositions(latest);
  }

  /**
   * Executes an entry signal: size, order, position creation, and protective orders.
   */
  public async executeEntrySignal(signal: Signal, candle: ExchangeCandle): Promise<void> {
    if (signal.direction === null) {
      return;
    }

    const entryPrice = signal.price ?? candle.close;
    const decision = await this.buildEntryDecision(signal, entryPrice);
    if (decision === null) {
      await this.logger.logInfo({
        message: "❌ Entry rejected by risk management",
        context: { direction: signal.direction, price: entryPrice }
      });
      return;
    }

    await this.logger.logInfo({
      message: "💰 Entry decision calculated",
      context: {
        direction: signal.direction,
        quantity: decision.quantity,
        stopLoss: decision.stopLossPrice,
        takeProfit: decision.takeProfitPrice,
        riskAmount: decision.riskAmount,
        riskPercent: decision.riskAmount / this.config.initialBalance * 100
      }
    });

    const orderSide: OrderSide = signal.direction === "long" ? "buy" : "sell";
    await this.logger.logInfo({
      message: `📤 Placing ${orderSide.toUpperCase()} market order`,
      context: { side: orderSide, quantity: decision.quantity }
    });
    
    const entryOrder = await this.orderExecutor.placeMarketOrder({
      side: orderSide,
      quantity: decision.quantity
    });
    
    await this.logger.logInfo({
      message: `⏳ Waiting for order fill...`,
      context: { orderId: entryOrder.id }
    });
    
    const filledOrder = await this.orderExecutor.waitForFill(entryOrder.id, 30_000);

    if (filledOrder.status !== "filled") {
      await this.logger.logError({ 
        message: "❌ Entry order not filled", 
        context: { orderId: entryOrder.id, status: filledOrder.status } 
      });
      return;
    }
    
    await this.logger.logInfo({
      message: `✅ Order filled!`,
      context: {
        orderId: filledOrder.id,
        fillPrice: filledOrder.avg_fill_price ?? filledOrder.price,
        quantity: filledOrder.filled_quantity
      }
    });

    const fillPrice = this.toNumber(filledOrder.avg_fill_price ?? filledOrder.price, "fillPrice");
    const entryTime = filledOrder.filled_at ?? new Date().toISOString();
    const sessionDateNy = this.toSessionDateNy(entryTime, this.config.params.session.timezone);

    const position = await this.positionManager.createPosition({
      botId: this.botId,
      exchange: this.config.exchange,
      symbol: this.config.symbol,
      direction: signal.direction,
      entryOrderId: filledOrder.id,
      entryTime,
      entryPrice: fillPrice,
      quantity: decision.quantity,
      stopLossPrice: decision.stopLossPrice,
      takeProfitPrice: decision.takeProfitPrice,
      trailingStopPrice: null,
      riskAmount: decision.riskAmount,
      sessionDateNy
    });

    this.positionEntryIndex.set(position.id, this.resolveEntryIndex(candle, this.lastCandles));
    this.strategyState.recordTrade();

    await this.logger.logInfo({
      message: `📊 Position opened`,
      context: {
        positionId: position.id,
        direction: position.direction,
        entryPrice: fillPrice,
        quantity: decision.quantity,
        stopLoss: decision.stopLossPrice,
        takeProfit: decision.takeProfitPrice
      }
    });

    const stopSide: OrderSide = signal.direction === "long" ? "sell" : "buy";
    await this.logger.logInfo({
      message: `🛡️  Placing stop loss order`,
      context: { stopPrice: decision.stopLossPrice }
    });
    
    const stopOrder = await this.orderExecutor.placeStopLossOrder({
      side: stopSide,
      quantity: decision.quantity,
      stopPrice: decision.stopLossPrice,
      parentPositionId: position.id
    });
    await this.positionManager.updatePosition(position.id, { stop_order_id: stopOrder.id });
    
    await this.logger.logInfo({
      message: `✅ Stop loss placed`,
      context: { orderId: stopOrder.id, stopPrice: decision.stopLossPrice }
    });

    if (decision.takeProfitPrice !== null) {
      await this.logger.logInfo({
        message: `🎯 Placing take profit order`,
        context: { takeProfitPrice: decision.takeProfitPrice }
      });
      
      const tpOrder = await this.orderExecutor.placeTakeProfitOrder({
        side: stopSide,
        quantity: decision.quantity,
        takeProfitPrice: decision.takeProfitPrice,
        parentPositionId: position.id
      });
      await this.positionManager.updatePosition(position.id, { tp_order_id: tpOrder.id });
      
      await this.logger.logInfo({
        message: `✅ Take profit placed`,
        context: { orderId: tpOrder.id, takeProfitPrice: decision.takeProfitPrice }
      });
    }

    await this.logger.logPositionOpened({ position });
  }

  /**
   * Executes an exit signal for an open position.
   */
  public async executeExitSignal(position: LivePositionRow, exitReason: string): Promise<void> {
    const side: OrderSide = position.direction === "long" ? "sell" : "buy";
    const quantity = this.toNumber(position.quantity, "exitQuantity");

    await this.logger.logInfo({
      message: `🚪 Exiting position: ${exitReason}`,
      context: {
        positionId: position.id,
        direction: position.direction,
        entryPrice: position.entry_price,
        quantity,
        reason: exitReason
      }
    });

    await this.logger.logInfo({
      message: `📤 Placing ${side.toUpperCase()} market order to close`,
      context: { side, quantity }
    });

    const exitOrder = await this.orderExecutor.placeMarketOrder({
      side,
      quantity,
      parentPositionId: position.id
    });
    
    await this.logger.logInfo({
      message: `⏳ Waiting for exit order fill...`,
      context: { orderId: exitOrder.id }
    });
    
    const filled = await this.orderExecutor.waitForFill(exitOrder.id, 30_000);

    await this.logger.logInfo({
      message: `✅ Exit order filled`,
      context: {
        orderId: filled.id,
        fillPrice: filled.avg_fill_price ?? filled.price,
        quantity: filled.filled_quantity
      }
    });

    if (position.stop_order_id !== null) {
      await this.logger.logInfo({ message: `🗑️  Cancelling stop loss order` });
      await this.safeCancelOrder(position.stop_order_id);
    }
    if (position.tp_order_id !== null) {
      await this.logger.logInfo({ message: `🗑️  Cancelling take profit order` });
      await this.safeCancelOrder(position.tp_order_id);
    }

    const trade = await this.positionManager.closePosition({
      positionId: position.id,
      exitOrder: filled,
      exitReason
    });

    const pnl = (this.toNumber(trade.exit_price, "exitPrice") - this.toNumber(trade.entry_price, "entryPrice")) * 
                this.toNumber(trade.quantity, "quantity") * 
                (trade.direction === "long" ? 1 : -1);
    
    await this.logger.logInfo({
      message: `💵 Position closed`,
      context: {
        tradeId: trade.id,
        direction: trade.direction,
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        pnl,
        pnlPercent: (pnl / (this.toNumber(trade.entry_price, "entryPrice") * this.toNumber(trade.quantity, "quantity"))) * 100,
        reason: exitReason
      }
    });

    await this.logger.logPositionClosed({ trade });
  }

  /**
   * Monitors open positions, updates PnL, and evaluates exit conditions.
   */
  public async monitorPositions(currentCandle: ExchangeCandle): Promise<void> {
    const positions = await this.positionManager.getOpenPositions(this.botId);
    if (positions.length === 0) {
      return;
    }

    const lastPrice = currentCandle.close;
    const state = this.strategyState.getState();

    for (const position of positions) {
      const unrealized = this.positionManager.calculateUnrealizedPnL(position, lastPrice);
      await this.positionManager.updatePosition(position.id, {
        current_price: lastPrice,
        unrealized_pnl: unrealized
      });

      const trailingStop = this.getTrailingStopUpdate(position, lastPrice, state);
      if (trailingStop !== null) {
        await this.updateTrailingStop(position, trailingStop);
      }

      const entryIndex = this.positionEntryIndex.get(position.id) ?? this.resolveEntryIndex(currentCandle, this.lastCandles);
      const strategyPosition = this.mapPositionToStrategy(position, this.lastCandles, entryIndex);
      const exitSignal = checkExitConditions({
        position: strategyPosition,
        currentCandle,
        sessionState: state.sessionState,
        params: this.config.params,
        barsSinceEntry: Math.max(0, this.lastCandles.length - 1 - strategyPosition.entryIndex)
      });

      if (exitSignal !== null) {
        await this.executeExitSignal(position, exitSignal.reason);
      }
    }
  }

  /**
   * Updates the last heartbeat, balances, and snapshot.
   */
  public async updateHeartbeat(): Promise<void> {
    // Step 1: Record heartbeat timing.
    const now = Date.now();
    this.lastHeartbeatAtMs = now;

    // Step 2: Load the latest balances and positions.
    const balance = await this.adapter.getBalance();
    const positions = await this.positionManager.getOpenPositions(this.botId);
    const totalUnrealized = positions.reduce((sum, position) => {
      const currentPrice = position.current_price === null ? null : this.toOptionalNumber(position.current_price);
      if (currentPrice === null) {
        return sum;
      }
      return sum + this.positionManager.calculateUnrealizedPnL(position, currentPrice);
    }, 0);
    const equity = balance.total + totalUnrealized;

    // Step 3: Persist balance and heartbeat updates.
    await updateBotBalance({
      supabase: this.supabase,
      id: this.botId,
      balance: balance.total,
      equity
    });
    await updateBotHeartbeat({ supabase: this.supabase, id: this.botId });

    // Step 4: Capture periodic snapshots on a rolling schedule.
    const shouldSnapshot = this.lastSnapshotAtMs === null || now - this.lastSnapshotAtMs >= 60 * 60 * 1000;
    if (shouldSnapshot) {
      this.lastSnapshotAtMs = now;
      await this.performanceMonitor.captureSnapshot(this.botId, "periodic");
    }
  }

  private async loadStateFromDb(): Promise<void> {
    const result = await this.supabase
      .from("live_orders")
      .select("*")
      .eq("bot_id", this.botId)
      .in("status", ["pending", "submitted", "partial"]);

    if (result.error !== null) {
      throw result.error;
    }

    const positions = await this.positionManager.getOpenPositions(this.botId);
    for (const position of positions) {
      const entryIndex = this.resolveEntryIndexFromPosition(position);
      this.positionEntryIndex.set(position.id, entryIndex);
    }

    await this.logger.logInfo({
      message: "Loaded state from DB",
      context: { pendingOrders: result.data?.length ?? 0, openPositions: positions.length }
    });
  }

  private async seedInitialCandles(): Promise<void> {
    const candles = await this.adapter.getLatestCandles({ limit: 100 });
    this.lastCandles = candles;
    for (const candle of candles) {
      this.strategyState.update(candle);
    }
    const latest = candles.at(-1);
    if (latest !== undefined) {
      this.lastCandleTimeMs = latest.timeUtcMs;
    }
  }

  private async reconcileWithExchange(): Promise<void> {
    await this.logger.logInfo({ message: "Fetching exchange position..." });
    
    let exchangePosition: Position | null = null;
    let exchangeOrders: readonly Order[] = [];
    
    try {
      exchangePosition = await this.adapter.getPosition();
      await this.logger.logInfo({ message: "Fetched position", context: { hasPosition: exchangePosition !== null } });
    } catch (err: unknown) {
      await this.logger.logError({ 
        message: "Failed to fetch position, assuming no position", 
        context: { error: err instanceof Error ? err.message : "Unknown error" } 
      });
    }
    
    try {
      exchangeOrders = await this.adapter.getOpenOrders();
      await this.logger.logInfo({ message: "Fetched open orders", context: { count: exchangeOrders.length } });
    } catch (err: unknown) {
      await this.logger.logError({ 
        message: "Failed to fetch open orders, assuming no orders", 
        context: { error: err instanceof Error ? err.message : "Unknown error" } 
      });
    }
    
    await this.logger.logInfo({ 
      message: "Fetched exchange state", 
      context: { 
        hasPosition: exchangePosition !== null, 
        openOrderCount: exchangeOrders.length 
      } 
    });

    const dbPositions = await this.positionManager.getOpenPositions(this.botId);
    if (exchangePosition === null && dbPositions.length > 0) {
      for (const position of dbPositions) {
        await this.positionManager.updatePosition(position.id, {
          status: "closed",
          closed_at: new Date().toISOString(),
          exit_reason: "reconciled"
        });
      }
    }

    if (exchangePosition !== null && dbPositions.length === 0) {
      await this.positionManager.createPosition({
        botId: this.botId,
        exchange: this.config.exchange,
        symbol: exchangePosition.symbol,
        direction: exchangePosition.side,
        entryOrderId: null,
        entryTime: exchangePosition.openedAtUtc,
        entryPrice: exchangePosition.entryPrice,
        quantity: exchangePosition.quantity,
        stopLossPrice: null,
        takeProfitPrice: null,
        trailingStopPrice: null,
        riskAmount: null,
        sessionDateNy: this.toSessionDateNy(exchangePosition.openedAtUtc, this.config.params.session.timezone)
      });
    }

    const pendingDbOrders = await this.supabase
      .from("live_orders")
      .select("*")
      .eq("bot_id", this.botId)
      .in("status", ["pending", "submitted", "partial"]);
    if (pendingDbOrders.error === null && pendingDbOrders.data !== null) {
      if (exchangeOrders.length !== pendingDbOrders.data.length) {
        await this.logger.logInfo({
          message: "Order count mismatch during reconcile",
          context: {
            exchangeOrders: exchangeOrders.length,
            dbOrders: pendingDbOrders.data.length
          }
        });
      }
    }
  }

  private async handleLoopError(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : "Unknown error";
    this.errorStreak += 1;
    this.errorCount += 1;

    await this.logger.logError({
      message: "Main loop error",
      context: { message }
    });
    await this.updateErrorCount(message);

    if (this.errorCount > 10 || this.isCriticalError(err)) {
      await this.pauseBot(message);
      this.isActive = false;
    }
  }

  private isCriticalError(err: unknown): boolean {
    if (err instanceof ExchangeError) {
      return ["INVALID_SYMBOL", "INVALID_ORDER", "UNSUPPORTED", "INSUFFICIENT_BALANCE"].includes(err.code);
    }
    return false;
  }

  private getBackoffMs(): number {
    const baseMs = 1_000;
    const step = Math.pow(2, Math.max(0, this.errorStreak - 1));
    return Math.min(30_000, baseMs * step);
  }

  private async updateErrorCount(message: string): Promise<void> {
    const result = await this.supabase
      .from("bots")
      .update({
        error_count: this.errorCount,
        error_message: message
      })
      .eq("id", this.botId);

    if (result.error !== null) {
      throw result.error;
    }
  }

  private async pauseBot(reason: string): Promise<void> {
    await updateBotStatus({
      supabase: this.supabase,
      id: this.botId,
      status: "paused",
      errorMessage: reason
    });
  }

  private async closeAllPositions(reason: string): Promise<void> {
    const positions = await this.positionManager.getOpenPositions(this.botId);
    for (const position of positions) {
      await this.executeExitSignal(position, reason);
    }
  }

  private async cancelAllPendingOrders(): Promise<void> {
    const result = await this.supabase
      .from("live_orders")
      .select("*")
      .eq("bot_id", this.botId)
      .in("status", ["pending", "submitted", "partial"]);

    if (result.error !== null || result.data === null) {
      return;
    }

    for (const order of result.data as LiveOrderRow[]) {
      await this.safeCancelOrder(order.id);
    }
  }

  private async safeCancelOrder(orderId: string): Promise<void> {
    try {
      await this.orderExecutor.cancelOrder(orderId);
    } catch (err: unknown) {
      await this.logger.logError({
        message: "Failed to cancel order",
        context: { orderId, error: err instanceof Error ? err.message : "Unknown error" }
      });
    }
  }

  private async buildEntryDecision(signal: Signal, entryPrice: number): Promise<EntryDecision | null> {
    if (signal.direction === null) {
      return null;
    }

    const state = this.strategyState.getState();
    const stopLoss = calculateStopLoss({
      entryPrice,
      direction: signal.direction,
      atr: state.atr,
      params: this.config.params,
      openingRangeLevels: state.openingRangeLevels
    });

    if (stopLoss === null) {
      await this.logger.logError({ message: "Stop loss unavailable for entry" });
      return null;
    }

    const takeProfit = calculateTakeProfit(entryPrice, stopLoss, signal.direction, this.config.params);
    const sizing = await this.calculatePositionSize(entryPrice, stopLoss);
    if (sizing.quantity <= 0 || !Number.isFinite(sizing.quantity)) {
      await this.logger.logError({ message: "Position size is zero" });
      return null;
    }

    const riskSignal: Signal = {
      ...signal,
      price: entryPrice,
      quantity: sizing.quantity
    };
    const riskResult = await this.riskManager.checkPreTradeRisk(this.botId, riskSignal);
    if (!riskResult.allowed) {
      await this.logger.logInfo({
        message: "Risk check blocked entry",
        context: { reason: riskResult.reason ?? "unknown" }
      });
      return null;
    }

    return {
      quantity: sizing.quantity,
      riskAmount: sizing.riskAmount,
      stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit
    };
  }

  private async calculatePositionSize(entryPrice: number, stopLoss: number): Promise<{
    quantity: number;
    riskAmount: number | null;
  }> {
    const balance = await this.adapter.getBalance();
    
    // CRITICAL: Log balance details for debugging position sizing
    await this.logger.logInfo({
      message: "💰 Balance fetched for position sizing",
      context: {
        event: "balance_fetch",
        available: balance.available,
        locked: balance.locked,
        total: balance.total,
        currency: balance.currency,
        entryPrice,
        stopLoss,
        riskPerUnit: Math.abs(entryPrice - stopLoss)
      }
    });
    
    const originalBalance = balance.total;
    let cappedBalance = balance.total;
    
    // SAFETY CHECK #1: Verify balance is reasonable (not leveraged equity)
    if (balance.total > this.config.initialBalance * 2) {
      cappedBalance = Math.min(balance.total, this.config.initialBalance);
      await this.logger.logWarn({
        message: "⚠️ Balance appears inflated (possibly leveraged equity). Using conservative value.",
        context: {
          event: "balance_warning",
          reportedBalance: balance.total,
          configInitialBalance: this.config.initialBalance,
          usingBalance: cappedBalance
        }
      });
    }
    
    const quantity = this.riskManager.calculatePositionSize({
      sizingMode: this.config.params.risk.sizingMode,
      entryPrice,
      stopLossPrice: stopLoss,
      equity: cappedBalance,
      availableBalance: balance.available,
      riskPctPerTrade: this.config.params.risk.riskPctPerTrade,
      fixedNotional: this.config.params.risk.fixedNotional,
      maxPositionSizePct: this.config.riskManagement.maxPositionSizePct
    });

    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    const riskAmount =
      this.config.params.risk.sizingMode === "fixed_risk_pct" && riskPerUnit > 0 ? riskPerUnit * quantity : null;
    
    const positionNotional = quantity * entryPrice;
    
    // CRITICAL SAFETY CHECK #2: Position size sanity check
    if (positionNotional > originalBalance * 10) {
      const errorMsg = 
        `🚨 CRITICAL: Position size too large! ` +
        `Notional: ${positionNotional.toFixed(2)} ${balance.currency}, ` +
        `Balance: ${originalBalance.toFixed(2)} ${balance.currency}. ` +
        `This would be ${(positionNotional / originalBalance).toFixed(1)}x your balance. ` +
        `Check your leverage settings and risk parameters.`;
      await this.logger.logError({ message: errorMsg });
      throw new Error(errorMsg);
    }
    
    // Log final position size calculation
    await this.logger.logInfo({
      message: "✅ Position size calculated",
      context: {
        event: "position_size_calc",
        quantity,
        entryPrice,
        positionNotional,
        balanceUsed: cappedBalance,
        notionalPctOfBalance: ((positionNotional / cappedBalance) * 100).toFixed(2) + "%",
        riskAmount,
        stopLoss
      }
    });

    return { quantity, riskAmount };
  }

  private mapPositionToStrategy(position: LivePositionRow, candles: readonly ExchangeCandle[], entryIndexOverride?: number): StrategyPosition {
    const entryIndex = entryIndexOverride ?? this.positionEntryIndex.get(position.id) ?? this.resolveEntryIndexFromPosition(position);
    const entryTimeUtcMs = Date.parse(position.entry_time);
    const entryPrice = this.toNumber(position.entry_price, "entryPrice");
    const quantity = this.toNumber(position.quantity, "quantity");
    const stopPrice = this.toNumber(position.stop_loss_price ?? entryPrice, "stopPrice");
    const takeProfitPrice = this.toOptionalNumber(position.take_profit_price);
    const trailingStopPrice = this.toOptionalNumber(position.trailing_stop_price);
    const initialRiskPerUnit = Math.abs(entryPrice - stopPrice);

    return {
      direction: position.direction as "long" | "short",
      entryIndex,
      entryTimeUtcMs,
      entryPrice,
      quantity,
      stopPrice,
      takeProfitPrice,
      trailingStopPrice,
      initialRiskPerUnit,
      sessionDateNy: position.session_date_ny
    };
  }

  private getTrailingStopUpdate(position: LivePositionRow, currentPrice: number, state: ReturnType<StrategyStateManager["getState"]>): number | null {
    const strategyPosition = this.mapPositionToStrategy(position, this.lastCandles);
    return calculateTrailingStop({
      position: strategyPosition,
      currentPrice,
      atr: state.atr,
      params: this.config.params
    });
  }

  private async updateTrailingStop(position: LivePositionRow, trailingStopPrice: number | null): Promise<void> {
    if (trailingStopPrice === null) {
      return;
    }

    await this.positionManager.updatePosition(position.id, {
      trailing_stop_price: trailingStopPrice,
      stop_loss_price: trailingStopPrice
    });

    if (position.stop_order_id !== null) {
      await this.safeCancelOrder(position.stop_order_id);
    }

    const stopSide: OrderSide = position.direction === "long" ? "sell" : "buy";
    const quantity = this.toNumber(position.quantity, "quantity");
    const stopOrder = await this.orderExecutor.placeStopLossOrder({
      side: stopSide,
      quantity,
      stopPrice: trailingStopPrice,
      parentPositionId: position.id
    });
    await this.positionManager.updatePosition(position.id, { stop_order_id: stopOrder.id });
  }

  private resolveEntryIndex(candle: ExchangeCandle, candles: readonly ExchangeCandle[]): number {
    const match = candles.findIndex((item) => item.timeUtcMs === candle.timeUtcMs);
    if (match >= 0) {
      return match;
    }
    return Math.max(0, candles.length - 1);
  }

  private resolveEntryIndexFromPosition(position: LivePositionRow): number {
    const entryTimeMs = Date.parse(position.entry_time);
    const match = this.lastCandles.findIndex((candle) => candle.timeUtcMs >= entryTimeMs);
    if (match >= 0) {
      return match;
    }
    return Math.max(0, this.lastCandles.length - 1);
  }

  private toSessionDateNy(utcIso: string, timezone: string): string {
    return DateTime.fromISO(utcIso, { zone: "utc" }).setZone(timezone).toISODate() ?? utcIso.slice(0, 10);
  }

  private toNumber(value: unknown, label: string): number {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`${label} must be a finite number`);
    }
    return Number(parsed);
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Number(parsed);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retries an operation with exponential backoff.
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    options: Readonly<{
      operationName: string;
      maxAttempts?: number;
      initialDelayMs?: number;
      maxDelayMs?: number;
    }>
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 3;
    const initialDelayMs = options.initialDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 30_000;
    
    let lastError: unknown;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (err: unknown) {
        lastError = err;
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        if (attempt < maxAttempts) {
          const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          await this.logger.logError({
            message: `Failed to ${options.operationName} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
            context: { error: errorMessage }
          });
          await this.sleep(delayMs);
        } else {
          await this.logger.logError({
            message: `Failed to ${options.operationName} after ${maxAttempts} attempts`,
            context: { error: errorMessage }
          });
        }
      }
    }
    
    throw lastError;
  }
}
