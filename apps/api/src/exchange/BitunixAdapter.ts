import { randomUUID } from "node:crypto";

import type { YahooInterval } from "../data/yahooFinance.js";

import { BitunixWebSocket } from "./BitunixWebSocket.js";
import { createAuthPayload } from "./bitunixAuth.js";
import { fromBitunixSymbol, toBitunixSymbol } from "./bitunixSymbolMapper.js";
import { ExchangeError } from "./ExchangeError.js";
import type { IExchangeAdapter } from "./IExchangeAdapter.js";
import type {
  Balance,
  CircuitBreakerSnapshot,
  CircuitBreakerState,
  ExchangeCandle,
  ExchangeErrorCode,
  Order,
  OrderSide,
  OrderStatus,
  Position,
  RateLimitStatus
} from "./types.js";

type MarketType = "spot" | "futures";
type PositionSide = Position["side"];
type SignableValue = string | number | boolean | null | undefined;
type SignableParams = Readonly<Record<string, SignableValue>>;

type CandleSubscriber = Readonly<{
  id: string;
  onCandles: (candles: readonly ExchangeCandle[]) => void;
  onError?: (error: ExchangeError) => void;
}>;

type RequestMethod = "GET" | "POST" | "DELETE";

type JsonRecord = Readonly<Record<string, unknown>>;

type RequestArgs = Readonly<{
  method: RequestMethod;
  path: string;
  query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  body?: Readonly<Record<string, unknown>>;
  isPrivate?: boolean;
  restBaseOverride?: string;
}>;

type ParsedBalance = Readonly<{
  currency: string;
  available: number;
  locked: number;
  total: number;
}>;

/**
 * Real Bitunix exchange adapter using REST + WebSocket APIs.
 */
export class BitunixAdapter implements IExchangeAdapter {
  private readonly symbol: string;
  private readonly interval: YahooInterval;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly testMode: boolean;
  private readonly marketType: MarketType;
  private readonly restBaseUrl: string;
  private readonly futuresRestBaseUrl: string;
  private readonly wsUrl: string;
  private readonly publicLimiter: TokenBucket;
  private readonly privateLimiter: TokenBucket;
  private readonly useWebSocket: boolean;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly wsCandleMaxCache: number;

  private isConnectedFlag: boolean;
  private lastCandles: ExchangeCandle[];
  private lastCandleFetchMs: number | null;
  private lastPrice: number | null;
  private lastWsCandle: ExchangeCandle | null;
  private lastWsCandleAtMs: number | null;
  private lastWsPriceAtMs: number | null;
  private readonly candleSubscribers: Map<string, CandleSubscriber>;
  private lastRateLimitStatus: RateLimitStatus;
  private wsManager: BitunixWebSocket | null;
  private klineUnsubscribe: (() => void) | null;

