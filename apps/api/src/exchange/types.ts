import type { Candle } from "../data/yahooFinance.js";

/**
 * Supported exchange adapter types.
 */
export type ExchangeType = "paper" | "bitunix";

/**
 * Supported order sides for adapters.
 */
export type OrderSide = "buy" | "sell";

/**
 * Supported order types for adapters.
 */
export type OrderType = "market" | "limit" | "stop_loss" | "take_profit";

/**
 * Supported order statuses for adapters.
 */
export type OrderStatus = "pending" | "open" | "filled" | "cancelled" | "rejected";

/**
 * Supported error codes for exchange adapters.
 */
export type ExchangeErrorCode =
  | "AUTH_ERROR"
  | "CIRCUIT_OPEN"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_SYMBOL"
  | "RATE_LIMIT"
  | "CONNECTION_ERROR"
  | "NETWORK_ERROR"
  | "ORDER_NOT_FOUND"
  | "INVALID_ORDER"
  | "PERMISSION_DENIED"
  | "SERVICE_UNAVAILABLE"
  | "UNSUPPORTED"
  | "INTERNAL_ERROR";

/**
 * Exchange error data shape used for logging/transport.
 */
export type ExchangeErrorData = Readonly<{
  code: ExchangeErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}>;

/**
 * Bitunix REST error codes from the public API documentation.
 */
export type BitunixErrorCode =
  | 0
  | 403
  | 10001
  | 10002
  | 10003
  | 10004
  | 10005
  | 10006
  | 10007
  | 10008
  | 20001
  | 20002
  | 20003
  | 20004
  | 20005
  | 20006
  | 20007
  | 20008
  | 20009
  | 20010
  | 20011
  | 20012
  | 20013
  | 20014
  | 20015
  | 20016
  | 30001
  | 30002
  | 30003
  | 30004
  | 30005
  | 30006
  | 30007
  | 30008
  | 30009
  | 30010
  | 30011
  | 30012
  | 30013
  | 30014
  | 30015
  | 30016
  | 30017
  | 30018
  | 30019
  | 30020
  | 30021
  | 30022
  | 30023
  | 30024
  | 30025
  | 30026
  | 30027
  | 30028
  | 30029
  | 30030
  | 30031
  | 30032
  | 30033
  | 30034
  | 30035
  | 30036
  | 30037
  | 30038
  | 30039
  | 30040
  | 30041
  | 30042
  | 40001
  | 40002
  | 40003
  | 40004
  | 40005
  | 40006
  | 40007
  | 40008;

/**
 * Circuit breaker state tracking for exchange calls.
 */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * Circuit breaker snapshot for logging/monitoring.
 */
export type CircuitBreakerSnapshot = Readonly<{
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureAtUtc: string | null;
  openedAtUtc: string | null;
}>;

/**
 * Common balance representation for an exchange account.
 */
export type Balance = Readonly<{
  currency: string;
  available: number;
  locked: number;
  total: number;
}>;

/**
 * Common position representation for a single symbol.
 */
export type Position = Readonly<{
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  openedAtUtc: string;
  updatedAtUtc: string;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFeesPaid: number;
}>;

/**
 * Common order representation across adapters.
 */
export type Order = Readonly<{
  id: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  averageFillPrice: number | null;
  price: number | null;
  triggerPrice: number | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  filledAtUtc: string | null;
}>;

/**
 * Trade record emitted when an order fills.
 */
export type Trade = Readonly<{
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  fee: number;
  filledAtUtc: string;
}>;

/**
 * Adapter rate limit status payload.
 */
export type RateLimitStatus = Readonly<{
  limit: number;
  remaining: number;
  resetAtUtc: string | null;
  isThrottled: boolean;
}>;

/**
 * Candle data used for market data operations.
 */
export type ExchangeCandle = Candle;
