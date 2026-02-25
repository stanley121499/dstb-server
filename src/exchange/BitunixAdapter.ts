import { randomUUID } from "node:crypto";

import type { YahooInterval } from "../data/yahooFinance.js";

import { BitunixWebSocket } from "./BitunixWebSocket.js";
import { BitunixClient } from "./BitunixClient.js";
import { BitunixMarketApi } from "./BitunixMarketApi.js";
import { BitunixAccountApi } from "./BitunixAccountApi.js";
import { BitunixPositionApi } from "./BitunixPositionApi.js";
import { BitunixTradeApi } from "./BitunixTradeApi.js";
import { BitunixTpSlApi } from "./BitunixTpSlApi.js";
import { BitunixAssetApi } from "./BitunixAssetApi.js";
import { toBitunixSymbol } from "./bitunixSymbolMapper.js";
import { ExchangeError } from "./ExchangeError.js";
import type { IExchangeAdapter } from "./IExchangeAdapter.js";
import {
  extractArray,
  extractNumber,
  isRecord,
  parseKlineEventData
} from "./BitunixParsers.js";
import type {
  Balance,
  CircuitBreakerSnapshot,
  ExchangeCandle,
  Order,
  OrderSide,
  Position,
  RateLimitStatus,
  Trade
} from "./types.js";
import type {
  OrderBook,
  BatchOrderParams,
  BatchOrderResult,
  TransferResult,
  FundingRate,
  TradingPair,
  LeverageInfo,
  MarginMode,
  PositionMode,
  HistoryPosition,
  PositionTier,
  HistoryOrder,
  TpSlOrder,
  PlaceTpSlOrderArgs,
  PlacePositionTpSlArgs,
  ModifyTpSlOrderArgs,
  ModifyPositionTpSlArgs,
  AssetBalance,
  PaginationArgs
} from "./bitunixTypes.js";

// ---------------------------------------------------------------------------
// Internal private types
// ---------------------------------------------------------------------------

type MarketType = "spot" | "futures";

type CandleSubscriber = Readonly<{
  id: string;
  onCandles: (candles: readonly ExchangeCandle[]) => void;
  onError?: (error: ExchangeError) => void;
}>;

// ---------------------------------------------------------------------------
// Re-exports for backwards compatibility with existing importers
// ---------------------------------------------------------------------------
export type { OrderBook, BatchOrderParams, BatchOrderResult, TransferResult };

/**
 * BitunixAdapter — production adapter for the Bitunix exchange.
 *
 * Architecture: thin orchestrator (~500 lines) that delegates to
 * focused domain modules:
 *  - BitunixClient   — HTTP transport, rate limiter, circuit breaker
 *  - BitunixMarketApi  — market data
 *  - BitunixAccountApi — account management
 *  - BitunixPositionApi — position management
 *  - BitunixTradeApi   — trade execution
 *  - BitunixTpSlApi    — TP/SL bracket orders
 *  - BitunixAssetApi   — sub-account transfers
 */
export class BitunixAdapter implements IExchangeAdapter {
  // ---------------------------------------------------------------------------
  // Configuration (immutable)
  // ---------------------------------------------------------------------------
  private readonly symbol: string;
  private readonly interval: YahooInterval;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly marketType: MarketType;
  private readonly wsUrl: string;
  private readonly wsCandleMaxCache: number = 500;

  // ---------------------------------------------------------------------------
  // Feature API modules (public for direct access)
  // ---------------------------------------------------------------------------
  public readonly market: BitunixMarketApi;
  public readonly account: BitunixAccountApi;
  public readonly position: BitunixPositionApi;
  public readonly trade: BitunixTradeApi;
  public readonly tpsl: BitunixTpSlApi;
  public readonly asset: BitunixAssetApi;
  public readonly httpClient: BitunixClient;