  /**
   * Creates a new Bitunix adapter for a symbol/interval.
   */
  public constructor(args: Readonly<{
    symbol: string;
    interval: YahooInterval;
    apiKey: string;
    secretKey: string;
    testMode: boolean;
    marketType?: MarketType;
  }>) {
    // Step 1: Validate required inputs.
    this.assertNonEmptyString(args.symbol, "symbol");
    this.assertNonEmptyString(args.apiKey, "apiKey");
    this.assertNonEmptyString(args.secretKey, "secretKey");

    // Step 2: Persist configuration.
    this.symbol = args.symbol;
    this.interval = args.interval;
    this.apiKey = args.apiKey;
    this.secretKey = args.secretKey;
    this.testMode = args.testMode;
    this.marketType = args.marketType ?? "spot";

    // Step 3: Resolve API endpoints.
    this.restBaseUrl = this.resolveRestBaseUrl();
    this.futuresRestBaseUrl = this.resolveFuturesRestBaseUrl();
    this.wsUrl = this.resolveWebSocketUrl();

    // Step 4: Initialize rate limiters.
    this.publicLimiter = new TokenBucket({ capacity: 20, refillPerSecond: 20 });
    this.privateLimiter = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    this.useWebSocket = true;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 60_000
    });
    this.wsCandleMaxCache = 500;

    // Step 5: Initialize runtime state.
    this.isConnectedFlag = false;
    this.lastCandles = [];
    this.lastCandleFetchMs = null;
    this.lastPrice = null;
    this.lastWsCandle = null;
    this.lastWsCandleAtMs = null;
    this.lastWsPriceAtMs = null;
    this.candleSubscribers = new Map<string, CandleSubscriber>();
    this.lastRateLimitStatus = {
      limit: 20,
      remaining: 20,
      resetAtUtc: null,
      isThrottled: false
    };
    this.wsManager = null;
    this.klineUnsubscribe = null;
  }

  /**
   * Establishes REST connectivity and the WebSocket stream.
   */
  public async connect(): Promise<void> {
    // Step 1: Avoid double connection.
    if (this.isConnectedFlag) {
      return;
    }

    // Step 2: Verify REST connectivity and connect WebSocket.
    await this.getServerTime();
    await this.connectWebSocket();

    // Step 3: Mark adapter as connected.
    this.isConnectedFlag = true;
  }

  /**
   * Disconnects from Bitunix and closes the WebSocket connection.
   */
  public async disconnect(): Promise<void> {
    // Step 1: Unsubscribe from kline stream.
    if (this.klineUnsubscribe !== null) {
      this.klineUnsubscribe();
      this.klineUnsubscribe = null;
    }
    // Step 2: Disconnect WebSocket manager.
    if (this.wsManager !== null) {
      await this.wsManager.disconnect();
      this.wsManager = null;
    }

    // Step 3: Update connection state.
    this.isConnectedFlag = false;
  }

  /**
   * Returns connection state.
   */
  public async isConnected(): Promise<boolean> {
    // Step 1: Return connection flag.
    return this.isConnectedFlag;
  }

  /**
   * Fetches the latest candles and caches for 10 seconds.
   */
  public async getLatestCandles(args?: Readonly<{ limit?: number }>): Promise<readonly ExchangeCandle[]> {
    // Step 1: Validate connection state.
    this.assertConnected();

    // Step 2: Prefer WebSocket data when healthy.
    const limit = args?.limit;
    if (this.useWebSocket && this.isWebSocketHealthy()) {
      const wsCandles = this.getWebSocketCandles(limit);
      if (wsCandles !== null) {
        return wsCandles;
      }
    }

    // Step 3: Return cached candles when still fresh.
    const now = Date.now();
    if (this.lastCandleFetchMs !== null && now - this.lastCandleFetchMs < 10_000) {
      if (limit === undefined || this.lastCandles.length >= limit) {
        return limit === undefined ? this.lastCandles : this.lastCandles.slice(-limit);
      }
    }

    // Step 4: Fetch latest candles from Bitunix.
    if (this.useWebSocket && !this.isWebSocketHealthy()) {
      console.warn("[BitunixAdapter] Using REST fallback for candles (WebSocket unhealthy)");
    }
    const symbol = toBitunixSymbol(this.symbol);
    console.log(`[BitunixAdapter] Fetching candles: symbol=${symbol}, interval=${this.interval}, limit=${limit ?? "default"}`);
    
    try {
      const response = await this.request({
        method: "GET",
        path: "/api/v1/futures/market/kline",
        query: {
          symbol,
          interval: this.interval,
          limit
        }
      });
      console.log(`[BitunixAdapter] Received candles response, parsing...`);

      // Step 5: Parse and cache candle data.
      const candles = this.parseCandles(response);
      console.log(`[BitunixAdapter] Parsed ${candles.length} candles`);
      this.lastCandles = candles;
      this.lastCandleFetchMs = now;

      // Step 6: Update cached last price.
      const latest = candles.at(-1);
      if (latest !== undefined) {
        this.lastPrice = latest.close;
      }

      // Step 7: Return requested candle slice.
      return limit === undefined ? candles : candles.slice(-limit);
    } catch (err: unknown) {
      console.error(`[BitunixAdapter] Error fetching candles:`, err);
      throw err;
    }
  }

  /**
   * Subscribes to Bitunix kline updates.
   */
  public async subscribeToCandles(args: Readonly<{
    onCandles: (candles: readonly ExchangeCandle[]) => void;
    onError?: (error: ExchangeError) => void;
  }>): Promise<() => void> {
    // Step 1: Validate callbacks.
    if (typeof args.onCandles !== "function") {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: "onCandles must be a function"
      });
    }

    // Step 2: Ensure adapter and WebSocket are connected.
    this.assertConnected();
    await this.ensureWebSocket();

    // Step 3: Register subscriber.
    const id = randomUUID();
    const subscriber: CandleSubscriber = args.onError === undefined
      ? { id, onCandles: args.onCandles }
      : { id, onCandles: args.onCandles, onError: args.onError };
    this.candleSubscribers.set(id, subscriber);

    // Step 4: Subscribe to kline stream (idempotent).
    await this.subscribeToKlines();

    // Step 5: Return unsubscribe handler.
    return () => {
      this.candleSubscribers.delete(id);
    };
  }

  /**
   * Retrieves the latest price for the configured symbol.
   */
  public async getLastPrice(): Promise<number> {
    // Step 1: Validate connection state.
    this.assertConnected();

    // Step 2: Prefer WebSocket price when healthy.
    if (this.useWebSocket && this.isWebSocketHealthy() && this.lastPrice !== null) {
      const lastWsAge = this.lastWsPriceAtMs === null ? null : Date.now() - this.lastWsPriceAtMs;
      if (lastWsAge === null || lastWsAge <= 10_000) {
        return this.lastPrice;
      }
    }

    // Step 3: Fetch latest price from Bitunix tickers endpoint.
    if (this.useWebSocket && !this.isWebSocketHealthy()) {
      console.warn("[BitunixAdapter] Using REST fallback for last price (WebSocket unhealthy)");
    }
    const symbol = toBitunixSymbol(this.symbol);
    const response = await this.request({
      method: "GET",
      path: "/api/v1/futures/market/tickers",
      query: { symbols: symbol }
    });

    // Step 4: Parse ticker data array and extract price.
    const tickers = this.extractArray(response);
    if (tickers.length === 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `No ticker data for symbol ${symbol}`
      });
    }
    const ticker = tickers[0];
    if (!isRecord(ticker)) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Invalid ticker data format"
      });
    }
    const price = this.extractNumber(ticker, ["lastPrice", "last", "close"]);
    this.lastPrice = price;
    return price;
  }

  /**
   * Retrieves the current account balance snapshot.
   */
  public async getBalance(): Promise<Balance> {
    // Step 1: Validate connection state.
    this.assertConnected();

    // Step 2: Fetch account data with required marginCoin parameter.
    const quoteCurrency = this.resolveQuoteCurrency();
    const response = await this.request({
      method: "GET",
      path: "/api/v1/futures/account",
      query: {
        marginCoin: quoteCurrency
      },
      isPrivate: true
    });

    // Step 3: Parse quote balance and return snapshot.
    const parsed = this.parseBalance(response, quoteCurrency);

    return {
      currency: parsed.currency,
      available: parsed.available,
      locked: parsed.locked,
      total: parsed.total
    };
  }

  /**
   * Returns the current open position (futures) or null (spot).
   */
  public async getPosition(): Promise<Position | null> {
    // Step 1: Validate connection state.
    this.assertConnected();

    // Step 2: Spot accounts do not expose positions.
    if (this.marketType === "spot") {
      return null;
    }

    // Step 3: Fetch futures position data.
    const symbol = toBitunixSymbol(this.symbol);
    try {
      const response = await this.request({
        method: "GET",
        path: "/api/v1/futures/position/get_pending_positions",
        query: {
          symbol
        },
        isPrivate: true
      });
      
      // Step 4: Parse the first open position if present.
      const positions = this.extractArray(response);
      const first = positions[0];
      if (first === undefined) {
        return null;
      }
      if (!isRecord(first)) {
        throw new ExchangeError({
          code: "INTERNAL_ERROR",
          message: "Invalid position payload"
        });
      }
      
      return this.parsePositionRow(first);
    } catch (err: unknown) {
      // If position endpoint fails, assume no position
      console.warn(`[BitunixAdapter] Position fetch failed, assuming no open position:`, err);
      return null;
    }
  }
  
  /**
   * Gets the account position mode (hedge mode vs one-way mode).
   * In hedge mode, you can have both long and short positions simultaneously.
   * In one-way mode, you can only have one directional position at a time.
   */
  public async getPositionMode(): Promise<"ONE_WAY" | "HEDGE" | "UNKNOWN"> {
    // Step 1: Validate connection and market type.
    this.assertConnected();
    
    if (this.marketType !== "futures") {
      return "UNKNOWN";
    }
    
    // Step 2: Fetch position mode from Bitunix API.
    try {
      const response = await this.request({
        method: "GET",
        path: "/api/v1/futures/account/get_leverage_and_margin_mode",
        query: {
          symbol: toBitunixSymbol(this.symbol)
        },
        isPrivate: true
      });
      
      // Step 3: Parse position mode from response.
      if (!isRecord(response)) {
        return "UNKNOWN";
      }
      
      const data = response.data ?? response;
      if (!isRecord(data)) {
        return "UNKNOWN";
      }
      
      const positionMode = this.extractOptionalString(data, ["positionMode", "position_mode"]);
      console.log(`[BitunixAdapter] Position mode: ${positionMode}`);
      
      if (positionMode === "ONE_WAY") {
        return "ONE_WAY";
      } else if (positionMode === "HEDGE") {
        return "HEDGE";
      }
      
      return "UNKNOWN";
    } catch (err: unknown) {
      console.warn(`[BitunixAdapter] Failed to fetch position mode:`, err);
      return "UNKNOWN";
    }
  }
  
  private parsePositionRow(row: unknown): Position {
    if (!isRecord(row)) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Invalid position row"
      });
    }

    // Step 1: Extract symbol.
    const symbol = this.extractString(row, ["symbol"]);
    
    // Step 2: Normalize position fields into the platform model.
    const sideRaw = this.extractString(row, ["side"]);
    const side = sideRaw.toUpperCase() === "SHORT" ? "short" : "long";
    const entryPrice = this.extractNumber(row, ["avgOpenPrice", "entryPrice", "avg_price"]);
    const quantity = this.extractNumber(row, ["qty", "positionQty", "size"]);
    const openedAtUtc = this.extractTimestampIso(row, ["ctime", "createdAt", "openTime"]);
    const updatedAtUtc = this.extractTimestampIso(row, ["mtime", "updatedAt", "updateTime"], openedAtUtc);
    const unrealized = this.extractOptionalNumber(row, ["unrealizedPNL", "unrealizedPnl"]);
    const realized = this.extractOptionalNumber(row, ["realizedPNL", "realizedPnl"]) ?? 0;
    const feePaid = this.extractOptionalNumber(row, ["fee", "feesPaid"]) ?? 0;

    const currentPrice = this.lastPrice ?? entryPrice;
    const unrealizedPnl = unrealized ?? this.computeUnrealizedPnl(side, entryPrice, currentPrice, quantity);

    // Step 3: Return mapped position.
    return {
      symbol: fromBitunixSymbol(symbol),
      side,
      entryPrice,
      currentPrice,
      quantity,
      openedAtUtc,
      updatedAtUtc,
      unrealizedPnl,
      realizedPnl: realized,
      totalFeesPaid: feePaid
    };
  }

  /**
   * Places a market order.
   */
  public async placeMarketOrder(args: Readonly<{ side: OrderSide; quantity: number }>): Promise<Order> {
    // Step 1: Validate connection and inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");

    // Step 2: Place the market order via REST.
    return this.placeOrder({
      side: args.side,
      type: "MARKET",
      quantity: args.quantity
    });
  }
  
  /**
   * Closes an existing futures position using flash close or regular market order.
   * This method automatically fetches the correct position size and side from the exchange.
   */
  public async closePosition(symbol?: string): Promise<Order> {
    // Step 1: Validate connection.
    this.assertConnected();
    
    // Step 2: For futures only - fetch current position.
    if (this.marketType !== "futures") {
      throw new ExchangeError({
        code: "UNSUPPORTED_OPERATION",
        message: "closePosition is only supported for futures market type"
      });
    }
    
    // Step 3: Get the actual open position from exchange.
    const position = await this.getPosition();
    if (position === null) {
      throw new ExchangeError({
        code: "NO_POSITION",
        message: "No open position to close"
      });
    }
    
    console.log(`[BitunixAdapter] Closing position: ${position.side} ${position.quantity} @ ${position.entryPrice}`);
    
    // Step 4: Try flash close first (instant market close).
    try {
      const positionId = position.id;
      const response = await this.request({
        method: "POST",
        path: "/api/v1/futures/trade/flash_close_position",
        body: {
          positionId
        },
        isPrivate: true
      });
      
      console.log(`[BitunixAdapter] Flash close successful:`, response);
      
      // Step 5: Return a mock order since flash close doesn't return order details.
      return {
        orderId: `flash-close-${Date.now()}`,
        clientOrderId: null,
        symbol: this.symbol,
        side: position.side === "long" ? "sell" : "buy",
        type: "MARKET",
        quantity: position.quantity,
        price: null,
        triggerPrice: null,
        status: "filled",
        filledQuantity: position.quantity,
        averagePrice: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now()
      };
    } catch (flashErr: unknown) {
      console.warn(`[BitunixAdapter] Flash close failed, trying regular close:`, flashErr);
      
      // Step 6: Fall back to regular market close order.
      const closeSide: OrderSide = position.side === "long" ? "sell" : "buy";
      const clientId = this.createClientOrderId();
      
      const body: Record<string, unknown> = {
        symbol: toBitunixSymbol(this.symbol),
        side: closeSide.toUpperCase(),
        tradeSide: "CLOSE",
        positionId: position.id,
        orderType: "MARKET",
        qty: String(position.quantity),
        clientId
      };
      
      console.log("[BitunixAdapter] Placing close order:", JSON.stringify(body, null, 2));
      
      const response = await this.request({
        method: "POST",
        path: "/api/v1/futures/trade/place_order",
        body,
        isPrivate: true
      });
      
      const identifiers = this.extractOrderIdentifiers(response, clientId);
      
      const pendingFallback = this.buildPendingOrderSnapshot({
        orderId: identifiers.orderId,
        clientId: identifiers.clientId,
        side: closeSide,
        type: "MARKET",
        quantity: position.quantity,
        price: null,
        triggerPrice: null
      });
      
      return this.confirmOrder({
        orderId: identifiers.orderId,
        clientId: identifiers.clientId,
        fallbackOrder: pendingFallback
      });
    }
  }

  /**
   * Places a limit order.
   */
  public async placeLimitOrder(args: Readonly<{ side: OrderSide; quantity: number; price: number }>): Promise<Order> {
    // Step 1: Validate connection and inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.price, "price");

    // Step 2: Place the limit order via REST.
    return this.placeOrder({
      side: args.side,
      type: "LIMIT",
      quantity: args.quantity,
      price: args.price
    });
  }

  /**
   * Places a stop loss order.
   */
  public async placeStopLossOrder(args: Readonly<{ side: OrderSide; quantity: number; stopPrice: number }>): Promise<Order> {
    // Step 1: Validate connection and inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.stopPrice, "stopPrice");

    // Step 2: Place the stop loss order via REST.
    return this.placeOrder({
      side: args.side,
      type: "STOP_LOSS",
      quantity: args.quantity,
      stopPrice: args.stopPrice
    });
  }

  /**
   * Places a take profit order.
   */
  public async placeTakeProfitOrder(args: Readonly<{ side: OrderSide; quantity: number; takeProfitPrice: number }>): Promise<Order> {
    // Step 1: Validate connection and inputs.
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.takeProfitPrice, "takeProfitPrice");

    // Step 2: Place the take profit order via REST.
    return this.placeOrder({
      side: args.side,
      type: "TAKE_PROFIT",
      quantity: args.quantity,
      price: args.takeProfitPrice
    });
  }

  /**
   * Cancels an order by exchange order id.
   */
  public async cancelOrder(orderId: string): Promise<Order> {
    // Step 1: Validate connection and inputs.
    this.assertConnected();
    this.assertNonEmptyString(orderId, "orderId");

    // Step 2: Send cancel request to Bitunix.
    const response = await this.request({
      method: "POST",
      path: "/api/v1/futures/trade/cancel_orders",
      body: {
        symbol: toBitunixSymbol(this.symbol),
        orderId
      },
      isPrivate: true
    });

    // Step 3: Parse and return updated order.
    return this.parseOrder(response);
  }

  /**
   * Retrieves an order by exchange order id.
   */
  public async getOrder(orderId: string): Promise<Order | null> {
    // Step 1: Validate connection and inputs.
    this.assertConnected();
    this.assertNonEmptyString(orderId, "orderId");

    // Step 2: Request order details and handle not-found responses.
    try {
      return await this.fetchOrderDetail({ orderId });
    } catch (err: unknown) {
      if (err instanceof ExchangeError && err.code === "ORDER_NOT_FOUND") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Lists open/pending orders for the configured symbol.
   */
  public async getOpenOrders(): Promise<readonly Order[]> {
    // Step 1: Validate connection state.
    this.assertConnected();

    // Step 2: Fetch open orders from Bitunix.
    console.log(`[BitunixAdapter] Fetching open orders for symbol=${toBitunixSymbol(this.symbol)}`);
    try {
      const response = await this.request({
        method: "GET",
        path: "/api/v1/futures/trade/get_pending_orders",
        query: {
          symbol: toBitunixSymbol(this.symbol)
        },
        isPrivate: true
      });

      // Step 3: Parse and return order list.
      const list = this.extractArray(response);
      console.log(`[BitunixAdapter] Fetched ${list.length} open orders`);
      return list.map((item) => this.parseOrder(item));
    } catch (err: unknown) {
      console.error(`[BitunixAdapter] Error fetching open orders:`, err);
      // Return empty array if fetching fails
      return [];
    }
  }

  /**
   * Returns the adapter's current rate limit status.
   */
  public async getRateLimitStatus(): Promise<RateLimitStatus> {
    // Step 1: Validate connection state.
    this.assertConnected();
    // Step 2: Return last known rate limit status.
    return this.lastRateLimitStatus;
  }

  /**
   * Initializes the WebSocket manager and binds kline handlers.
   */
  private async connectWebSocket(): Promise<void> {
    // Step 1: Skip if already connected.
    if (this.wsManager !== null) {
      return;
    }

    // Step 2: Initialize WebSocket manager.
    this.wsManager = new BitunixWebSocket({
      url: this.wsUrl,
      apiKey: this.apiKey,
      secretKey: this.secretKey
    });

    // Step 3: Wire kline events to subscribers.
    this.klineUnsubscribe = this.wsManager.onKline((event) => {
      try {
        const candle = this.parseKlineEvent(event);
        this.recordWebSocketCandle(candle);
        this.notifyCandleSubscribers([candle]);
      } catch (err: unknown) {
        const error = err instanceof ExchangeError
          ? err
          : new ExchangeError({
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : "Unknown kline parse error"
          });
        this.notifyCandleSubscriberErrors(error);
      }
    });

    // Step 4: Surface WebSocket errors to subscribers.
    this.wsManager.on("error", (err) => {
      const error = err instanceof ExchangeError
        ? err
        : new ExchangeError({
          code: "CONNECTION_ERROR",
          message: err instanceof Error ? err.message : "WebSocket error"
        });
      this.notifyCandleSubscriberErrors(error);
    });

    // Step 5: Establish WebSocket connection.
    await this.wsManager.connect();
  }

  /**
   * Ensures a WebSocket manager exists and is connected.
   */
  private async ensureWebSocket(): Promise<void> {
    // Step 1: Connect WebSocket if needed.
    if (this.wsManager === null) {
      await this.connectWebSocket();
    }
  }

  /**
   * Subscribes to Bitunix kline streams for the configured symbol.
   */
  private async subscribeToKlines(): Promise<void> {
    // Step 1: Skip if no WebSocket manager.
    if (this.wsManager === null) {
      return;
    }
    // Step 2: Build subscription payload for kline streams.
    const symbol = toBitunixSymbol(this.symbol);
    const channel = this.toWebSocketChannel(this.interval);
    const legacyChannel = `kline_${symbol}${this.interval}`;
    const key = `${symbol}-${channel}`;
    const payload = {
      op: "subscribe",
      args: [
        {
          symbol,
          ch: channel
        },
        {
          symbol,
          ch: legacyChannel
        }
      ]
    };

    // Step 3: Subscribe using WS manager.
    await this.wsManager.subscribe(key, payload);
  }

  /**
   * Calls the Bitunix time endpoint to validate connectivity.
   */
  private async getServerTime(): Promise<void> {
    // Step 1: Skip connectivity test for now since we don't have the correct Bitunix endpoint.
    // The bot will test connectivity when it actually tries to fetch data or place orders.
    // TODO: Find the correct public endpoint from Bitunix documentation and add it here.
    return Promise.resolve();
  }

  /**
   * Places an order through the Bitunix REST API.
   */
  private async placeOrder(args: Readonly<{
    side: OrderSide;
    type: "MARKET" | "LIMIT" | "STOP_LOSS" | "TAKE_PROFIT";
    quantity: number;
    price?: number;
    stopPrice?: number;
  }>): Promise<Order> {
    // Step 1: Create a unique client order id for tracking.
    const clientId = this.createClientOrderId();

    // Step 2: Submit the order to Bitunix.
    const response = await this.submitOrder({
      side: args.side,
      type: args.type,
      quantity: args.quantity,
      price: args.price,
      stopPrice: args.stopPrice,
      clientId
    });

    // Step 3: Extract order identifiers.
    const identifiers = this.extractOrderIdentifiers(response, clientId);

    // Step 4: Poll until confirmed or timeout, then return best-known state.
    const pendingFallback = this.buildPendingOrderSnapshot({
      orderId: identifiers.orderId,
      clientId: identifiers.clientId,
      side: args.side,
      type: args.type,
      quantity: args.quantity,
      price: args.price ?? null,
      triggerPrice: args.stopPrice ?? null
    });
    return this.confirmOrder({
      orderId: identifiers.orderId,
      clientId: identifiers.clientId,
      fallbackOrder: pendingFallback
    });
  }

  /**
   * Submits an order to the Bitunix REST API and returns the raw response.
   */
  private async submitOrder(args: Readonly<{
    side: OrderSide;
    type: "MARKET" | "LIMIT" | "STOP_LOSS" | "TAKE_PROFIT";
    quantity: number;
    price?: number;
    stopPrice?: number;
    clientId: string;
  }>): Promise<unknown> {
    // Step 1: Build order payload with correct Bitunix parameter names.
    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(this.symbol),
      side: args.side.toUpperCase(),
      tradeSide: "OPEN",
      orderType: args.type,
      qty: String(args.quantity),
      clientId: args.clientId
    };
    // Step 2: Append optional price fields based on order type.
    if (args.type === "LIMIT") {
      if (args.price !== undefined) {
        body.price = String(args.price);
      }
    } else if (args.type === "STOP_LOSS") {
      if (args.stopPrice !== undefined) {
        body.triggerPrice = String(args.stopPrice);
        body.orderType = "MARKET";
      }
    } else if (args.type === "TAKE_PROFIT") {
      if (args.price !== undefined) {
        body.triggerPrice = String(args.price);
        body.orderType = "LIMIT";
        body.price = String(args.price);
      }
    }

    // Step 3: Send order request to Bitunix.
    console.log("[BitunixAdapter] Placing order with body:", JSON.stringify(body, null, 2));

    try {
      const response = await this.request({
        method: "POST",
        path: "/api/v1/futures/trade/place_order",
        body,
        isPrivate: true
      });
      console.log("[BitunixAdapter] Order response:", JSON.stringify(response, null, 2));
      return response;
    } catch (err: unknown) {
      console.error("[BitunixAdapter] Order placement failed:", err);
      throw err;
    }
  }

  /**
   * Creates a unique client order id for Bitunix requests.
   */
  private createClientOrderId(): string {
    // Step 1: Build a unique client id using timestamp + uuid.
    return `bot-${Date.now()}-${randomUUID()}`;
  }

  /**
   * Extracts order identifiers from a Bitunix response payload.
   */
  private extractOrderIdentifiers(payload: unknown, fallbackClientId: string): Readonly<{
    orderId: string | null;
    clientId: string;
  }> {
    // Step 1: Extract identifiers from top-level payload.
    const rawOrderId = this.extractOptionalString(payload, ["orderId", "id", "order_id"]);
    const rawClientId = this.extractOptionalString(payload, ["clientId", "clientOrderId"]);

    // Step 2: Fall back to nested data payload when present.
    if (rawOrderId === null || rawClientId === null) {
      if (isRecord(payload)) {
        const data = payload.data;
        if (isRecord(data)) {
          const nestedOrderId = this.extractOptionalString(data, ["orderId", "id", "order_id"]);
          const nestedClientId = this.extractOptionalString(data, ["clientId", "clientOrderId"]);
          return {
            orderId: rawOrderId ?? nestedOrderId ?? null,
            clientId: rawClientId ?? nestedClientId ?? fallbackClientId
          };
        }
      }
    }

    // Step 3: Return normalized identifiers with fallback for client id.
    return {
      orderId: rawOrderId ?? null,
      clientId: rawClientId ?? fallbackClientId
    };
  }

  /**
   * Builds a pending order snapshot for fallback scenarios.
   */
  private buildPendingOrderSnapshot(args: Readonly<{
    orderId: string | null;
    clientId: string;
    side: OrderSide;
    type: "MARKET" | "LIMIT" | "STOP_LOSS" | "TAKE_PROFIT";
    quantity: number;
    price: number | null;
    triggerPrice: number | null;
  }>): Order {
    // Step 1: Prepare timestamps.
    const now = new Date().toISOString();

    // Step 2: Return a pending order snapshot using available identifiers.
    return {
      id: args.orderId ?? args.clientId,
      symbol: this.symbol,
      type: this.mapOrderType(args.type),
      side: args.side,
      status: "pending",
      quantity: args.quantity,
      filledQuantity: 0,
      averageFillPrice: null,
      price: args.price,
      triggerPrice: args.triggerPrice,
      createdAtUtc: now,
      updatedAtUtc: now,
      filledAtUtc: null
    };
  }

  /**
   * Polls Bitunix until an order is confirmed or times out.
   */
  private async confirmOrder(args: Readonly<{
    orderId: string | null;
    clientId: string;
    fallbackOrder: Order;
  }>): Promise<Order> {
    // Step 1: Configure polling retries and delay.
    const maxAttempts = 10;
    const delayMs = 500;
    let lastKnown = args.fallbackOrder;

    // Step 2: Poll the order detail endpoint for confirmation.
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.sleep(delayMs);
      try {
        const order = await this.fetchOrderDetail({
          orderId: args.orderId ?? undefined,
          clientId: args.clientId
        });
        lastKnown = order;

        if (order.status === "filled") {
          return order;
        }
        if (order.status === "rejected" || order.status === "cancelled") {
          throw new ExchangeError({
            code: "INVALID_ORDER",
            message: `Order ${order.status}`,
            details: {
              orderId: args.orderId,
              clientId: args.clientId,
              status: order.status
            }
          });
        }
      } catch (err: unknown) {
        if (err instanceof ExchangeError && err.code === "ORDER_NOT_FOUND") {
          continue;
        }
        throw err;
      }
    }

    // Step 3: Return the last known state when polling times out.
    console.warn(`Order ${args.clientId} status unknown after ${maxAttempts * delayMs}ms`);
    return lastKnown;
  }

  /**
   * Fetches order details using order id or client id.
   */
  private async fetchOrderDetail(args: Readonly<{
    orderId?: string;
    clientId?: string;
  }>): Promise<Order> {
    // Step 1: Ensure at least one identifier is provided.
    if ((args.orderId === undefined || args.orderId.length === 0) &&
        (args.clientId === undefined || args.clientId.length === 0)) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: "orderId or clientId must be provided"
      });
    }

    // Step 2: Build query parameters.
    const query: Record<string, string> = {};
    if (args.orderId !== undefined && args.orderId.length > 0) {
      query.orderId = args.orderId;
    }
    if (args.clientId !== undefined && args.clientId.length > 0) {
      query.clientId = args.clientId;
    }

    // Step 3: Request order detail and parse.
    const response = await this.request({
      method: "GET",
      path: "/api/v1/futures/trade/get_order_detail",
      query,
      isPrivate: true
    });
    return this.parseOrder(response);
  }

  /**
   * Executes a Bitunix REST request with auth and retry handling.
   */
  private async request(args: RequestArgs): Promise<unknown> {
    // Step 1: Execute the REST request within the circuit breaker.
    return this.executeWithCircuitBreaker(async () => {
      return this.requestInternal(args);
    });
  }

  /**
   * Executes a Bitunix REST request with auth and retry handling.
   */
  private async requestInternal(args: RequestArgs): Promise<unknown> {
    // Step 1: Acquire rate limit token for the request.
    const limiter = args.isPrivate ? this.privateLimiter : this.publicLimiter;
    await limiter.consume(1);
    this.lastRateLimitStatus = limiter.getStatus();

    // Step 2: Build request URL with query parameters.
    const base = args.restBaseOverride ?? this.restBaseUrl;
    const url = new URL(`${base}${args.path}`);
    
    // Step 2a: Build sorted query params string for signature
    const sortedQueryParams: Array<[string, string]> = [];
    if (args.query !== undefined) {
      for (const [key, value] of Object.entries(args.query)) {
        if (value === undefined || value === null) {
          continue;
        }
        sortedQueryParams.push([key, String(value)]);
        url.searchParams.set(key, String(value));
      }
    }
    // Sort query params alphabetically by key
    sortedQueryParams.sort((a, b) => a[0].localeCompare(b[0]));
    // Bitunix requires query params WITHOUT equals signs: "key1value1key2value2"
    const queryParamsString = sortedQueryParams.map(([k, v]) => `${k}${v}`).join("");

    // Step 3: Serialize request body (no spaces for signature).
    const body = args.body === undefined ? undefined : JSON.stringify(args.body);
    const bodyString = body ?? "";

    // Step 4: Build request headers.
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    // Step 5: Attach authentication headers for private endpoints.
    if (args.isPrivate) {
      const auth = createAuthPayload({
        apiKey: this.apiKey,
        secretKey: this.secretKey,
        queryParams: queryParamsString,
        body: bodyString
      });
      headers["api-key"] = this.apiKey;
      headers.nonce = auth.nonce;
      headers.timestamp = String(auth.timestamp);
      headers.sign = auth.sign;
    }

    // Step 6: Execute request with retry handling.
    const response = await this.fetchWithRetry({
      url: url.toString(),
      method: args.method,
      headers,
      ...(body === undefined ? {} : { body }),
      rateLimiter: limiter
    });

    // Step 7: Parse and unwrap response payload.
    const payload = await this.parseJsonResponse(response);
    return this.unwrapBitunixPayload(payload, response.status);
  }

  /**
   * Executes a function guarded by the circuit breaker.
   */
  private async executeWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
    // Step 1: Delegate to circuit breaker with failure classification.
    return this.circuitBreaker.execute(fn, (error) => this.shouldTripCircuit(error));
  }

  /**
   * Determines whether a failure should count toward circuit breaker state.
   */
  private shouldTripCircuit(error: unknown): boolean {
    // Step 1: Only trip on transport or service failures.
    if (error instanceof ExchangeError) {
      if (error.code === "RATE_LIMIT") {
        return false;
      }
      if (error.code === "INVALID_ORDER" || error.code === "INVALID_SYMBOL") {
        return false;
      }
      if (error.code === "INSUFFICIENT_BALANCE" || error.code === "ORDER_NOT_FOUND") {
        return false;
      }
      if (error.code === "AUTH_ERROR" || error.code === "PERMISSION_DENIED") {
        return false;
      }
      if (error.code === "UNSUPPORTED") {
        return false;
      }
    }
    return true;
  }

  /**
   * Executes a fetch with retries for rate limiting and 5xx errors.
   */
  private async fetchWithRetry(args: Readonly<{
    url: string;
    method: RequestMethod;
    headers: Readonly<Record<string, string>>;
    body?: string;
    rateLimiter: TokenBucket;
  }>): Promise<Response> {
    // Step 1: Configure retry policy.
    const maxRetries = 3;
    const timeoutMs = 30_000; // 30 second timeout
    let attempt = 0;

    // Step 2: Execute request with retry loop.
    while (true) {
      attempt += 1;
      // Step 2a: Build fetch init with optional body and timeout.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const init: RequestInit = {
          method: args.method,
          headers: args.headers,
          signal: controller.signal,
          ...(args.body === undefined ? {} : { body: args.body })
        };
        const response = await fetch(args.url, init);
        clearTimeout(timeoutId);

        // Step 3: Handle rate limit retries.
        if (response.status === 429 && attempt <= maxRetries) {
          const retryAfter = this.parseRetryAfterMs(response.headers.get("retry-after"));
          await this.sleep(retryAfter ?? args.rateLimiter.getResetDelayMs());
          continue;
        }

        // Step 4: Handle transient server errors.
        if (response.status >= 500 && response.status < 600 && attempt <= maxRetries) {
          const backoff = Math.min(2_000, 250 * Math.pow(2, attempt - 1));
          await this.sleep(backoff);
          continue;
        }

        // Step 5: Return the response when no more retries are needed.
        return response;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        
        // Step 6: Handle timeout and network errors with retries.
        if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) {
          if (attempt <= maxRetries) {
            const backoff = Math.min(2_000, 250 * Math.pow(2, attempt - 1));
            await this.sleep(backoff);
            continue;
          }
          throw new ExchangeError({
            code: "NETWORK_ERROR",
            message: `Bitunix API request timeout or network error after ${maxRetries} retries: ${args.url}`
          });
        }
        throw err;
      }
    }
  }

  /**
   * Parses a JSON response or throws a descriptive ExchangeError.
   */
  private async parseJsonResponse(response: Response): Promise<unknown> {
    // Step 1: Read response text payload.
    const text = await response.text();
    if (text.trim().length === 0) {
      return {};
    }

    // Step 2: Attempt JSON parsing.
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Invalid JSON response from Bitunix (status ${response.status})`
      });
    }
  }

  /**
   * Unwraps Bitunix response envelopes and maps error codes.
   */
  private unwrapBitunixPayload(payload: unknown, status: number): unknown {
    // Step 1: Handle non-object payloads.
    if (!isRecord(payload)) {
      if (status >= 400) {
        throw new ExchangeError({
          code: "INTERNAL_ERROR",
          message: `Unexpected Bitunix error response (${status})`
        });
      }
      return payload;
    }

    // Step 2: Extract Bitunix error codes.
    const code = payload.code;
    const message = payload.msg;
    if (typeof code === "number" && code !== 0) {
      console.error("[BitunixAdapter] Bitunix API error - Code:", code, "Message:", message, "Full payload:", JSON.stringify(payload, null, 2));
      throw this.mapBitunixError(code, typeof message === "string" ? message : "Bitunix error");
    }

    // Step 3: Surface HTTP errors without Bitunix code.
    if (status >= 400) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Bitunix error response (${status})`
      });
    }

    // Step 4: Return data payload when present.
    return payload.data ?? payload;
  }

  /**
   * Maps Bitunix error codes to ExchangeError instances.
   */
  private mapBitunixError(code: number, message: string): ExchangeError {
    // Step 1: Map known Bitunix error codes from documentation.
    const mappedCode = this.resolveBitunixErrorCode(code);
    if (mappedCode !== null) {
      return new ExchangeError({
        code: mappedCode,
        message: `Bitunix error ${code}: ${message}`,
        details: { code, message }
      });
    }

    // Step 2: Fallback to internal error.
    return new ExchangeError({
      code: "INTERNAL_ERROR",
      message: `Bitunix error ${code}: ${message}`,
      details: { code, message }
    });
  }

  /**
   * Resolves Bitunix numeric error codes to ExchangeErrorCode values.
   */
  private resolveBitunixErrorCode(code: number): ExchangeErrorCode | null {
    // Step 1: Map known error codes to internal categories.
    const mapping: Readonly<Record<number, ExchangeErrorCode>> = {
      403: "PERMISSION_DENIED",
      10001: "NETWORK_ERROR",
      10002: "INVALID_ORDER",
      10003: "AUTH_ERROR",
      10004: "AUTH_ERROR",
      10005: "RATE_LIMIT",
      10006: "RATE_LIMIT",
      10007: "AUTH_ERROR",
      10008: "INVALID_ORDER",
      20001: "INVALID_SYMBOL",
      20002: "INVALID_ORDER",
      20003: "INSUFFICIENT_BALANCE",
      20004: "INVALID_ORDER",
      20005: "INVALID_ORDER",
      20006: "INVALID_ORDER",
      20007: "ORDER_NOT_FOUND",
      20008: "INVALID_ORDER",
      20009: "INVALID_ORDER",
      20010: "INVALID_ORDER",
      20011: "PERMISSION_DENIED",
      20012: "UNSUPPORTED",
      20013: "PERMISSION_DENIED",
      20014: "PERMISSION_DENIED",
      20015: "UNSUPPORTED",
      20016: "INVALID_ORDER",
      30001: "INVALID_ORDER",
      30002: "INVALID_ORDER",
      30003: "INVALID_ORDER",
      30004: "INVALID_ORDER",
      30005: "INVALID_ORDER",
      30006: "INVALID_ORDER",
      30007: "INVALID_ORDER",
      30008: "INVALID_ORDER",
      30009: "INVALID_ORDER",
      30010: "INVALID_ORDER",
      30011: "INTERNAL_ERROR",
      30012: "INVALID_ORDER",
      30013: "INVALID_ORDER",
      30014: "INVALID_ORDER",
      30015: "INVALID_ORDER",
      30016: "INVALID_ORDER",
      30017: "INVALID_ORDER",
      30018: "INVALID_ORDER",
      30019: "INVALID_ORDER",
      30020: "INVALID_ORDER",
      30021: "INVALID_ORDER",
      30022: "INVALID_ORDER",
      30023: "INVALID_ORDER",
      30024: "INVALID_ORDER",
      30025: "INVALID_ORDER",
      30026: "INVALID_ORDER",
      30027: "INVALID_ORDER",
      30028: "INVALID_ORDER",
      30029: "INVALID_ORDER",
      30030: "INVALID_ORDER",
      30031: "INVALID_ORDER",
      30032: "INVALID_ORDER",
      30033: "INVALID_ORDER",
      30034: "INVALID_ORDER",
      30035: "INVALID_ORDER",
      30036: "INVALID_ORDER",
      30037: "INVALID_ORDER",
      30038: "INVALID_ORDER",
      30039: "INVALID_ORDER",
      30040: "PERMISSION_DENIED",
      30041: "INVALID_ORDER",
      30042: "INVALID_ORDER",
      40001: "PERMISSION_DENIED",
      40002: "INVALID_ORDER",
      40003: "INVALID_ORDER",
      40004: "INVALID_ORDER",
      40005: "PERMISSION_DENIED",
      40006: "INVALID_ORDER",
      40007: "SERVICE_UNAVAILABLE",
      40008: "INVALID_ORDER"
    };
    return mapping[code] ?? null;
  }

  /**
   * Parses a list payload into ExchangeCandle objects.
   */
  private parseCandles(payload: unknown): ExchangeCandle[] {
    // Step 1: Extract list payload.
    const rows = this.extractArray(payload);
    const candles: ExchangeCandle[] = [];

    // Step 2: Normalize each candle row.
    for (const row of rows) {
      const candle = this.parseCandleRow(row);
      candles.push(candle);
    }

    // Step 3: Sort candles chronologically.
    candles.sort((a, b) => a.timeUtcMs - b.timeUtcMs);
    return candles;
  }

  /**
   * Normalizes a candle row into a single candle.
   */
  private parseCandleRow(row: unknown): ExchangeCandle {
    // Step 1: Detect array vs object payloads.
    if (Array.isArray(row)) {
      return this.parseCandleArray(row);
    }
    if (isRecord(row)) {
      return this.parseCandleObject(row);
    }

    // Step 2: Reject unsupported payloads.
    throw new ExchangeError({
      code: "INTERNAL_ERROR",
      message: "Invalid candle row format"
    });
  }

  /**
   * Parses array-format candle rows.
   */
  private parseCandleArray(row: unknown[]): ExchangeCandle {
    // Step 1: Extract numeric fields by index.
    const time = this.extractArrayNumber(row, 0);
    const open = this.extractArrayNumber(row, 1);
    const high = this.extractArrayNumber(row, 2);
    const low = this.extractArrayNumber(row, 3);
    const close = this.extractArrayNumber(row, 4);
    const volume = this.extractArrayNumber(row, 5, 0);

    // Step 2: Build candle object.
    return {
      timeUtcMs: time,
      open,
      high,
      low,
      close,
      volume
    };
  }

  /**
   * Parses object-format candle rows.
   */
  private parseCandleObject(row: JsonRecord): ExchangeCandle {
    // Step 1: Extract fields by common key names.
    const time = this.extractNumber(row, ["time", "timeUtcMs", "openTime", "ts", "timestamp"]);
    const open = this.extractNumber(row, ["open", "o"]);
    const high = this.extractNumber(row, ["high", "h"]);
    const low = this.extractNumber(row, ["low", "l"]);
    const close = this.extractNumber(row, ["close", "c"]);
    const volume = this.extractNumber(row, ["volume", "v", "b"], 0);

    // Step 2: Build candle object.
    return {
      timeUtcMs: time,
      open,
      high,
      low,
      close,
      volume
    };
  }

  /**
   * Maps Bitunix order payloads to the shared Order model.
   */
  private parseOrder(payload: unknown): Order {
    // Step 1: Validate payload structure.
    if (!isRecord(payload)) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Invalid order payload"
      });
    }

    // Step 2: Extract core order fields.
    const id = this.extractString(payload, ["orderId", "id", "order_id"]);
    const symbol = this.extractString(payload, ["symbol"]);
    const sideRaw = this.extractString(payload, ["side"]);
    const side: OrderSide = sideRaw.toUpperCase() === "SELL" ? "sell" : "buy";
    const typeRaw = this.extractString(payload, ["type", "orderType"]);
    const type = this.mapOrderType(typeRaw);
    const status = this.mapOrderStatus(this.extractString(payload, ["status"]));

    // Step 3: Extract quantities, prices, and timestamps.
    const quantity = this.extractNumber(payload, ["origQty", "quantity", "qty"]);
    const filledQuantity = this.extractOptionalNumber(payload, ["executedQty", "filledQty", "filledQuantity", "tradeQty", "tradeQuantity"]) ?? 0;
    const avgFillPrice = this.extractOptionalNumber(payload, ["avgPrice", "averageFillPrice", "avgFillPrice"]);
    const price = this.extractOptionalNumber(payload, ["price"]);
    const triggerPrice = this.extractOptionalNumber(payload, ["stopPrice", "triggerPrice"]);
    const createdAtUtc = this.extractTimestampIso(payload, ["time", "createdAt", "createTime"], new Date().toISOString());
    const updatedAtUtc = this.extractTimestampIso(payload, ["updateTime", "updatedAt"], createdAtUtc);
    const filledAtUtc = this.extractOptionalTimestampIso(payload, ["filledTime", "filledAt"]);

    // Step 4: Return normalized order snapshot.
    return {
      id,
      symbol: fromBitunixSymbol(symbol),
      type,
      side,
      status,
      quantity,
      filledQuantity,
      averageFillPrice: avgFillPrice ?? null,
      price: price ?? null,
      triggerPrice: triggerPrice ?? null,
      createdAtUtc,
      updatedAtUtc,
      filledAtUtc
    };
  }

  /**
   * Maps Bitunix order type strings to internal types.
   */
  private mapOrderType(value: string): Order["type"] {
    // Step 1: Normalize value to uppercase.
    const normalized = value.toUpperCase();
    if (normalized === "LIMIT") {
      return "limit";
    }
    if (normalized === "STOP_LOSS") {
      return "stop_loss";
    }
    if (normalized === "TAKE_PROFIT") {
      return "take_profit";
    }
    // Step 2: Fallback to market type.
    return "market";
  }

  /**
   * Maps Bitunix order status strings to internal statuses.
   */
  private mapOrderStatus(value: string): OrderStatus {
    // Step 1: Normalize status to uppercase.
    const normalized = value.toUpperCase();
    if (normalized === "NEW" || normalized === "OPEN") {
      return "open";
    }
    if (normalized === "PARTIALLY_FILLED" || normalized === "PART_FILLED" || normalized === "PENDING" || normalized === "INIT") {
      return "pending";
    }
    if (normalized === "FILLED") {
      return "filled";
    }
    if (normalized === "CANCELED" || normalized === "CANCELLED") {
      return "cancelled";
    }
    if (normalized === "REJECTED") {
      return "rejected";
    }
    // Step 2: Default to open when unknown.
    return "open";
  }

  /**
   * Returns whether the WebSocket manager is healthy.
   */
  private isWebSocketHealthy(): boolean {
    // Step 1: Guard against missing manager.
    if (this.wsManager === null) {
      return false;
    }
    // Step 2: Delegate to WebSocket health check.
    return this.wsManager.isHealthy();
  }

  /**
   * Returns cached WebSocket candles when available.
   */
  private getWebSocketCandles(limit?: number): ExchangeCandle[] | null {
    // Step 1: Ensure we have at least one WebSocket candle.
    if (this.lastWsCandle === null || this.lastWsCandleAtMs === null) {
      return null;
    }
    // Step 2: Require recent activity before trusting the cache.
    const ageMs = Date.now() - this.lastWsCandleAtMs;
    if (ageMs > 60_000) {
      return null;
    }
    // Step 3: Return cached candles with optional limit.
    if (this.lastCandles.length === 0) {
      return limit === undefined ? [this.lastWsCandle] : [this.lastWsCandle].slice(-limit);
    }
    return limit === undefined ? this.lastCandles : this.lastCandles.slice(-limit);
  }

  /**
   * Persists a WebSocket candle into the local cache.
   */
  private recordWebSocketCandle(candle: ExchangeCandle): void {
    // Step 1: Update WebSocket tracking fields.
    const now = Date.now();
    this.lastWsCandle = candle;
    this.lastWsCandleAtMs = now;
    this.lastWsPriceAtMs = now;
    this.lastPrice = candle.close;

    // Step 2: Merge into the candle cache, replacing by timestamp when needed.
    const nextCandles = [...this.lastCandles];
    const last = nextCandles.at(-1);
    if (last !== undefined && last.timeUtcMs === candle.timeUtcMs) {
      nextCandles[nextCandles.length - 1] = candle;
    } else {
      nextCandles.push(candle);
    }
    if (nextCandles.length > this.wsCandleMaxCache) {
      nextCandles.splice(0, nextCandles.length - this.wsCandleMaxCache);
    }
    this.lastCandles = nextCandles;
    this.lastCandleFetchMs = now;
  }

  /**
   * Parses a WebSocket kline event into an ExchangeCandle.
   */
  private parseKlineEvent(event: Readonly<{
    channel: string;
    symbol: string;
    timestampMs: number;
    data: Readonly<Record<string, unknown>>;
  }>): ExchangeCandle {
    // Step 1: Extract numeric fields from event data.
    const open = this.extractNumber(event.data, ["o", "open"]);
    const close = this.extractNumber(event.data, ["c", "close"]);
    const high = this.extractNumber(event.data, ["h", "high"]);
    const low = this.extractNumber(event.data, ["l", "low"]);
    const volume = this.extractNumber(event.data, ["b", "v", "volume"], 0);

    // Step 2: Build candle snapshot.
    return {
      timeUtcMs: event.timestampMs,
      open,
      high,
      low,
      close,
      volume
    };
  }

  /**
   * Parses a Bitunix balance response into a Balance snapshot.
   */
  private parseBalance(payload: unknown, quoteCurrency: string): ParsedBalance {
    // Step 1: Parse direct array responses.
    if (Array.isArray(payload)) {
      const entry = this.pickBalanceEntry(payload, quoteCurrency);
      return this.parseBalanceEntry(entry, quoteCurrency);
    }
    // Step 2: Parse object responses with nested data.
    if (isRecord(payload)) {
      const data = payload.data ?? payload;
      if (isRecord(data)) {
        const balances = data.balances ?? data.assets ?? data.list;
        const list = Array.isArray(balances) ? balances : [];
        if (list.length > 0) {
          const entry = this.pickBalanceEntry(list, quoteCurrency);
          return this.parseBalanceEntry(entry, quoteCurrency);
        }
        if (data.available !== undefined || data.total !== undefined) {
          const available = this.extractNumber(data, ["available", "availableBalance", "free"], 0);
          const total = this.extractNumber(data, ["total", "equity", "balance"], available);
          const locked = Math.max(0, total - available);
          return { currency: quoteCurrency, available, locked, total };
        }
      }
    }

    // Step 3: Reject unsupported payloads.
    throw new ExchangeError({
      code: "INTERNAL_ERROR",
      message: "Unable to parse Bitunix balance response"
    });
  }

  /**
   * Picks a balance entry that matches the quote currency.
   */
  private pickBalanceEntry(entries: readonly unknown[], quoteCurrency: string): JsonRecord {
    // Step 1: Search for matching quote currency.
    const upperQuote = quoteCurrency.toUpperCase();
    for (const entry of entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const asset = this.extractOptionalString(entry, ["asset", "currency", "coin"]);
      if (asset !== null && asset.toUpperCase() === upperQuote) {
        return entry;
      }
    }

    // Step 2: Fallback to first entry when no match found.
    const first = entries[0];
    if (!isRecord(first)) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Balance entry missing"
      });
    }
    return first;
  }

  /**
   * Normalizes a balance entry into the Balance shape.
   */
  private parseBalanceEntry(entry: JsonRecord, currency: string): ParsedBalance {
    // Step 1: Extract available, locked, and total fields.
    const available = this.extractNumber(entry, ["free", "available", "availableBalance"], 0);
    const locked = this.extractNumber(entry, ["locked", "frozen"], 0);
    const total = this.extractNumber(entry, ["total", "balance"], available + locked);
    // Step 2: Return normalized balance.
    return { currency, available, locked, total };
  }

  /**
   * Derives the quote currency for the configured symbol.
   */
  private resolveQuoteCurrency(): string {
    // Step 1: Extract quote currency in Bitunix format (e.g. USDT, not USD).
    const bitunixSymbol = toBitunixSymbol(this.symbol);
    // For futures, the margin coin should be in Bitunix format
    if (bitunixSymbol.endsWith("USDT")) {
      return "USDT";
    }
    if (bitunixSymbol.endsWith("USD")) {
      return "USD";
    }
    // Fallback: extract last 3-4 characters as quote
    return bitunixSymbol.slice(-4);
  }

  /**
   * Extracts an array from Bitunix payloads.
   */
  private extractArray(payload: unknown): unknown[] {
    // Step 1: Handle direct array payloads.
    if (Array.isArray(payload)) {
      return payload;
    }
    // Step 2: Extract nested arrays from common keys.
    if (isRecord(payload)) {
      const data = payload.data ?? payload.list ?? payload.rows ?? payload.items;
      if (Array.isArray(data)) {
        return data;
      }
      // Step 3: Handle null/undefined data (no results) - return empty array
      if (data === null || data === undefined) {
        return [];
      }
    }
    throw new ExchangeError({
      code: "INTERNAL_ERROR",
      message: "Expected array payload from Bitunix"
    });
  }

  /**
   * Extracts a required numeric field from a payload.
   */
  private extractNumber(payload: unknown, keys: readonly string[], fallback?: number): number {
    // Step 1: Extract raw value.
    const value = this.extractValue(payload, keys);
    if (value === undefined) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Missing numeric field: ${keys.join(", ")}`
      });
    }
    // Step 2: Parse numeric string/number inputs.
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Invalid numeric field: ${keys.join(", ")}`
      });
    }
    // Step 3: Return numeric value.
    return Number(parsed);
  }

  /**
   * Extracts an optional numeric field from a payload.
   */
  private extractOptionalNumber(payload: unknown, keys: readonly string[]): number | null {
    // Step 1: Extract raw value.
    const value = this.extractValue(payload, keys);
    if (value === undefined || value === null) {
      return null;
    }
    // Step 2: Parse numeric value when present.
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Number(parsed);
  }

  /**
   * Extracts a required string field from a payload.
   */
  private extractString(payload: unknown, keys: readonly string[]): string {
    // Step 1: Extract raw value.
    const value = this.extractValue(payload, keys);
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Missing string field: ${keys.join(", ")}`
      });
    }
    // Step 2: Return normalized string.
    return value;
  }

  /**
   * Extracts an optional string field from a payload.
   */
  private extractOptionalString(payload: unknown, keys: readonly string[]): string | null {
    // Step 1: Extract raw value.
    const value = this.extractValue(payload, keys);
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    // Step 2: Return optional string.
    return value;
  }

  /**
   * Retrieves the first matching value for a list of keys.
   */
  private extractValue(payload: unknown, keys: readonly string[]): unknown {
    // Step 1: Ensure payload is an object.
    if (!isRecord(payload)) {
      return undefined;
    }
    // Step 2: Return the first matching key.
    for (const key of keys) {
      if (Object.hasOwn(payload, key)) {
        return payload[key];
      }
    }
    return undefined;
  }

  /**
   * Extracts a numeric value from an array by index.
   */
  private extractArrayNumber(row: unknown[], index: number, fallback?: number): number {
    // Step 1: Extract raw value by index.
    const value = row[index];
    if (value === undefined || value === null) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Missing array value at index ${index}`
      });
    }
    // Step 2: Parse numeric value.
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Invalid array value at index ${index}`
      });
    }
    // Step 3: Return numeric value.
    return Number(parsed);
  }

  /**
   * Extracts a timestamp field and converts it to ISO format.
   */
  private extractTimestampIso(payload: unknown, keys: readonly string[], fallback?: string): string {
    // Step 1: Extract raw value.
    const value = this.extractValue(payload, keys);
    if (value === undefined || value === null) {
      if (fallback !== undefined) {
        return fallback;
      }
      return new Date().toISOString();
    }
    // Step 2: Normalize numeric timestamps.
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    // Step 3: Normalize date strings.
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    // Step 4: Fallback to provided value or now.
    return fallback ?? new Date().toISOString();
  }

  /**
   * Extracts an optional timestamp field and converts it to ISO.
   */
  private extractOptionalTimestampIso(payload: unknown, keys: readonly string[]): string | null {
    // Step 1: Extract raw value.
    const value = this.extractValue(payload, keys);
    if (value === undefined || value === null) {
      return null;
    }
    // Step 2: Normalize numeric timestamps.
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    // Step 3: Normalize date strings.
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    // Step 4: Return null for unsupported formats.
    return null;
  }

  /**
   * Computes unrealized PnL for a position snapshot.
   */
  private computeUnrealizedPnl(side: PositionSide, entry: number, current: number, qty: number): number {
    // Step 1: Compute PnL by side direction.
    if (side === "long") {
      return (current - entry) * qty;
    }
    return (entry - current) * qty;
  }

  /**
   * Maps a Yahoo interval to Bitunix WebSocket channel naming.
   */
  private toWebSocketChannel(interval: YahooInterval): string {
    // Step 1: Map interval to Bitunix channel naming.
    if (interval.endsWith("m")) {
      return `market_kline_${interval.replace("m", "min")}`;
    }
    if (interval === "1h") {
      return "market_kline_60min";
    }
    if (interval === "1d") {
      return "market_kline_1day";
    }
    return `market_kline_${interval}`;
  }

  /**
   * Resolves the REST base URL for spot endpoints.
   */
  private resolveRestBaseUrl(): string {
    // Step 1: Resolve REST base URL based on environment.
    // Note: Bitunix uses the same base URL (fapi.bitunix.com) for both spot and futures
    if (this.testMode) {
      return "https://testnet.bitunix.com";
    }
    return "https://fapi.bitunix.com";
  }

  /**
   * Resolves the REST base URL for futures endpoints.
   */
  private resolveFuturesRestBaseUrl(): string {
    // Step 1: Resolve futures REST base URL based on environment.
    // Note: Bitunix uses the same base URL for both spot and futures
    if (this.testMode) {
      return "https://testnet.bitunix.com";
    }
    return "https://fapi.bitunix.com";
  }

  /**
   * Resolves the Bitunix WebSocket URL.
   */
  private resolveWebSocketUrl(): string {
    // Step 1: Return Bitunix WebSocket base URL.
    return "wss://openapi.bitunix.com:443/ws-api/v1";
  }

  /**
   * Notifies all candle subscribers with updates.
   */
  private notifyCandleSubscribers(candles: readonly ExchangeCandle[]): void {
    // Step 1: Notify all subscribers safely.
    for (const subscriber of this.candleSubscribers.values()) {
      try {
        subscriber.onCandles(candles);
      } catch {
        // Swallow subscriber errors to keep stream alive.
      }
    }
  }

  /**
   * Notifies candle subscribers of stream errors.
   */
  private notifyCandleSubscriberErrors(error: ExchangeError): void {
    // Step 1: Notify subscribers with error handlers.
    for (const subscriber of this.candleSubscribers.values()) {
      if (subscriber.onError === undefined) {
        continue;
      }
      try {
        subscriber.onError(error);
      } catch {
        // Swallow subscriber errors to keep stream alive.
      }
    }
  }

  /**
   * Parses the Retry-After header into milliseconds.
   */
  private parseRetryAfterMs(value: string | null): number | null {
    // Step 1: Parse retry-after value.
    if (value === null) {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed * 1_000;
  }

  /**
   * Builds the set of parameters to include in the signature.
   */
  private buildSignableParams(
    query?: SignableParams,
    body?: Readonly<Record<string, unknown>>
  ): SignableParams {
    // Step 1: Merge query params into signature params.
    const output: Record<string, SignableValue> = {};
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        output[key] = value;
      }
    }
    // Step 2: Merge body params with type validation.
    if (body !== undefined) {
      for (const [key, value] of Object.entries(body)) {
        if (value === null || value === undefined) {
          output[key] = value;
          continue;
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          output[key] = value;
          continue;
        }
        throw new ExchangeError({
          code: "INVALID_ORDER",
          message: `Unsupported signature param type for ${key}`
        });
      }
    }
    // Step 3: Return merged params.
    return output;
  }

  /**
   * Ensures the adapter is connected before use.
   */
  private assertConnected(): void {
    // Step 1: Guard against disconnected usage.
    if (!this.isConnectedFlag) {
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "Adapter is not connected"
      });
    }
  }

  /**
   * Validates a required positive numeric input.
   */
  private assertPositiveNumber(value: number, fieldName: string): void {
    // Step 1: Validate numeric input.
    if (!Number.isFinite(value)) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be a finite number`
      });
    }
    if (value <= 0) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be > 0`
      });
    }
  }

  /**
   * Validates a required non-empty string input.
   */
  private assertNonEmptyString(value: string, fieldName: string): void {
    // Step 1: Validate string input.
    if (typeof value !== "string") {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be a string`
      });
    }
    if (value.trim().length === 0) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: `${fieldName} must be non-empty`
      });
    }
  }

  /**
   * Sleeps for a given duration in milliseconds.
   */
  private async sleep(ms: number): Promise<void> {
    // Step 1: Await a timeout for the requested duration.
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Token bucket rate limiter for per-second API limits.
 */
class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private tokens: number;
  private lastRefillMs: number;

  /**
   * Creates a token bucket with per-second refill semantics.
   */
  public constructor(args: Readonly<{ capacity: number; refillPerSecond: number }>) {
    // Step 1: Validate capacity input.
    if (!Number.isFinite(args.capacity) || args.capacity <= 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Token bucket capacity must be positive"
      });
    }
    // Step 2: Validate refill rate input.
    if (!Number.isFinite(args.refillPerSecond) || args.refillPerSecond <= 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Token bucket refill rate must be positive"
      });
    }
    // Step 3: Initialize token bucket state.
    this.capacity = args.capacity;
    this.refillPerSecond = args.refillPerSecond;
    this.tokens = args.capacity;
    this.lastRefillMs = Date.now();
  }

  /**
   * Consumes a number of tokens, waiting until available.
   */
  public async consume(count: number): Promise<void> {
    // Step 1: Validate consumption count.
    if (!Number.isFinite(count) || count <= 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Token bucket consume count must be positive"
      });
    }

    // Step 2: Wait until tokens are available.
    while (true) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }

      // Step 3: Sleep until next token is available.
      const waitMs = this.getResetDelayMs();
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Returns the current rate limit status snapshot.
   */
  public getStatus(): RateLimitStatus {
    // Step 1: Refill before reporting status.
    this.refill();
    // Step 2: Build status payload.
    return {
      limit: this.capacity,
      remaining: Math.max(0, Math.floor(this.tokens)),
      resetAtUtc: new Date(Date.now() + this.getResetDelayMs()).toISOString(),
      isThrottled: this.tokens < 1
    };
  }

  /**
   * Computes how long until a token is available.
   */
  public getResetDelayMs(): number {
    // Step 1: Refill before calculating delay.
    this.refill();
    if (this.tokens >= 1) {
      return 0;
    }
    // Step 2: Compute delay until next token.
    const missing = Math.max(0, 1 - this.tokens);
    const perMs = this.refillPerSecond / 1_000;
    return Math.ceil(missing / perMs);
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refill(): void {
    // Step 1: Calculate elapsed time since last refill.
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) {
      return;
    }
    // Step 2: Add tokens based on elapsed time.
    const refillAmount = (elapsedMs / 1_000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
    this.lastRefillMs = now;
  }
}

