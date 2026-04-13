import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { Order as ExchangeOrder, OrderSide } from "../exchange/types.js";

import { Logger } from "./Logger";
import type { BotStateStore } from "./BotStateStore.js";
import { isBotStateStore } from "./BotStateStore.js";
import type { Order, OrderStatus, Position, PositionSide, TradeCandleBundle } from "./types";
import type { Signal } from "../strategies/IStrategy";

/**
 * Result returned after executing an entry order.
 */
export type EntryExecutionResult = Readonly<{
  exchangeOrder: ExchangeOrder;
  position: Position;
}>;

/**
 * Result returned after executing an exit order.
 */
export type ExitExecutionResult = Readonly<{
  exchangeOrder: ExchangeOrder;
  exitPrice: number;
}>;

/**
 * OrderExecutor places and records orders through the exchange adapter.
 */
export class OrderExecutor {
  private readonly exchange: IExchangeAdapter;
  private readonly stateManager: BotStateStore;
  private readonly logger: Logger;
  private readonly orderPollIntervalMs: number;
  private readonly orderPollAttempts: number;

  /**
   * Creates a new OrderExecutor instance.
   *
   * Inputs:
   * - exchange: Exchange adapter for order placement.
   * - stateManager: SQLite state manager.
   * - logger: Structured logger.
   *
   * Outputs:
   * - OrderExecutor instance.
   *
   * Error behavior:
   * - Throws on invalid dependencies.
   */
  constructor(
    exchange: IExchangeAdapter,
    stateManager: BotStateStore,
    logger: Logger,
    options?: Readonly<{ orderPollIntervalMs?: number; orderPollAttempts?: number }>
  ) {
    // Step 1: Validate dependencies.
    if (exchange === null || exchange === undefined) {
      throw new Error("OrderExecutor requires a valid exchange adapter.");
    }
    if (!isBotStateStore(stateManager)) {
      throw new Error("OrderExecutor requires a valid BotStateStore instance.");
    }
    if (!(logger instanceof Logger)) {
      throw new Error("OrderExecutor requires a valid Logger instance.");
    }

    // Step 2: Store dependencies and options.
    this.exchange = exchange;
    this.stateManager = stateManager;
    this.logger = logger;
    this.orderPollIntervalMs = options?.orderPollIntervalMs ?? 1000;
    this.orderPollAttempts = options?.orderPollAttempts ?? 10;
  }

  /**
   * Executes an entry order and records state.
   *
   * Inputs:
   * - botId: Bot identifier.
   * - symbol: Trading symbol.
   * - signal: Strategy entry signal.
   * - quantity: Order quantity.
   * - marketPrice: Current market price (fallback).
   *
   * Outputs:
   * - EntryExecutionResult with exchange order and DB position.
   *
   * Error behavior:
   * - Throws when order placement fails or validation fails.
   */
  async executeEntry(args: Readonly<{
    botId: string;
    symbol: string;
    signal: Signal;
    quantity: number;
    marketPrice: number;
  }>): Promise<EntryExecutionResult> {
    // Step 1: Validate inputs.
    if (!this.isNonEmptyString(args.botId) || !this.isNonEmptyString(args.symbol)) {
      throw new Error("Entry execution requires valid botId and symbol.");
    }
    if (!this.isEntrySignal(args.signal)) {
      throw new Error("Entry execution requires a valid ENTRY signal.");
    }
    if (!this.isPositiveNumber(args.quantity)) {
      throw new Error("Entry execution requires a positive quantity.");
    }

    const entrySide = args.signal.side;
    if (entrySide !== "long" && entrySide !== "short") {
      throw new Error("Entry execution requires signal.side long or short.");
    }

    // Step 2: Place the entry market order.
    const orderSide = this.toOrderSide(entrySide);
    this.logger.info("Placing entry market order", {
      event: "order_entry_market",
      botId: args.botId,
      side: orderSide,
      quantity: args.quantity
    });

    const exchangeOrder = await this.exchange.placeMarketOrder({
      side: orderSide,
      quantity: args.quantity
    });

    // Step 3: Wait for a fill if needed.
    const finalizedOrder = await this.waitForOrderFill(exchangeOrder);

    // Step 4: Persist the exchange order into SQLite.
    await this.stateManager.createOrder(
      this.toCoreOrder(args.botId, args.symbol, entrySide, finalizedOrder)
    );

    // Step 5: Create a DB position from the filled order.
    const fillPrice = this.getFillPrice(finalizedOrder, args.marketPrice);
    const basePosition: Position = {
      id: "pending",
      botId: args.botId,
      symbol: args.symbol,
      side: this.toPositionSide(entrySide),
      quantity: args.quantity,
      entryPrice: fillPrice,
      entryTime: Date.now()
    };
    const position: Position = {
      ...basePosition,
      ...(args.signal.stopLoss !== undefined ? { stopLoss: args.signal.stopLoss } : {}),
      ...(args.signal.takeProfit !== undefined ? { takeProfit: args.signal.takeProfit } : {})
    };

    const positionId = await this.stateManager.createPosition(position);
    const createdPosition: Position = { ...position, id: positionId };

    // Step 6: Place protective stop/take-profit orders when provided.
    await this.placeRiskOrders(args.signal, args.quantity, args.marketPrice);

    // Step 7: Return results.
    return {
      exchangeOrder: finalizedOrder,
      position: createdPosition
    };
  }