  // ---------------------------------------------------------------------------
  // Runtime state
  // ---------------------------------------------------------------------------
  private isConnectedFlag: boolean = false;
  private lastCandles: ExchangeCandle[] = [];
  private lastCandleFetchMs: number | null = null;
  private lastPrice: number | null = null;
  private lastWsCandle: ExchangeCandle | null = null;
  private lastWsCandleAtMs: number | null = null;
  private lastWsPriceAtMs: number | null = null;
  private readonly candleSubscribers: Map<string, CandleSubscriber> = new Map();
  private wsManager: BitunixWebSocket | null = null;
  private klineUnsubscribe: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  public constructor(args: Readonly<{
    symbol: string;
    interval: YahooInterval;
    apiKey: string;
    secretKey: string;
    marketType?: MarketType;
  }>) {
    if (typeof args.apiKey !== "string" || args.apiKey.trim().length === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "apiKey must be non-empty" });
    }
    if (typeof args.secretKey !== "string" || args.secretKey.trim().length === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "secretKey must be non-empty" });
    }
    if (typeof args.symbol !== "string" || args.symbol.trim().length === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "symbol must be non-empty" });
    }

    this.symbol = args.symbol;
    this.interval = args.interval;
    this.apiKey = args.apiKey;
    this.secretKey = args.secretKey;
    this.marketType = args.marketType ?? "spot";

    const restBaseUrl = "https://fapi.bitunix.com";
    this.wsUrl = "wss://openapi.bitunix.com:443/ws-api/v1";

    // Build shared HTTP client
    this.httpClient = new BitunixClient({ apiKey: args.apiKey, secretKey: args.secretKey, restBaseUrl });

    // Build domain modules
    this.market = new BitunixMarketApi(this.httpClient);
    this.account = new BitunixAccountApi(this.httpClient);
    this.position = new BitunixPositionApi(this.httpClient);
    this.trade = new BitunixTradeApi(this.httpClient);
    this.tpsl = new BitunixTpSlApi(this.httpClient);
    this.asset = new BitunixAssetApi(this.httpClient);
  }

  // ---------------------------------------------------------------------------
  // IExchangeAdapter — lifecycle
  // ---------------------------------------------------------------------------

  public async connect(): Promise<void> {
    if (this.isConnectedFlag) return;
    await this.connectWebSocket();
    this.isConnectedFlag = true;
  }

  public async disconnect(): Promise<void> {
    if (this.klineUnsubscribe !== null) {
      this.klineUnsubscribe();
      this.klineUnsubscribe = null;
    }
    if (this.wsManager !== null) {
      await this.wsManager.disconnect();
      this.wsManager = null;
    }
    this.isConnectedFlag = false;
  }

  public async isConnected(): Promise<boolean> {
    return this.isConnectedFlag;
  }

  // ---------------------------------------------------------------------------
  // IExchangeAdapter — market data
  // ---------------------------------------------------------------------------

  public async getLatestCandles(args?: Readonly<{ limit?: number }>): Promise<readonly ExchangeCandle[]> {
    this.assertConnected();
    const limit = args?.limit;

    // Prefer WebSocket cache
    if (this.wsManager !== null && this.wsManager.isHealthy()) {
      const wsCandles = this.getWebSocketCandleCache(limit);
      if (wsCandles !== null) return wsCandles;
    }

    // Return REST cache if fresh
    const now = Date.now();
    if (this.lastCandleFetchMs !== null && now - this.lastCandleFetchMs < 10_000) {
      if (limit === undefined || this.lastCandles.length >= limit) {
        return limit === undefined ? this.lastCandles : this.lastCandles.slice(-limit);
      }
    }

    // Fetch from REST
    const candles = await this.market.getKline({ symbol: this.symbol, interval: this.interval, limit });
    this.lastCandles = [...candles];
    this.lastCandleFetchMs = Date.now();
    const latest = candles.at(-1);
    if (latest !== undefined) this.lastPrice = latest.close;
    return limit === undefined ? candles : candles.slice(-limit);
  }

  public async subscribeToCandles(args: Readonly<{
    onCandles: (candles: readonly ExchangeCandle[]) => void;
    onError?: (error: ExchangeError) => void;
  }>): Promise<() => void> {
    if (typeof args.onCandles !== "function") {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "onCandles must be a function" });
    }
    this.assertConnected();
    await this.ensureWebSocket();

    const id = randomUUID();
    const subscriber: CandleSubscriber = args.onError === undefined
      ? { id, onCandles: args.onCandles }
      : { id, onCandles: args.onCandles, onError: args.onError };
    this.candleSubscribers.set(id, subscriber);
    await this.subscribeToKlines();
    return () => { this.candleSubscribers.delete(id); };
  }

  public async getLastPrice(): Promise<number> {
    this.assertConnected();

    // Prefer WebSocket price when healthy and recent
    if (this.wsManager !== null && this.wsManager.isHealthy() && this.lastPrice !== null) {
      const age = this.lastWsPriceAtMs === null ? Infinity : Date.now() - this.lastWsPriceAtMs;
      if (age <= 10_000) return this.lastPrice;
    }

    const { price } = await this.market.getTicker(this.symbol);
    this.lastPrice = price;
    return price;
  }

  // ---------------------------------------------------------------------------
  // IExchangeAdapter — account
  // ---------------------------------------------------------------------------

  public async getBalance(): Promise<Balance> {
    this.assertConnected();
    return this.account.getSingleAccount(this.resolveQuoteCurrency());
  }

  // ---------------------------------------------------------------------------
  // IExchangeAdapter — position
  // ---------------------------------------------------------------------------

  public async getPosition(): Promise<Position | null> {
    this.assertConnected();
    if (this.marketType === "spot") return null;
    return this.position.getPendingPosition(this.symbol);
  }

  // ---------------------------------------------------------------------------
  // IExchangeAdapter — orders
  // ---------------------------------------------------------------------------

  public async placeMarketOrder(args: Readonly<{ side: OrderSide; quantity: number }>): Promise<Order> {
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    return this.trade.placeOrder({ symbol: this.symbol, side: args.side, type: "MARKET", quantity: args.quantity });
  }

  public async placeLimitOrder(args: Readonly<{ side: OrderSide; quantity: number; price: number }>): Promise<Order> {
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.price, "price");
    return this.trade.placeOrder({ symbol: this.symbol, side: args.side, type: "LIMIT", quantity: args.quantity, price: args.price });
  }

  /**
   * Places a stop loss order using the dedicated TP/SL endpoint.
   * Requires an open position to attach to.
   */
  public async placeStopLossOrder(args: Readonly<{ side: OrderSide; quantity: number; stopPrice: number }>): Promise<Order> {
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.stopPrice, "stopPrice");
    const pos = await this.getPosition();
    const tpslArgs: PlaceTpSlOrderArgs = {
      symbol: this.symbol,
      side: args.side,
      triggerSide: "stop_loss",
      triggerPrice: args.stopPrice,
      quantity: args.quantity,
      positionId: pos?.id
    };
    const tpsl = await this.tpsl.placeTpSlOrder(tpslArgs);
    return this.tpslToOrder(tpsl);
  }

  /**
   * Places a take profit order using the dedicated TP/SL endpoint.
   * Requires an open position to attach to.
   */
  public async placeTakeProfitOrder(args: Readonly<{ side: OrderSide; quantity: number; takeProfitPrice: number }>): Promise<Order> {
    this.assertConnected();
    this.assertPositiveNumber(args.quantity, "quantity");
    this.assertPositiveNumber(args.takeProfitPrice, "takeProfitPrice");
    const pos = await this.getPosition();
    const tpslArgs: PlaceTpSlOrderArgs = {
      symbol: this.symbol,
      side: args.side,
      triggerSide: "take_profit",
      triggerPrice: args.takeProfitPrice,
      quantity: args.quantity,
      positionId: pos?.id
    };
    const tpsl = await this.tpsl.placeTpSlOrder(tpslArgs);
    return this.tpslToOrder(tpsl);
  }

  public async cancelOrder(orderId: string): Promise<Order> {
    this.assertConnected();
    if (!orderId || orderId.trim().length === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "orderId must be non-empty" });
    }
    return this.trade.cancelOrder({ symbol: this.symbol, orderId });
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    this.assertConnected();
    try {
      return await this.trade.getOrderDetail({ orderId });
    } catch (err: unknown) {
      if (err instanceof ExchangeError && err.code === "ORDER_NOT_FOUND") return null;
      throw err;
    }
  }

  public async getOpenOrders(): Promise<readonly Order[]> {
    this.assertConnected();
    return this.trade.getPendingOrders(this.symbol);
  }

  // ---------------------------------------------------------------------------
  // IExchangeAdapter — extended methods
  // ---------------------------------------------------------------------------

  public async cancelAllOrders(): Promise<{ cancelledCount: number }> {
    this.assertConnected();
    return this.trade.cancelAllOrders(this.symbol);
  }

  public async modifyOrder(args: Readonly<{
    orderId: string;
    quantity?: number;
    price?: number;
    triggerPrice?: number;
  }>): Promise<Order> {
    this.assertConnected();
    return this.trade.modifyOrder({ symbol: this.symbol, ...args });
  }

  public async getHistoryOrders(args?: PaginationArgs & Readonly<{ status?: string }>): Promise<readonly HistoryOrder[]> {
    this.assertConnected();
    return this.trade.getHistoryOrders({ symbol: this.symbol, ...args });
  }

  public async getRateLimitStatus(): Promise<RateLimitStatus> {
    this.assertConnected();
    return this.httpClient.getRateLimitStatus();
  }

  public getCircuitBreakerSnapshot(): CircuitBreakerSnapshot {
    return this.httpClient.getCircuitBreakerSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Convenience proxies — expose domain modules via well-known methods
  // ---------------------------------------------------------------------------

  // Market
  public async getDepth(symbol?: string, limit?: number): Promise<OrderBook> {
    this.assertConnected();
    return this.market.getDepth({ symbol: symbol ?? this.symbol, limit });
  }

  public async getHistoryTrades(args: Readonly<{ symbol?: string; orderId?: string; startTime?: number; endTime?: number; limit?: number }>): Promise<readonly Trade[]> {
    this.assertConnected();
    return this.trade.getHistoryTrades({ ...args, symbol: args.symbol ?? this.symbol });
  }

  public async placeBatchOrders(orders: ReadonlyArray<BatchOrderParams>): Promise<ReadonlyArray<BatchOrderResult>> {
    this.assertConnected();
    return this.trade.placeBatchOrders(orders);
  }

  public async closePosition(symbol?: string): Promise<Order> {
    this.assertConnected();
    if (this.marketType !== "futures") {
      throw new ExchangeError({ code: "UNSUPPORTED_OPERATION", message: "closePosition is only supported for futures" });
    }
    const position = await this.getPosition();
    if (position === null) {
      throw new ExchangeError({ code: "NO_POSITION", message: "No open position to close" });
    }
    return this.trade.flashClosePosition({
      symbol: symbol ?? this.symbol,
      positionId: position.id,
      quantity: position.quantity,
      side: position.side === "long" ? "sell" : "buy"
    });
  }

  // Transfers
  public async transferToSubAccount(args: Readonly<{ amount: string; coin: string; assetType: "FUTURES" | "SPOT" }>): Promise<TransferResult> {
    this.assertConnected();
    return this.asset.transferToSubAccount({ amount: args.amount, coin: args.coin, assetType: args.assetType });
  }

  public async transferToMainAccount(args: Readonly<{ amount: string; coin: string; assetType: "FUTURES" | "SPOT" }>): Promise<TransferResult> {
    this.assertConnected();
    return this.asset.transferToMainAccount({ amount: args.amount, coin: args.coin, assetType: args.assetType });
  }

  public async getPositionMode(): Promise<"ONE_WAY" | "HEDGE" | "UNKNOWN"> {
    this.assertConnected();
    if (this.marketType !== "futures") return "UNKNOWN";
    try {
      const info = await this.account.getLeverageAndMarginMode(this.symbol);
      if (info.positionMode === "hedge") return "HEDGE";
      if (info.positionMode === "one_way") return "ONE_WAY";
    } catch {
      // non-critical
    }
    return "UNKNOWN";
  }

  // ---------------------------------------------------------------------------
  // WebSocket internals
  // ---------------------------------------------------------------------------

  private async connectWebSocket(): Promise<void> {
    if (this.wsManager !== null) return;

    this.wsManager = new BitunixWebSocket({
      url: this.wsUrl,
      apiKey: this.apiKey,
      secretKey: this.secretKey
    });

    this.klineUnsubscribe = this.wsManager.onKline((event) => {
      try {
        if (!isRecord(event.data)) return;
        const candle = parseKlineEventData(event.data, event.timestampMs);
        this.recordWebSocketCandle(candle);
        this.notifySubscribers([candle]);
      } catch (err: unknown) {
        const error = err instanceof ExchangeError ? err : new ExchangeError({ code: "INTERNAL_ERROR", message: String(err) });
        this.notifySubscriberErrors(error);
      }
    });

    this.wsManager.on("error", (err) => {
      const error = err instanceof ExchangeError ? err : new ExchangeError({ code: "CONNECTION_ERROR", message: String(err) });
      this.notifySubscriberErrors(error);
    });

    await this.wsManager.connect();
  }

  private async ensureWebSocket(): Promise<void> {
    if (this.wsManager === null) await this.connectWebSocket();
  }

  private async subscribeToKlines(): Promise<void> {
    if (this.wsManager === null) return;
    const symbol = toBitunixSymbol(this.symbol);
    const channel = this.mapIntervalToWsChannel(this.interval);
    const key = `${symbol}-${channel}`;
    await this.wsManager.subscribe(key, {
      op: "subscribe",
      args: [
        { symbol, ch: channel },
        { symbol, ch: `kline_${symbol}${this.interval}` }
      ]
    });
  }

  private recordWebSocketCandle(candle: ExchangeCandle): void {
    const now = Date.now();
    this.lastWsCandle = candle;
    this.lastWsCandleAtMs = now;
    this.lastWsPriceAtMs = now;
    this.lastPrice = candle.close;

    const next = [...this.lastCandles];
    const last = next.at(-1);
    if (last !== undefined && last.timeUtcMs === candle.timeUtcMs) {
      next[next.length - 1] = candle;
    } else {
      next.push(candle);
    }
    if (next.length > this.wsCandleMaxCache) next.splice(0, next.length - this.wsCandleMaxCache);
    this.lastCandles = next;
    this.lastCandleFetchMs = now;
  }

  private getWebSocketCandleCache(limit?: number): ExchangeCandle[] | null {
    if (this.lastWsCandle === null || this.lastWsCandleAtMs === null) return null;
    if (Date.now() - this.lastWsCandleAtMs > 60_000) return null;
    const src = this.lastCandles.length === 0 ? [this.lastWsCandle] : this.lastCandles;
    return limit === undefined ? src : src.slice(-limit);
  }

  private notifySubscribers(candles: readonly ExchangeCandle[]): void {
    for (const sub of this.candleSubscribers.values()) {
      try { sub.onCandles(candles); } catch { /* swallow */ }
    }
  }

  private notifySubscriberErrors(error: ExchangeError): void {
    for (const sub of this.candleSubscribers.values()) {
      if (sub.onError === undefined) continue;
      try { sub.onError(error); } catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveQuoteCurrency(): string {
    const sym = toBitunixSymbol(this.symbol);
    if (sym.endsWith("USDT")) return "USDT";
    if (sym.endsWith("USD")) return "USD";
    return sym.slice(-4);
  }

  private tpslToOrder(tpsl: TpSlOrder): Order {
    const now = new Date().toISOString();
    return {
      id: tpsl.tpslId,
      symbol: tpsl.symbol,
      type: tpsl.triggerSide === "take_profit" ? "take_profit" : "stop_loss",
      side: tpsl.orderSide,
      status: "pending",
      quantity: tpsl.quantity,
      filledQuantity: 0,
      averageFillPrice: null,
      price: null,
      triggerPrice: tpsl.triggerPrice,
      createdAtUtc: tpsl.createdAtUtc,
      updatedAtUtc: tpsl.updatedAtUtc,
      filledAtUtc: null
    };
  }

  private mapIntervalToWsChannel(interval: YahooInterval): string {
    if (interval.endsWith("m")) return `market_kline_${interval.replace("m", "min")}`;
    if (interval === "1h") return "market_kline_60min";
    if (interval === "1d") return "market_kline_1day";
    return `market_kline_${interval}`;
  }

  private assertConnected(): void {
    if (!this.isConnectedFlag) {
      throw new ExchangeError({ code: "CONNECTION_ERROR", message: "Adapter is not connected" });
    }
  }

  private assertPositiveNumber(value: number, fieldName: string): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: `${fieldName} must be a positive finite number` });
    }
  }
}