/**
 * Circuit breaker for guarding repeated exchange failures.
 */
class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private failureCount: number;
  private lastFailureMs: number;
  private openedAtMs: number | null;
  private state: CircuitBreakerState;

  /**
   * Creates a circuit breaker with threshold and cooldown settings.
   */
  public constructor(args: Readonly<{ failureThreshold: number; resetTimeoutMs: number }>) {
    // Step 1: Validate configuration inputs.
    if (!Number.isFinite(args.failureThreshold) || args.failureThreshold <= 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Circuit breaker failure threshold must be positive"
      });
    }
    if (!Number.isFinite(args.resetTimeoutMs) || args.resetTimeoutMs <= 0) {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: "Circuit breaker reset timeout must be positive"
      });
    }

    // Step 2: Persist configuration.
    this.failureThreshold = args.failureThreshold;
    this.resetTimeoutMs = args.resetTimeoutMs;

    // Step 3: Initialize runtime state.
    this.failureCount = 0;
    this.lastFailureMs = 0;
    this.openedAtMs = null;
    this.state = "closed";
  }

  /**
   * Executes a function with circuit breaker protection.
   */
  public async execute<T>(fn: () => Promise<T>, shouldTrip?: (error: unknown) => boolean): Promise<T> {
    // Step 1: Gate execution if the circuit is open.
    if (this.state === "open") {
      const elapsed = Date.now() - this.lastFailureMs;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = "half-open";
      } else {
        throw new ExchangeError({
          code: "CIRCUIT_OPEN",
          message: "Circuit breaker open"
        });
      }
    }

    // Step 2: Execute the operation and update breaker state.
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const shouldCountFailure = shouldTrip === undefined ? true : shouldTrip(error);
      if (shouldCountFailure) {
        this.onFailure();
      }
      throw error;
    }
  }

  /**
   * Returns a snapshot of the circuit breaker state.
   */
  public getSnapshot(): CircuitBreakerSnapshot {
    // Step 1: Convert timestamps to ISO strings.
    const lastFailureAtUtc = this.lastFailureMs > 0 ? new Date(this.lastFailureMs).toISOString() : null;
    const openedAtUtc = this.openedAtMs !== null ? new Date(this.openedAtMs).toISOString() : null;

    // Step 2: Return snapshot.
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureAtUtc,
      openedAtUtc
    };
  }

  /**
   * Resets breaker state on success.
   */
  private onSuccess(): void {
    // Step 1: Reset failure count and close circuit.
    this.failureCount = 0;
    this.state = "closed";
    this.openedAtMs = null;
  }

  /**
   * Updates breaker state on failure.
   */
  private onFailure(): void {
    // Step 1: Track failure timestamp.
    this.failureCount += 1;
    this.lastFailureMs = Date.now();

    // Step 2: Open circuit when threshold exceeded.
    if (this.failureCount >= this.failureThreshold) {
      if (this.state !== "open") {
        this.openedAtMs = this.lastFailureMs;
      }
      this.state = "open";
      console.error("[BitunixAdapter] Circuit breaker opened due to repeated failures");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