  /**
   * Executes an exit order and closes the DB position.
   *
   * Inputs:
   * - botId: Bot identifier.
   * - position: Open DB position.
   * - marketPrice: Current market price.
   * - reason: Exit reason for audit logging.
   *
   * Outputs:
   * - ExitExecutionResult with exchange order and exit price.
   *
   * Error behavior:
   * - Throws when order placement fails or validation fails.
   */
  async executeExit(args: Readonly<{
    botId: string;
    position: Position;
    marketPrice: number;
    reason: string;
  }>): Promise<ExitExecutionResult> {
    // Step 1: Validate inputs.
    if (!this.isNonEmptyString(args.botId) || !this.isNonEmptyString(args.reason)) {
      throw new Error("Exit execution requires valid botId and reason.");
    }
    if (!this.isPositiveNumber(args.marketPrice)) {
      throw new Error("Exit execution requires a positive market price.");
    }

    // Step 2: Place the exit market order.
    const exitSide = this.toExitOrderSide(args.position.side);
    this.logger.info("Placing exit market order", {
      event: "order_exit_market",
      botId: args.botId,
      side: exitSide,
      quantity: args.position.quantity
    });

    const exchangeOrder = await this.exchange.placeMarketOrder({
      side: exitSide,
      quantity: args.position.quantity
    });

    // Step 3: Wait for a fill if needed.
    const finalizedOrder = await this.waitForOrderFill(exchangeOrder);

    // Step 4: Persist the exchange order into SQLite.
    await this.stateManager.createOrder(
      this.toCoreOrder(args.botId, args.position.symbol, args.position.side === "LONG" ? "long" : "short", finalizedOrder)
    );

    // Step 5: Optional multi-timeframe klines for dashboard trade charts (`trade_candles`).
    const exitPrice = this.getFillPrice(finalizedOrder, args.marketPrice);
    const exitTimeUtcMs = Date.now();
    let tradeCandles: ReadonlyArray<TradeCandleBundle> | undefined;
    const fetchBundles = this.exchange.fetchTradeCandleBundlesForRange;
    if (typeof fetchBundles === "function") {
      try {
        const raw = await fetchBundles.call(this.exchange, {
          symbol: args.position.symbol,
          entryTimeUtcMs: args.position.entryTime,
          exitTimeUtcMs: exitTimeUtcMs
        });
        if (raw.length > 0) {
          tradeCandles = raw;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn("Failed to fetch trade chart candles; closing without trade_candles", {
          event: "trade_exit_candles_failed",
          botId: args.botId,
          positionId: args.position.id,
          message
        });
      }
    }

    // Step 6: Close the DB position using the fill price.
    await this.stateManager.closePosition(args.position.id, exitPrice, args.reason, tradeCandles);

    return { exchangeOrder: finalizedOrder, exitPrice };
  }

  /**
   * Places stop loss and take profit orders based on signal data.
   */
  private async placeRiskOrders(signal: Signal, quantity: number, marketPrice: number): Promise<void> {
    // Step 1: Skip when no SL/TP provided.
    if (signal.type !== "ENTRY" || signal.side === undefined) {
      return;
    }

    const exitSide = this.toOrderSide(this.getExitSignalSide(signal.side));

    // Step 2: Place stop loss order when configured.
    if (this.isPositiveNumber(signal.stopLoss)) {
      await this.exchange.placeStopLossOrder({
        side: exitSide,
        quantity,
        stopPrice: signal.stopLoss
      });
      this.logger.info("Placed stop loss order", {
        event: "order_stop_loss",
        stopLoss: signal.stopLoss,
        quantity
      });
    }

    // Step 3: Place take profit order when configured.
    if (this.isPositiveNumber(signal.takeProfit)) {
      await this.exchange.placeTakeProfitOrder({
        side: exitSide,
        quantity,
        takeProfitPrice: signal.takeProfit
      });
      this.logger.info("Placed take profit order", {
        event: "order_take_profit",
        takeProfit: signal.takeProfit,
        quantity
      });
    }

    // Step 4: Log when no risk orders were placed.
    if (!this.isPositiveNumber(signal.stopLoss) && !this.isPositiveNumber(signal.takeProfit)) {
      this.logger.info("No stop loss or take profit configured", {
        event: "order_risk_none",
        marketPrice
      });
    }
  }

  /**
   * Waits for a filled order by polling the exchange when needed.
   */
  private async waitForOrderFill(order: ExchangeOrder): Promise<ExchangeOrder> {
    // Step 1: Return early if already filled.
    if (order.status === "filled") {
      return order;
    }

    // Step 2: Poll for updated order status.
    let lastOrder = order;
    for (let attempt = 0; attempt < this.orderPollAttempts; attempt += 1) {
      await this.sleep(this.orderPollIntervalMs);
      const updated = await this.exchange.getOrder(order.id);
      if (updated !== null) {
        lastOrder = updated;
      }
      if (updated?.status === "filled") {
        return updated;
      }
      if (updated?.status === "rejected" || updated?.status === "cancelled") {
        throw new Error(`Order ${order.id} ${updated.status}.`);
      }
    }

    // Step 3: Return the last known order state after timeout.
    return lastOrder;
  }

  /**
   * Converts exchange order to core order type.
   */
  private toCoreOrder(
    botId: string,
    symbol: string,
    signalSide: "long" | "short",
    order: ExchangeOrder
  ): Order {
    const priceRaw = order.price ?? order.averageFillPrice;
    const base: Order = {
      id: "pending",
      botId,
      clientOrderId: order.id,
      exchangeOrderId: order.id,
      symbol,
      side: this.toPositionSide(signalSide),
      quantity: order.quantity,
      status: this.toCoreOrderStatus(order.status),
      createdAt: this.parseUtcMs(order.createdAtUtc)
    };
    return {
      ...base,
      ...(priceRaw !== undefined && priceRaw !== null ? { price: priceRaw } : {}),
      ...(order.filledAtUtc !== undefined && order.filledAtUtc !== null
        ? { filledAt: this.parseUtcMs(order.filledAtUtc) }
        : {})
    };
  }

  /**
   * Maps exchange order status to core order status.
   */
  private toCoreOrderStatus(status: ExchangeOrder["status"]): OrderStatus {
    switch (status) {
      case "pending":
      case "open":
        return "PLACED";
      case "filled":
        return "FILLED";
      case "cancelled":
        return "CANCELED";
      case "rejected":
        return "REJECTED";
      default:
        return "NEW";
    }
  }

  /**
   * Returns a fill price from an exchange order with a fallback.
   */
  private getFillPrice(order: ExchangeOrder, fallbackPrice: number): number {
    const price = order.averageFillPrice ?? order.price ?? fallbackPrice;
    if (!this.isPositiveNumber(price)) {
      throw new Error("Filled order is missing a valid price.");
    }
    return price;
  }

  /**
   * Maps a strategy side to exchange order side.
   */
  private toOrderSide(side: "long" | "short"): OrderSide {
    return side === "long" ? "buy" : "sell";
  }

  /**
   * Maps a strategy side to core position side.
   */
  private toPositionSide(side: "long" | "short"): PositionSide {
    return side === "long" ? "LONG" : "SHORT";
  }

  /**
   * Maps a core position side to exit order side.
   */
  private toExitOrderSide(side: PositionSide): OrderSide {
    return side === "LONG" ? "sell" : "buy";
  }

  /**
   * Returns the opposite strategy side for exits.
   */
  private getExitSignalSide(side: "long" | "short"): "long" | "short" {
    return side === "long" ? "short" : "long";
  }

  /**
   * Parse UTC timestamp to milliseconds.
   */
  private parseUtcMs(value: string): number {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }

  /**
   * Simple sleep helper.
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
   * Validates a positive number.
   */
  private isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  /**
   * Validates an entry signal shape.
   */
  private isEntrySignal(signal: Signal): boolean {
    return signal.type === "ENTRY" && (signal.side === "long" || signal.side === "short");
  }
}
