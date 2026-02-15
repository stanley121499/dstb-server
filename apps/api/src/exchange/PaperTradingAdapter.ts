import { randomUUID } from "node:crypto";

import { fetchBinanceCandles } from "../data/binanceDataSource.js";
import type { Candle, YahooInterval } from "../data/yahooFinance.js";
import { intervalToMs } from "../utils/interval.js";
import { ExchangeError } from "./ExchangeError.js";
import type { IExchangeAdapter } from "./IExchangeAdapter.js";
import type {
  Balance,
  ExchangeCandle,
  Order,
  OrderSide,
  OrderStatus,
  Position,
  RateLimitStatus,
  Trade
} from "./types.js";

type MutableOrder = {
  -readonly [K in keyof Order]: Order[K];
};

type InternalPosition = Readonly<{
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  openedAtUtc: string;
  updatedAtUtc: string;
  realizedPnl: number;
  totalFeesPaid: number;
}>;

type MutablePosition = {
  -readonly [K in keyof InternalPosition]: InternalPosition[K];
};

type CandleSubscriber = Readonly<{
  id: string;
  onCandles: (candles: readonly ExchangeCandle[]) => void;
  onError?: (error: ExchangeError) => void;
}>;

/**
 * Paper trading adapter that simulates fills using Binance candles.
 */
export class PaperTradingAdapter implements IExchangeAdapter {
  private readonly symbol: string;
  private readonly interval: YahooInterval;
  private readonly feesBps: number;
  private readonly slippageBps: number;
  private readonly currency: string;
  private readonly pollIntervalMs: number;
  private readonly candleLookbackCount: number;
  private readonly rateLimitPerMinute: number;

  private isConnectedFlag: boolean;
  private pollHandle: NodeJS.Timeout | null;
  private lastCandles: ExchangeCandle[];
  private lastPrice: number | null;
  private balanceTotal: number;
  private balanceLocked: number;
  private openPositions: MutablePosition[];
  private openOrders: Map<string, MutableOrder>;
  private pendingMarketOrderIds: Set<string>;
  private tradeHistory: Trade[];
  private candleSubscribers: Map<string, CandleSubscriber>;
  private rateLimitWindowStartMs: number;
  private rateLimitUsed: number;

  /**
   * Creates a new paper trading adapter.
   */
  public constructor(args: Readonly<{
    symbol: string;
    interval: YahooInterval;
    initialBalance: number;
    feesBps: number;
    slippageBps: number;
    currency?: string;
  }>) {
    // Step 1: Validate constructor args to ensure safe initialization.
    this.assertNonEmptyString(args.symbol, "symbol");
    this.assertPositiveNumber(args.initialBalance, "initialBalance");
    this.assertNonNegativeNumber(args.feesBps, "feesBps");
    this.assertNonNegativeNumber(args.slippageBps, "slippageBps");

    // Step 2: Store configuration parameters.
    this.symbol = args.symbol;
    this.interval = args.interval;
    this.feesBps = args.feesBps;
    this.slippageBps = args.slippageBps;
    this.currency = args.currency ?? "USD";
    this.pollIntervalMs = 15_000;
    this.candleLookbackCount = 500;
    this.rateLimitPerMinute = 120;

    // Step 3: Initialize runtime state.
    this.isConnectedFlag = false;
    this.pollHandle = null;
    this.lastCandles = [];
    this.lastPrice = null;
    this.balanceTotal = args.initialBalance;
    this.balanceLocked = 0;
    this.openPositions = [];
    this.openOrders = new Map<string, MutableOrder>();
    this.pendingMarketOrderIds = new Set<string>();
    this.tradeHistory = [];
    this.candleSubscribers = new Map<string, CandleSubscriber>();
    this.rateLimitWindowStartMs = Date.now();
    this.rateLimitUsed = 0;
  }

  /**
   * Establishes a connection and begins polling for candles.
   */
  public async connect(): Promise<void> {
    // Step 1: Guard against duplicate connections.
    if (this.isConnectedFlag) {
      return;
    }

    // Step 2: Mark as connected before starting polling to avoid races.
    this.isConnectedFlag = true;

    // Step 3: Perform an initial candle fetch to seed state.
    await this.refreshLatestCandles();

    // Step 4: Start polling loop.
    this.pollHandle = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  /**
   * Disconnects and stops polling for candles.
   */
  public async disconnect(): Promise<void> {
    // Step 1: Clear polling timer.
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }

    // Step 2: Mark adapter as disconnected.
    this.isConnectedFlag = false;
  }

