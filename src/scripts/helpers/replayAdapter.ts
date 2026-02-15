import { randomUUID } from "node:crypto";

import type { ExchangeCandle, Order, OrderSide, OrderStatus, RateLimitStatus } from "../../../apps/api/src/exchange/types.js";
import type { Balance, Position } from "../../../apps/api/src/exchange/types.js";
import type { IExchangeAdapter } from "../../../apps/api/src/exchange/IExchangeAdapter.js";
import type { YahooInterval } from "../../../apps/api/src/data/yahooFinance.js";

type ReplayAdapterOptions = Readonly<{
  candles: readonly ExchangeCandle[];
  symbol: string;
  interval: YahooInterval;
  initialBalance: number;
  feeBps?: number;
  slippageBps?: number;
  currency?: string;
}>;

type InternalPosition = Readonly<{
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  openedAtUtc: string;
  updatedAtUtc: string;
  realizedPnl: number;
  totalFeesPaid: number;
}>;

/**
 * ReplayExchangeAdapter replays a fixed candle set for deterministic simulations.
 *
 * Inputs:
 * - candles: Candle sequence to replay.
 * - symbol/interval: Market identifiers for validation.
 * - initialBalance: Starting account balance.
 *
 * Outputs:
 * - IExchangeAdapter implementation for testing and benchmarks.
 *
 * Error behavior:
 * - Throws on invalid inputs or missing prices.
 */
export class ReplayExchangeAdapter implements IExchangeAdapter {
  private readonly candles: readonly ExchangeCandle[];
  private readonly symbol: string;
  private readonly interval: YahooInterval;
  private readonly feeBps: number;
  private readonly slippageBps: number;
  private readonly currency: string;
  private isConnectedFlag = false;
  private currentIndex = -1;
  private lastPrice: number | null = null;
  private balanceTotal: number;
  private position: InternalPosition | null = null;
  private readonly orders = new Map<string, Order>();

  /**
   * Creates a new replay adapter for deterministic simulation.
   */
  constructor(options: ReplayAdapterOptions) {
    // Step 1: Validate inputs.
    if (options.candles.length === 0) {
      throw new Error("Replay adapter requires at least one candle.");
    }
    if (!Number.isFinite(options.initialBalance) || options.initialBalance <= 0) {
      throw new Error("initialBalance must be a positive number.");
    }

    // Step 2: Store configuration.
    this.candles = options.candles;
    this.symbol = options.symbol;
    this.interval = options.interval;
    this.feeBps = options.feeBps ?? 0;
    this.slippageBps = options.slippageBps ?? 0;
    this.currency = options.currency ?? "USD";
    this.balanceTotal = options.initialBalance;
  }

  /**
   * Establishes a connection to the replay adapter.
   */
  async connect(): Promise<void> {
    this.isConnectedFlag = true;
  }

  /**
   * Disconnects the replay adapter.
   */
  async disconnect(): Promise<void> {
    this.isConnectedFlag = false;
  }

  /**
   * Indicates whether the adapter is connected.
   */
  async isConnected(): Promise<boolean> {
    return this.isConnectedFlag;
  }

  /**
   * Retrieves candles, advancing the replay cursor.
   */
  async getLatestCandles(args?: Readonly<{ limit?: number }>): Promise<readonly ExchangeCandle[]> {
    this.assertConnected();
    const limit = args?.limit;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new Error("limit must be a positive number.");
    }

    if (limit !== undefined) {
      this.currentIndex = Math.max(this.currentIndex, Math.min(limit - 1, this.candles.length - 1));
    } else {
      this.currentIndex = Math.min(this.currentIndex + 1, this.candles.length - 1);
    }

