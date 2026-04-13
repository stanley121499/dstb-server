import type { ExchangeError } from "./ExchangeError.js";
import type {
  Balance,
  ExchangeCandle,
  FetchTradeExitCandlesArgs,
  Order,
  OrderSide,
  Position,
  RateLimitStatus,
  TradeExitCandleBundle
} from "./types.js";

/**
 * Exchange adapter interface implemented by all exchange integrations.
 */
export interface IExchangeAdapter {
  /**
   * Establishes a connection and starts any required background polling.
   */
  connect(): Promise<void>;

  /**
   * Tears down the connection and stops background polling.
   */
  disconnect(): Promise<void>;

  /**
   * Indicates whether the adapter is currently connected.
   */
  isConnected(): Promise<boolean>;

  /**
   * Fetches the latest candles for the configured symbol/interval.
   */
  getLatestCandles(args?: Readonly<{ limit?: number }>): Promise<readonly ExchangeCandle[]>;

  /**
   * Subscribes to candle updates. Returns an unsubscribe function.
   */
  subscribeToCandles(args: Readonly<{
    onCandles: (candles: readonly ExchangeCandle[]) => void;
    onError?: (error: ExchangeError) => void;
  }>): Promise<() => void>;

  /**
   * Returns the most recent price for the configured symbol.
   */
  getLastPrice(): Promise<number>;

  /**
   * Retrieves the current account balance snapshot.
   */
  getBalance(): Promise<Balance>;

  /**
   * Retrieves the current open position, if any, for the configured symbol.
   */
  getPosition(): Promise<Position | null>;

  /**
   * Places a market order and returns the order record.
   */
  placeMarketOrder(args: Readonly<{ side: OrderSide; quantity: number }>): Promise<Order>;

  /**
   * Places a limit order and returns the order record.
   */
  placeLimitOrder(args: Readonly<{ side: OrderSide; quantity: number; price: number }>): Promise<Order>;

  /**
   * Places a stop loss order and returns the order record.
   */
  placeStopLossOrder(args: Readonly<{ side: OrderSide; quantity: number; stopPrice: number }>): Promise<Order>;

  /**
   * Places a take profit order and returns the order record.
   */
  placeTakeProfitOrder(args: Readonly<{ side: OrderSide; quantity: number; takeProfitPrice: number }>): Promise<Order>;

  /**
   * Cancels an order by id and returns the updated record.
   */
  cancelOrder(orderId: string): Promise<Order>;

  /**
   * Retrieves an order by id.
   */
  getOrder(orderId: string): Promise<Order | null>;

  /**
   * Lists currently open/pending orders.
   */
  getOpenOrders(): Promise<readonly Order[]>;

  /**
   * Retrieves the adapter's current rate limit status.
   */
  getRateLimitStatus(): Promise<RateLimitStatus>;

  /**
   * When implemented, fetches multi-timeframe klines around a trade window for `trade_candles` persistence.
   */
  fetchTradeCandleBundlesForRange?(
    args: Readonly<FetchTradeExitCandlesArgs>
  ): Promise<readonly TradeExitCandleBundle[]>;
}