  /**
   * Returns connection state.
   */
  public async isConnected(): Promise<boolean> {
    return this.isConnectedFlag;
  }

  /**
   * Fetches the latest candles and caches them locally.
   */
  public async getLatestCandles(args?: Readonly<{ limit?: number }>): Promise<readonly ExchangeCandle[]> {
    // Step 1: Ensure connection is active.
    this.assertConnected();

    // Step 2: Refresh cached candles from Binance.
    const candles = await this.refreshLatestCandles(args?.limit);

    // Step 3: Return cached candles.
    return candles;
  }

  /**
   * Subscribes to candle updates and returns an unsubscribe handler.
   */
  public async subscribeToCandles(args: Readonly<{
    onCandles: (candles: readonly ExchangeCandle[]) => void;
    onError?: (error: ExchangeError) => void;
  }>): Promise<() => void> {
    // Step 1: Validate callback inputs.
    if (typeof args.onCandles !== "function") {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: "onCandles must be a function"
      });
    }

    // Step 2: Register subscriber.
    const id = randomUUID();
    const subscriber: CandleSubscriber =
      args.onError !== undefined
        ? {
            id,
            onCandles: args.onCandles,
            onError: args.onError
          }
        : {
            id,
            onCandles: args.onCandles
          };
    this.candleSubscribers.set(id, subscriber);

    // Step 3: Return unsubscribe handler.
    return () => {
      this.candleSubscribers.delete(id);
    };
  }

  /**
   * Returns the most recent cached price.
   */
  public async getLastPrice(): Promise<number> {
    // Step 1: Ensure connection is active.
    this.assertConnected();

    // Step 2: Ensure we have a cached price or refresh candles.
    if (this.lastPrice === null) {
      await this.refreshLatestCandles();
    }

    // Step 3: Return cached last price.
    if (this.lastPrice === null) {
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "No price data available"
      });
    }

    return this.lastPrice;
  }

  /**
   * Returns current account balance snapshot.
   */
  public async getBalance(): Promise<Balance> {
    // Step 1: Ensure connection is active.
    this.assertConnected();

    // Step 2: Compute available balance from total and locked.
    const available = this.balanceTotal - this.balanceLocked;

    // Step 3: Return balance snapshot.
    return {
      currency: this.currency,
      available,
      locked: this.balanceLocked,
      total: this.balanceTotal
    };
  }

  /**
   * Returns the current open position, if any.
   */
  public async getPosition(): Promise<Position | null> {
    // Step 1: Ensure connection is active.
    this.assertConnected();

    // Step 2: Return null when there are no open positions.
    const position = this.openPositions[0];
    if (position === undefined) {
      return null;
    }

    // Step 3: Use last price for unrealized PnL.
    const currentPrice = this.lastPrice ?? position.entryPrice;
    const unrealizedPnl = this.computeUnrealizedPnl(position, currentPrice);

    // Step 4: Return mapped position snapshot.
    return {
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      currentPrice,
      quantity: position.quantity,
      openedAtUtc: position.openedAtUtc,
      updatedAtUtc: position.updatedAtUtc,
      unrealizedPnl,
      realizedPnl: position.realizedPnl,
      totalFeesPaid: position.totalFeesPaid
    };
  }

  /**
   * Places a market order that fills on the next candle open.
   */
  public async placeMarketOrder(args: Readonly<{ side: OrderSide; quantity: number }>): Promise<Order> {
    // Step 1: Validate inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");

    // Step 2: Build the order record.
    const now = new Date().toISOString();
    const order = this.createOrder({
      side: args.side,
      type: "market",
      quantity: args.quantity,
      price: null,
      triggerPrice: null,
      status: "pending",
      createdAtUtc: now,
      updatedAtUtc: now
    });

    // Step 3: Store the order and mark for next-open fill.
    this.openOrders.set(order.id, order);
    this.pendingMarketOrderIds.add(order.id);

    // Step 4: Return order snapshot.
    return this.toOrderSnapshot(order);
  }

  /**
   * Places a limit order; fills immediately if the price is already crossed.
   */
  public async placeLimitOrder(args: Readonly<{ side: OrderSide; quantity: number; price: number }>): Promise<Order> {
    // Step 1: Validate inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.price, "price");

    // Step 2: Build the order record.
    const now = new Date().toISOString();
    const order = this.createOrder({
      side: args.side,
      type: "limit",
      quantity: args.quantity,
      price: args.price,
      triggerPrice: null,
      status: "open",
      createdAtUtc: now,
      updatedAtUtc: now
    });

    // Step 3: If we have a candle, attempt immediate fill.
    const lastCandle = this.lastCandles[this.lastCandles.length - 1];
    if (lastCandle !== undefined && this.canFillLimitOrder(order, lastCandle)) {
      const fillPrice = this.applySlippage({
        side: order.side,
        rawPrice: args.price,
        slippageBps: this.slippageBps
      });
      this.fillOrder(order, fillPrice, new Date().toISOString());
      return this.toOrderSnapshot(order);
    }

    // Step 4: Store as open order.
    this.openOrders.set(order.id, order);
    return this.toOrderSnapshot(order);
  }

  /**
   * Places a stop loss order; fills when price crosses the stop.
   */
  public async placeStopLossOrder(args: Readonly<{ side: OrderSide; quantity: number; stopPrice: number }>): Promise<Order> {
    // Step 1: Validate inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.stopPrice, "stopPrice");

    // Step 2: Build the order record.
    const now = new Date().toISOString();
    const order = this.createOrder({
      side: args.side,
      type: "stop_loss",
      quantity: args.quantity,
      price: null,
      triggerPrice: args.stopPrice,
      status: "open",
      createdAtUtc: now,
      updatedAtUtc: now
    });

    // Step 3: Store as open order.
    this.openOrders.set(order.id, order);

    // Step 4: Return order snapshot.
    return this.toOrderSnapshot(order);
  }

  /**
   * Places a take profit order; fills when price crosses the target.
   */
  public async placeTakeProfitOrder(args: Readonly<{
    side: OrderSide;
    quantity: number;
    takeProfitPrice: number;
  }>): Promise<Order> {
    // Step 1: Validate inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.takeProfitPrice, "takeProfitPrice");

    // Step 2: Build the order record.
    const now = new Date().toISOString();
    const order = this.createOrder({
      side: args.side,
      type: "take_profit",
      quantity: args.quantity,
      price: null,
      triggerPrice: args.takeProfitPrice,
      status: "open",
      createdAtUtc: now,
      updatedAtUtc: now
    });

    // Step 3: Store as open order.
    this.openOrders.set(order.id, order);

    // Step 4: Return order snapshot.
    return this.toOrderSnapshot(order);
  }

  /**
   * Cancels an open order by id.
   */
  public async cancelOrder(orderId: string): Promise<Order> {
    // Step 1: Ensure connection is active.
    this.assertConnected();
    this.assertNonEmptyString(orderId, "orderId");

    // Step 2: Retrieve the order.
    const order = this.openOrders.get(orderId);
    if (order === undefined) {
      throw new ExchangeError({
        code: "ORDER_NOT_FOUND",
        message: `Order not found: ${orderId}`
      });
    }

    // Step 3: Only open/pending orders can be cancelled.
    if (order.status === "filled" || order.status === "cancelled" || order.status === "rejected") {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `Order cannot be cancelled in status: ${order.status}`
      });
    }

    // Step 4: Update and return order.
    order.status = "cancelled";
    order.updatedAtUtc = new Date().toISOString();
    this.pendingMarketOrderIds.delete(orderId);
    this.openOrders.set(orderId, order);

    return this.toOrderSnapshot(order);
  }

  /**
   * Retrieves an order by id, if present.
   */
  public async getOrder(orderId: string): Promise<Order | null> {
    // Step 1: Ensure connection is active.
    this.assertConnected();
    this.assertNonEmptyString(orderId, "orderId");

    // Step 2: Retrieve order and return snapshot.
    const order = this.openOrders.get(orderId);
    return order === undefined ? null : this.toOrderSnapshot(order);
  }

  /**
   * Lists open/pending orders.
   */
  public async getOpenOrders(): Promise<readonly Order[]> {
    // Step 1: Ensure connection is active.
    this.assertConnected();

    // Step 2: Filter for open/pending orders.
    const orders = Array.from(this.openOrders.values()).filter((order) => {
      return order.status === "open" || order.status === "pending";
    });

    // Step 3: Return snapshots.
    return orders.map((order) => this.toOrderSnapshot(order));
  }

  /**
   * Returns current rate limit status.
   */
  public async getRateLimitStatus(): Promise<RateLimitStatus> {
    // Step 1: Ensure connection is active.
    this.assertConnected();

    // Step 2: Calculate current window status.
    const status = this.getCurrentRateLimitStatus();

    // Step 3: Return rate limit status.
    return status;
  }

  /**
   * Performs a single poll iteration (fetch candles + process orders).
   */
  private async pollOnce(): Promise<void> {
    // Step 1: Skip polling when disconnected.
    if (!this.isConnectedFlag) {
      return;
    }

    try {
      // Step 2: Refresh candles.
      const candles = await this.refreshLatestCandles();

      // Step 3: Notify subscribers with the latest candles.
      this.notifyCandleSubscribers(candles);

      // Step 4: Process pending orders using latest candle.
      const latest = candles[candles.length - 1];
      if (latest !== undefined) {
        this.processPendingOrders(latest);
      }
    } catch (err: unknown) {
      // Step 5: Notify subscribers about polling errors.
      const message = err instanceof Error ? err.message : "Unknown polling error";
      const error = new ExchangeError({
        code: "CONNECTION_ERROR",
        message
      });
      this.notifyCandleSubscriberErrors(error);
    }
  }

  /**
   * Refreshes candles from Binance and updates cached price.
   */
  private async refreshLatestCandles(limit?: number): Promise<readonly ExchangeCandle[]> {
    // Step 1: Enforce rate limiting.
    this.trackRateLimitOrThrow();

    // Step 2: Compute time window for Binance fetch.
    const intervalMs = intervalToMs(this.interval);
    const nowMs = Date.now();
    const lookbackCount = limit ?? this.candleLookbackCount;
    const startMs = nowMs - intervalMs * lookbackCount;
    const startTimeUtc = new Date(startMs).toISOString();
    const endTimeUtc = new Date(nowMs).toISOString();

    // Step 3: Fetch candles from Binance.
    const result = await fetchBinanceCandles({
      symbol: this.symbol,
      interval: this.interval,
      startTimeUtc,
      endTimeUtc
    });

    // Step 4: Cache candles and price.
    const candles = result.candles;
    this.lastCandles = [...candles];
    const lastCandle = candles[candles.length - 1];
    if (lastCandle !== undefined) {
      this.lastPrice = lastCandle.close;
    }

    // Step 5: Return cached candles.
    return this.lastCandles;
  }

  /**
   * Processes all pending orders against the latest candle.
   */
  private processPendingOrders(latest: Candle): void {
    // Step 1: Fill pending market orders on next candle open.
    for (const orderId of this.pendingMarketOrderIds) {
      const order = this.openOrders.get(orderId);
      if (order === undefined) {
        continue;
      }
      if (order.status !== "pending") {
        this.pendingMarketOrderIds.delete(orderId);
        continue;
      }
      const fillPrice = this.applySlippage({
        side: order.side,
        rawPrice: latest.open,
        slippageBps: this.slippageBps
      });
      this.fillOrder(order, fillPrice, new Date().toISOString());
      this.pendingMarketOrderIds.delete(orderId);
    }

    // Step 2: Fill open limit/stop/take-profit orders based on candle ranges.
    for (const order of this.openOrders.values()) {
      if (order.status !== "open") {
        continue;
      }
      if (order.type === "limit" && this.canFillLimitOrder(order, latest)) {
        const price = order.price ?? latest.close;
        const fillPrice = this.applySlippage({
          side: order.side,
          rawPrice: price,
          slippageBps: this.slippageBps
        });
        this.fillOrder(order, fillPrice, new Date().toISOString());
      }
      if (order.type === "stop_loss" && this.canFillStopOrder(order, latest)) {
        const trigger = order.triggerPrice ?? latest.close;
        const fillPrice = this.applySlippage({
          side: order.side,
          rawPrice: trigger,
          slippageBps: this.slippageBps
        });
        this.fillOrder(order, fillPrice, new Date().toISOString());
      }
      if (order.type === "take_profit" && this.canFillTakeProfitOrder(order, latest)) {
        const trigger = order.triggerPrice ?? latest.close;
        const fillPrice = this.applySlippage({
          side: order.side,
          rawPrice: trigger,
          slippageBps: this.slippageBps
        });
        this.fillOrder(order, fillPrice, new Date().toISOString());
      }
    }
  }

  /**
   * Applies a fill to an order and updates balances/positions.
   */
  private fillOrder(order: MutableOrder, fillPrice: number, filledAtUtc: string): void {
    // Step 1: Compute fee for the fill.
    const notional = fillPrice * order.quantity;
    const fee = this.feeForNotional({ notional, feeBps: this.feesBps });

    // Step 2: Verify balance requirements for opening exposure and fees.
    this.assertSufficientEquityForFee(fee);
    const openingQty = this.computeOpeningQuantity(order.side, order.quantity);
    if (openingQty > 0) {
      const openingNotional = openingQty * fillPrice;
      this.assertSufficientBalanceForOpening(openingNotional, fee);
    }

    // Step 3: Apply fill details to the order.
    order.status = "filled";
    order.filledQuantity = order.quantity;
    order.averageFillPrice = fillPrice;
    order.filledAtUtc = filledAtUtc;
    order.updatedAtUtc = filledAtUtc;

    // Step 4: Track trade history entry.
    this.tradeHistory.push({
      id: randomUUID(),
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: fillPrice,
      fee,
      filledAtUtc
    });

    // Step 5: Apply the fill to positions and balances.
    this.applyFillToPositions({
      side: order.side,
      quantity: order.quantity,
      price: fillPrice,
      fee,
      filledAtUtc
    });
  }

  /**
   * Applies an order fill to positions and balance totals.
   */
  private applyFillToPositions(args: Readonly<{
    side: OrderSide;
    quantity: number;
    price: number;
    fee: number;
    filledAtUtc: string;
  }>): void {
    // Step 1: Deduct fee from total balance.
    this.balanceTotal -= args.fee;

    // Step 2: Determine if we are opening or closing positions.
    const existing = this.openPositions[0];
    if (existing === undefined) {
      // Step 3: No existing position -> open a new one.
      const newPosition = this.createPosition(args);
      this.openPositions = [newPosition];
      this.recalculateLockedBalance();
      return;
    }

    // Step 4: Determine if order is same direction as existing position.
    const incomingSide = args.side === "buy" ? "long" : "short";
    if (incomingSide === existing.side) {
      // Step 5: Increase position size with weighted average entry.
      const totalQty = existing.quantity + args.quantity;
      const weightedEntry =
        (existing.entryPrice * existing.quantity + args.price * args.quantity) / totalQty;
      existing.entryPrice = weightedEntry;
      existing.quantity = totalQty;
      existing.updatedAtUtc = args.filledAtUtc;
      existing.totalFeesPaid += args.fee;
      this.recalculateLockedBalance();
      return;
    }

    // Step 6: Closing or flipping the position.
    const closingQty = Math.min(existing.quantity, args.quantity);
    const remainingQty = args.quantity - closingQty;

    // Step 7: Compute realized PnL for the closing portion.
    const pnlBeforeFees = existing.side === "long"
      ? (args.price - existing.entryPrice) * closingQty
      : (existing.entryPrice - args.price) * closingQty;

    existing.realizedPnl += pnlBeforeFees;
    existing.quantity -= closingQty;
    existing.updatedAtUtc = args.filledAtUtc;

    // Step 8: Apply realized PnL to total balance.
    this.balanceTotal += pnlBeforeFees;
    existing.totalFeesPaid += args.fee;

    // Step 9: If the position is fully closed, remove it.
    if (existing.quantity <= 0) {
      this.openPositions = [];
    }

    // Step 10: If there is remaining quantity, open a new position in opposite direction.
    if (remainingQty > 0) {
      const newPosition = this.createPosition({
        side: args.side,
        quantity: remainingQty,
        price: args.price,
        fee: 0,
        filledAtUtc: args.filledAtUtc
      });
      this.openPositions = [newPosition];
    }

    // Step 11: Recalculate locked balance for open positions.
    this.recalculateLockedBalance();
  }

  /**
   * Creates a new position record from a fill.
   */
  private createPosition(args: Readonly<{
    side: OrderSide;
    quantity: number;
    price: number;
    fee: number;
    filledAtUtc: string;
  }>): MutablePosition {
    // Step 1: Derive position side.
    const side = args.side === "buy" ? "long" : "short";

    // Step 2: Build position record.
    return {
      id: randomUUID(),
      symbol: this.symbol,
      side,
      entryPrice: args.price,
      quantity: args.quantity,
      openedAtUtc: args.filledAtUtc,
      updatedAtUtc: args.filledAtUtc,
      realizedPnl: 0,
      totalFeesPaid: args.fee
    };
  }

  /**
   * Recomputes locked balance based on open positions.
   */
  private recalculateLockedBalance(): void {
    // Step 1: Sum notional for open positions.
    const locked = this.openPositions.reduce((sum, position) => {
      return sum + position.entryPrice * position.quantity;
    }, 0);

    // Step 2: Update locked balance.
    this.balanceLocked = locked;
  }

  /**
   * Builds a mutable order record with defaults.
   */
  private createOrder(args: Readonly<{
    side: OrderSide;
    type: Order["type"];
    quantity: number;
    price: number | null;
    triggerPrice: number | null;
    status: OrderStatus;
    createdAtUtc: string;
    updatedAtUtc: string;
  }>): MutableOrder {
    // Step 1: Build order record with defaults.
    return {
      id: randomUUID(),
      symbol: this.symbol,
      type: args.type,
      side: args.side,
      status: args.status,
      quantity: args.quantity,
      filledQuantity: 0,
      averageFillPrice: null,
      price: args.price,
      triggerPrice: args.triggerPrice,
      createdAtUtc: args.createdAtUtc,
      updatedAtUtc: args.updatedAtUtc,
      filledAtUtc: null
    };
  }

  /**
   * Converts a mutable order to an immutable snapshot.
   */
  private toOrderSnapshot(order: MutableOrder): Order {
    // Step 1: Return a shallow copy to avoid external mutation.
    return { ...order };
  }

  /**
   * Checks if a limit order can be filled on the given candle.
   */
  private canFillLimitOrder(order: MutableOrder, candle: Candle): boolean {
    // Step 1: Guard against missing price.
    if (order.price === null) {
      return false;
    }

    // Step 2: Determine fill rule based on side.
    return order.side === "buy" ? candle.low <= order.price : candle.high >= order.price;
  }

  /**
   * Checks if a stop loss order can be filled on the given candle.
   */
  private canFillStopOrder(order: MutableOrder, candle: Candle): boolean {
    // Step 1: Guard against missing trigger.
    if (order.triggerPrice === null) {
      return false;
    }

    // Step 2: Determine stop fill rule based on side.
    return order.side === "buy" ? candle.high >= order.triggerPrice : candle.low <= order.triggerPrice;
  }

  /**
   * Checks if a take profit order can be filled on the given candle.
   */
  private canFillTakeProfitOrder(order: MutableOrder, candle: Candle): boolean {
    // Step 1: Guard against missing trigger.
    if (order.triggerPrice === null) {
      return false;
    }

    // Step 2: Determine take profit fill rule based on side.
    return order.side === "buy" ? candle.high >= order.triggerPrice : candle.low <= order.triggerPrice;
  }

  /**
   * Notifies candle subscribers of new data.
   */
  private notifyCandleSubscribers(candles: readonly ExchangeCandle[]): void {
    // Step 1: Notify each subscriber safely.
    for (const subscriber of this.candleSubscribers.values()) {
      try {
        subscriber.onCandles(candles);
      } catch {
        // Intentionally swallow subscriber errors to keep polling alive.
      }
    }
  }

  /**
   * Notifies candle subscribers of errors.
   */
  private notifyCandleSubscriberErrors(error: ExchangeError): void {
    // Step 1: Notify each subscriber safely.
    for (const subscriber of this.candleSubscribers.values()) {
      if (subscriber.onError === undefined) {
        continue;
      }
      try {
        subscriber.onError(error);
      } catch {
        // Intentionally swallow subscriber errors to keep polling alive.
      }
    }
  }

  /**
   * Applies slippage to a raw price.
   */
  private applySlippage(args: Readonly<{ side: OrderSide; rawPrice: number; slippageBps: number }>): number {
    // Step 1: Convert bps to decimal.
    const slip = args.slippageBps / 10_000;

    // Step 2: Apply directional slippage.
    return args.side === "buy" ? args.rawPrice * (1 + slip) : args.rawPrice * (1 - slip);
  }

  /**
   * Computes fee for a notional value.
   */
  private feeForNotional(args: Readonly<{ notional: number; feeBps: number }>): number {
    // Step 1: Convert bps to decimal and apply to notional.
    return args.notional * (args.feeBps / 10_000);
  }

  /**
   * Computes unrealized PnL for a position using a current price.
   */
  private computeUnrealizedPnl(position: InternalPosition, currentPrice: number): number {
    // Step 1: Determine direction-based PnL.
    return position.side === "long"
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity;
  }

  /**
   * Ensures the adapter is connected.
   */
  private assertConnected(): void {
    // Step 1: Throw if not connected.
    if (!this.isConnectedFlag) {
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "Adapter is not connected"
      });
    }
  }

  /**
   * Ensures sufficient balance for opening trades.
   */
  private assertSufficientBalance(notional: number, fee: number): void {
    // Step 1: Compute available balance.
    const available = this.balanceTotal - this.balanceLocked;

    // Step 2: Validate available funds for the notional plus fee.
    if (available < notional + fee) {
      throw new ExchangeError({
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient available balance for order",
        details: {
          available,
          required: notional + fee
        }
      });
    }
  }

  /**
   * Ensures sufficient balance for opening exposure.
   */
  private assertSufficientBalanceForOpening(notional: number, fee: number): void {
    // Step 1: Reuse balance validation with notional and fee.
    this.assertSufficientBalance(notional, fee);
  }

  /**
   * Ensures enough total equity to pay fees.
   */
  private assertSufficientEquityForFee(fee: number): void {
    // Step 1: Validate that total balance can cover fees.
    if (this.balanceTotal < fee) {
      throw new ExchangeError({
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient total balance to cover fees",
        details: {
          total: this.balanceTotal,
          fee
        }
      });
    }
  }

  /**
   * Computes the portion of an order that increases exposure.
   */
  private computeOpeningQuantity(side: OrderSide, quantity: number): number {
    // Step 1: If there is no position, full quantity is opening.
    const existing = this.openPositions[0];
    if (existing === undefined) {
      return quantity;
    }

    // Step 2: Determine if order is same direction as existing position.
    const incomingSide = side === "buy" ? "long" : "short";
    if (incomingSide === existing.side) {
      return quantity;
    }

    // Step 3: Opposite side reduces position first; remaining opens new exposure.
    return Math.max(0, quantity - existing.quantity);
  }

  /**
   * Validates a non-empty string.
   */
  private assertNonEmptyString(value: string, fieldName: string): void {
    // Step 1: Validate input type.
    if (typeof value !== "string") {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be a string`
      });
    }

    // Step 2: Validate input value.
    if (value.trim().length === 0) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be non-empty`
      });
    }
  }

  /**
   * Validates a positive number.
   */
  private assertPositiveNumber(value: number, fieldName: string): void {
    // Step 1: Validate numeric type.
    if (!Number.isFinite(value)) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be a finite number`
      });
    }

    // Step 2: Validate numeric value.
    if (value <= 0) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be > 0`
      });
    }
  }

  /**
   * Validates a non-negative number.
   */
  private assertNonNegativeNumber(value: number, fieldName: string): void {
    // Step 1: Validate numeric type.
    if (!Number.isFinite(value)) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be a finite number`
      });
    }

    // Step 2: Validate numeric value.
    if (value < 0) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be >= 0`
      });
    }
  }

  /**
   * Tracks rate limit usage and throws if throttled.
   */
  private trackRateLimitOrThrow(): void {
    // Step 1: Reset the window if needed.
    const now = Date.now();
    const elapsed = now - this.rateLimitWindowStartMs;
    if (elapsed >= 60_000) {
      this.rateLimitWindowStartMs = now;
      this.rateLimitUsed = 0;
    }

    // Step 2: Increment usage.
    this.rateLimitUsed += 1;

    // Step 3: Throw if limit exceeded.
    if (this.rateLimitUsed > this.rateLimitPerMinute) {
      throw new ExchangeError({
        code: "RATE_LIMIT",
        message: "Rate limit exceeded",
        details: this.getCurrentRateLimitStatus()
      });
    }
  }

  /**
   * Returns the current rate limit status payload.
   */
  private getCurrentRateLimitStatus(): RateLimitStatus {
    // Step 1: Compute remaining limit.
    const remaining = Math.max(0, this.rateLimitPerMinute - this.rateLimitUsed);

    // Step 2: Compute reset time for current window.
    const resetAtUtc = new Date(this.rateLimitWindowStartMs + 60_000).toISOString();

    // Step 3: Return status.
    return {
      limit: this.rateLimitPerMinute,
      remaining,
      resetAtUtc,
      isThrottled: remaining === 0
    };
  }
}