    const startIndex = limit === undefined ? this.currentIndex : Math.max(0, this.currentIndex - limit + 1);
    const slice = this.candles.slice(startIndex, this.currentIndex + 1);
    const last = slice[slice.length - 1];
    if (last !== undefined) {
      this.lastPrice = last.close;
    }
    return slice;
  }

  /**
   * Subscribes to candle updates (no-op for replay adapter).
   */
  async subscribeToCandles(): Promise<() => void> {
    this.assertConnected();
    return () => undefined;
  }

  /**
   * Returns the most recent price.
   */
  async getLastPrice(): Promise<number> {
    this.assertConnected();
    if (this.lastPrice === null) {
      throw new Error("No price available yet.");
    }
    return this.lastPrice;
  }

  /**
   * Retrieves the simulated account balance.
   */
  async getBalance(): Promise<Balance> {
    this.assertConnected();
    return {
      currency: this.currency,
      available: this.balanceTotal,
      locked: 0,
      total: this.balanceTotal
    };
  }

  /**
   * Retrieves the current open position, if any.
   */
  async getPosition(): Promise<Position | null> {
    this.assertConnected();
    if (this.position === null || this.lastPrice === null) {
      return null;
    }
    const now = new Date().toISOString();
    const unrealizedPnl =
      this.position.side === "long"
        ? (this.lastPrice - this.position.entryPrice) * this.position.quantity
        : (this.position.entryPrice - this.lastPrice) * this.position.quantity;
    return {
      symbol: this.symbol,
      side: this.position.side,
      entryPrice: this.position.entryPrice,
      currentPrice: this.lastPrice,
      quantity: this.position.quantity,
      openedAtUtc: this.position.openedAtUtc,
      updatedAtUtc: now,
      unrealizedPnl,
      realizedPnl: this.position.realizedPnl,
      totalFeesPaid: this.position.totalFeesPaid
    };
  }

  /**
   * Places a market order and fills immediately at the latest price.
   */
  async placeMarketOrder(args: Readonly<{ side: OrderSide; quantity: number }>): Promise<Order> {
    this.assertConnected();
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
      throw new Error("Order quantity must be a positive number.");
    }
    const price = await this.getLastPrice();
    const fillPrice = this.applySlippage(price, args.side);
    const fee = this.computeFee(fillPrice * args.quantity);
    const now = new Date().toISOString();

    this.applyFill(args.side, args.quantity, fillPrice, fee, now);

    const order: Order = {
      id: randomUUID(),
      symbol: this.symbol,
      type: "market",
      side: args.side,
      status: "filled",
      quantity: args.quantity,
      filledQuantity: args.quantity,
      averageFillPrice: fillPrice,
      price: null,
      triggerPrice: null,
      createdAtUtc: now,
      updatedAtUtc: now,
      filledAtUtc: now
    };
    this.orders.set(order.id, order);
    return order;
  }

  /**
   * Places a limit order (recorded as open).
   */
  async placeLimitOrder(args: Readonly<{ side: OrderSide; quantity: number; price: number }>): Promise<Order> {
    return this.placeOpenOrder({
      type: "limit",
      side: args.side,
      quantity: args.quantity,
      price: args.price
    });
  }

  /**
   * Places a stop loss order (recorded as open).
   */
  async placeStopLossOrder(args: Readonly<{ side: OrderSide; quantity: number; stopPrice: number }>): Promise<Order> {
    return this.placeOpenOrder({
      type: "stop_loss",
      side: args.side,
      quantity: args.quantity,
      triggerPrice: args.stopPrice
    });
  }

  /**
   * Places a take profit order (recorded as open).
   */
  async placeTakeProfitOrder(args: Readonly<{ side: OrderSide; quantity: number; takeProfitPrice: number }>): Promise<Order> {
    return this.placeOpenOrder({
      type: "take_profit",
      side: args.side,
      quantity: args.quantity,
      triggerPrice: args.takeProfitPrice
    });
  }

  /**
   * Cancels an order by id.
   */
  async cancelOrder(orderId: string): Promise<Order> {
    this.assertConnected();
    const existing = this.orders.get(orderId);
    if (existing === undefined) {
      throw new Error(`Order ${orderId} not found.`);
    }
    const updated: Order = { ...existing, status: "cancelled", updatedAtUtc: new Date().toISOString() };
    this.orders.set(orderId, updated);
    return updated;
  }

  /**
   * Retrieves an order by id.
   */
  async getOrder(orderId: string): Promise<Order | null> {
    this.assertConnected();
    return this.orders.get(orderId) ?? null;
  }

  /**
   * Lists open or pending orders.
   */
  async getOpenOrders(): Promise<readonly Order[]> {
    this.assertConnected();
    return [...this.orders.values()].filter((order) => order.status === "open" || order.status === "pending");
  }

  /**
   * Returns a static rate limit status.
   */
  async getRateLimitStatus(): Promise<RateLimitStatus> {
    return {
      limit: 100000,
      remaining: 100000,
      resetAtUtc: null,
      isThrottled: false
    };
  }

  private assertConnected(): void {
    if (!this.isConnectedFlag) {
      throw new Error("ReplayExchangeAdapter is not connected.");
    }
  }

  private applySlippage(price: number, side: OrderSide): number {
    if (this.slippageBps <= 0) {
      return price;
    }
    const delta = (price * this.slippageBps) / 10000;
    return side === "buy" ? price + delta : price - delta;
  }

  private computeFee(notional: number): number {
    if (this.feeBps <= 0) {
      return 0;
    }
    return (notional * this.feeBps) / 10000;
  }

  private applyFill(side: OrderSide, quantity: number, price: number, fee: number, now: string): void {
    if (this.position === null) {
      const entrySide = side === "buy" ? "long" : "short";
      this.position = {
        side: entrySide,
        entryPrice: price,
        quantity,
        openedAtUtc: now,
        updatedAtUtc: now,
        realizedPnl: 0,
        totalFeesPaid: fee
      };
      this.balanceTotal -= fee;
      return;
    }

    const isClosing =
      (this.position.side === "long" && side === "sell") ||
      (this.position.side === "short" && side === "buy");
    if (!isClosing) {
      throw new Error("Replay adapter does not support scaling into positions.");
    }

    const pnl =
      this.position.side === "long"
        ? (price - this.position.entryPrice) * this.position.quantity
        : (this.position.entryPrice - price) * this.position.quantity;
    this.balanceTotal += pnl - fee;
    this.position = null;
  }

  private async placeOpenOrder(args: Readonly<{
    type: Order["type"];
    side: OrderSide;
    quantity: number;
    price?: number;
    triggerPrice?: number;
  }>): Promise<Order> {
    this.assertConnected();
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
      throw new Error("Order quantity must be a positive number.");
    }
    if (args.price !== undefined && (!Number.isFinite(args.price) || args.price <= 0)) {
      throw new Error("Order price must be a positive number.");
    }
    if (args.triggerPrice !== undefined && (!Number.isFinite(args.triggerPrice) || args.triggerPrice <= 0)) {
      throw new Error("Order trigger price must be a positive number.");
    }
    const now = new Date().toISOString();
    const order: Order = {
      id: randomUUID(),
      symbol: this.symbol,
      type: args.type,
      side: args.side,
      status: "open",
      quantity: args.quantity,
      filledQuantity: 0,
      averageFillPrice: null,
      price: args.price ?? null,
      triggerPrice: args.triggerPrice ?? null,
      createdAtUtc: now,
      updatedAtUtc: now,
      filledAtUtc: null
    };
    this.orders.set(order.id, order);
    return order;
  }
}
