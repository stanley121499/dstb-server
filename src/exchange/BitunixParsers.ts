import { fromBitunixSymbol } from "./bitunixSymbolMapper.js";
import { ExchangeError } from "./ExchangeError.js";
import type { OrderSide, OrderStatus, OrderType, Order, Position, Balance, Trade, ExchangeCandle } from "./types.js";
import type { JsonRecord, HistoryPosition, HistoryOrder, TpSlOrder, TpSlTriggerSide, TpSlOrderStatus } from "./bitunixTypes.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Narrows an unknown to a plain object record. */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Array / field extractors
// ---------------------------------------------------------------------------

/** Retrieves the first matching value for a list of keys. */
export function extractValue(payload: unknown, keys: readonly string[]): unknown {
  if (!isRecord(payload)) return undefined;
  for (const key of keys) {
    if (Object.hasOwn(payload, key)) return payload[key];
  }
  return undefined;
}

/** Extracts a required numeric field from a payload (supports numeric strings). */
export function extractNumber(payload: unknown, keys: readonly string[], fallback?: number): number {
  const value = extractValue(payload, keys);
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Missing numeric field: ${keys.join(", ")}` });
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Invalid numeric field: ${keys.join(", ")}` });
  }
  return Number(parsed);
}

/** Extracts an optional numeric field from a payload. */
export function extractOptionalNumber(payload: unknown, keys: readonly string[]): number | null {
  const value = extractValue(payload, keys);
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed);
}

/** Extracts a required string field from a payload. */
export function extractString(payload: unknown, keys: readonly string[]): string {
  const value = extractValue(payload, keys);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Missing string field: ${keys.join(", ")}` });
  }
  return value;
}

/** Extracts an optional string field from a payload. */
export function extractOptionalString(payload: unknown, keys: readonly string[]): string | null {
  const value = extractValue(payload, keys);
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

/** Extracts a numeric value from a row array by index. */
export function extractArrayNumber(row: unknown[], index: number, fallback?: number): number {
  const value = row[index];
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Missing array value at index ${index}` });
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Invalid array value at index ${index}` });
  }
  return Number(parsed);
}

/** Extracts a timestamp and converts to ISO-8601 string. */
export function extractTimestampIso(payload: unknown, keys: readonly string[], fallback?: string): string {
  const value = extractValue(payload, keys);
  if (value === undefined || value === null) return fallback ?? new Date().toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback ?? new Date().toISOString();
}

/** Extracts an optional timestamp and converts to ISO or null. */
export function extractOptionalTimestampIso(payload: unknown, keys: readonly string[]): string | null {
  const value = extractValue(payload, keys);
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

/** Extracts an array from common Bitunix payload shapes. */
export function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    const data = payload.data ?? payload.list ?? payload.rows ?? payload.items;
    if (Array.isArray(data)) return data;
    if (data === null || data === undefined) return [];
  }
  throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Expected array payload from Bitunix" });
}

// ---------------------------------------------------------------------------
// Domain parsers
// ---------------------------------------------------------------------------

/** Maps a Bitunix order type string to an internal OrderType. */
export function mapOrderType(value: string): OrderType {
  const normalized = value.toUpperCase();
  if (normalized === "LIMIT") return "limit";
  if (normalized === "STOP_LOSS") return "stop_loss";
  if (normalized === "TAKE_PROFIT") return "take_profit";
  return "market";
}

/** Maps a Bitunix order status string to an internal OrderStatus. */
export function mapOrderStatus(value: string): OrderStatus {
  const normalized = value.toUpperCase();
  if (normalized === "NEW" || normalized === "OPEN") return "open";
  if (
    normalized === "PARTIALLY_FILLED" ||
    normalized === "PART_FILLED" ||
    normalized === "PENDING" ||
    normalized === "INIT"
  )
    return "pending";
  if (normalized === "FILLED") return "filled";
  if (normalized === "CANCELED" || normalized === "CANCELLED") return "cancelled";
  if (normalized === "REJECTED") return "rejected";
  return "open";
}

/** Parses a Bitunix order payload into the common Order model. */
export function parseOrder(payload: unknown): Order {
  if (!isRecord(payload)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid order payload" });
  }
  const id = extractString(payload, ["orderId", "id", "order_id"]);
  const symbol = extractString(payload, ["symbol"]);
  const sideRaw = extractString(payload, ["side"]);
  const side: OrderSide = sideRaw.toUpperCase() === "SELL" ? "sell" : "buy";
  const typeRaw = extractString(payload, ["type", "orderType"]);
  const type = mapOrderType(typeRaw);
  const status = mapOrderStatus(extractString(payload, ["status"]));
  const quantity = extractNumber(payload, ["origQty", "quantity", "qty"]);
  const filledQuantity =
    extractOptionalNumber(payload, ["executedQty", "filledQty", "filledQuantity", "tradeQty", "tradeQuantity"]) ?? 0;
  const avgFillPrice = extractOptionalNumber(payload, ["avgPrice", "averageFillPrice", "avgFillPrice"]);
  const price = extractOptionalNumber(payload, ["price"]);
  const triggerPrice = extractOptionalNumber(payload, ["stopPrice", "triggerPrice"]);
  const now = new Date().toISOString();
  const createdAtUtc = extractTimestampIso(payload, ["time", "createdAt", "createTime"], now);
  const updatedAtUtc = extractTimestampIso(payload, ["updateTime", "updatedAt"], createdAtUtc);
  const filledAtUtc = extractOptionalTimestampIso(payload, ["filledTime", "filledAt"]);

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

/** Parses a Bitunix position row into the common Position model. */
export function parsePositionRow(
  payload: unknown,
  currentPrice: number,
  symbol: string
): Position {
  if (!isRecord(payload)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid position payload" });
  }

  const positionId = extractOptionalString(payload, ["positionId", "id"]);
  if (positionId === null) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Position record missing id" });
  }

  const sideRaw = extractString(payload, ["side", "positionSide"]);
  const side: Position["side"] = sideRaw.toUpperCase() === "SELL" || sideRaw.toUpperCase() === "SHORT" ? "short" : "long";
  const entryPrice = extractNumber(payload, ["entryPrice", "avgPrice", "openPrice"]);
  const quantity = extractNumber(payload, ["available", "qty", "quantity", "size", "positionAmt"]);
  const realizedPnl = extractOptionalNumber(payload, ["realizedPnl", "realisedPnl", "profit"]) ?? 0;
  const totalFeesPaid = extractOptionalNumber(payload, ["fee", "totalFee", "tradeFee"]) ?? 0;
  const openedAtUtc = extractTimestampIso(payload, ["openTime", "createTime", "ctime"], new Date().toISOString());
  const updatedAtUtc = extractTimestampIso(payload, ["updateTime", "mtime"], openedAtUtc);

  const unrealizedPnl = computeUnrealizedPnl(side, entryPrice, currentPrice, quantity);

  return {
    id: positionId,
    symbol,
    side,
    entryPrice,
    currentPrice,
    quantity,
    openedAtUtc,
    updatedAtUtc,
    unrealizedPnl,
    realizedPnl,
    totalFeesPaid
  };
}

/** Parses a history position record. */
export function parseHistoryPosition(payload: unknown): HistoryPosition {
  if (!isRecord(payload)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid history position payload" });
  }
  const id = extractString(payload, ["positionId", "id"]);
  const symbol = extractString(payload, ["symbol"]);
  const sideRaw = extractString(payload, ["side", "positionSide"]);
  const side: HistoryPosition["side"] =
    sideRaw.toUpperCase() === "SELL" || sideRaw.toUpperCase() === "SHORT" ? "short" : "long";
  const entryPrice = extractNumber(payload, ["entryPrice", "avgOpenPrice", "openPrice"]);
  const closePrice = extractNumber(payload, ["closePrice", "avgClosePrice", "exitPrice"]);
  const quantity = extractNumber(payload, ["qty", "quantity", "size"]);
  const realizedPnl = extractOptionalNumber(payload, ["realizedPnl", "profitLoss", "profit"]) ?? 0;
  const totalFeesPaid = extractOptionalNumber(payload, ["fee", "totalFee"]) ?? 0;
  const openedAtUtc = extractTimestampIso(payload, ["openTime", "createTime"], new Date().toISOString());
  const closedAtUtc = extractTimestampIso(payload, ["closeTime", "updateTime"], new Date().toISOString());

  return { id, symbol: fromBitunixSymbol(symbol), side, entryPrice, closePrice, quantity, realizedPnl, totalFeesPaid, openedAtUtc, closedAtUtc };
}

/** Parses a history order record. */
export function parseHistoryOrder(payload: unknown): HistoryOrder {
  if (!isRecord(payload)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid history order payload" });
  }
  const orderId = extractString(payload, ["orderId", "id"]);
  const clientId = extractOptionalString(payload, ["clientId", "clientOrderId"]) ?? "";
  const symbol = extractString(payload, ["symbol"]);
  const sideRaw = extractString(payload, ["side"]);
  const side: OrderSide = sideRaw.toUpperCase() === "SELL" ? "sell" : "buy";
  const type = extractOptionalString(payload, ["type", "orderType"]) ?? "MARKET";
  const status = extractString(payload, ["status"]);
  const quantity = extractNumber(payload, ["origQty", "qty", "quantity"]);
  const filledQuantity = extractOptionalNumber(payload, ["executedQty", "filledQty", "tradeQty"]) ?? 0;
  const avgFillPrice = extractOptionalNumber(payload, ["avgPrice", "avgFillPrice"]);
  const price = extractOptionalNumber(payload, ["price"]);
  const triggerPrice = extractOptionalNumber(payload, ["stopPrice", "triggerPrice"]);
  const now = new Date().toISOString();
  const createdAtUtc = extractTimestampIso(payload, ["time", "createTime"], now);
  const updatedAtUtc = extractTimestampIso(payload, ["updateTime"], createdAtUtc);
  const filledAtUtc = extractOptionalTimestampIso(payload, ["filledTime", "filledAt"]);
  const fee = extractOptionalNumber(payload, ["fee", "tradeFee"]) ?? 0;

  return {
    orderId,
    clientId,
    symbol: fromBitunixSymbol(symbol),
    side,
    type,
    status,
    quantity,
    filledQuantity,
    averageFillPrice: avgFillPrice ?? null,
    price: price ?? null,
    triggerPrice: triggerPrice ?? null,
    createdAtUtc,
    updatedAtUtc,
    filledAtUtc,
    fee
  };
}

/** Parses a TP/SL order record. */
export function parseTpSlOrder(payload: unknown): TpSlOrder {
  if (!isRecord(payload)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid TP/SL order payload" });
  }
  const tpslId = extractString(payload, ["tpslId", "id"]);
  const symbol = extractString(payload, ["symbol"]);
  const positionId = extractOptionalString(payload, ["positionId"]) ?? undefined;

  const triggerSideRaw = extractString(payload, ["tpslType", "triggerSide", "type"]);
  const triggerSideUpper = triggerSideRaw.toUpperCase();
  const triggerSide: TpSlTriggerSide =
    triggerSideUpper === "TAKE_PROFIT" || triggerSideUpper === "TP" ? "take_profit" : "stop_loss";

  const statusRaw = extractString(payload, ["status"]);
  const statusUpper = statusRaw.toUpperCase();
  let status: TpSlOrderStatus = "pending";
  if (statusUpper === "TRIGGERED" || statusUpper === "FILLED") status = "triggered";
  else if (statusUpper === "CANCELED" || statusUpper === "CANCELLED") status = "cancelled";
  else if (statusUpper === "EXPIRED") status = "expired";

  const triggerPrice = extractNumber(payload, ["triggerPrice", "stopPrice", "price"]);
  const quantity = extractNumber(payload, ["qty", "quantity", "size"]);
  const sideRaw = extractString(payload, ["side", "orderSide"]);
  const orderSide: OrderSide = sideRaw.toUpperCase() === "SELL" ? "sell" : "buy";
  const now = new Date().toISOString();
  const createdAtUtc = extractTimestampIso(payload, ["createTime", "ctime"], now);
  const updatedAtUtc = extractTimestampIso(payload, ["updateTime", "mtime"], createdAtUtc);

  return { tpslId, symbol: fromBitunixSymbol(symbol), positionId, triggerSide, status, triggerPrice, quantity, orderSide, createdAtUtc, updatedAtUtc };
}

/** Parses a trade (fill) record. */
export function parseTrade(payload: unknown): Trade {
  if (!isRecord(payload)) {
    throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid trade payload" });
  }
  const id = extractString(payload, ["tradeId", "id", "fillId"]);
  const orderId = extractString(payload, ["orderId", "order_id"]);
  const symbol = extractString(payload, ["symbol"]);
  const sideRaw = extractString(payload, ["side"]);
  const side: OrderSide = sideRaw.toUpperCase() === "SELL" ? "sell" : "buy";
  const quantity = extractNumber(payload, ["qty", "quantity", "amount"]);
  const price = extractNumber(payload, ["price", "tradePrice"]);
  const fee = extractOptionalNumber(payload, ["fee", "commission", "tradeFee"]) ?? 0;
  const filledAtUtc = extractTimestampIso(payload, ["ctime", "time", "tradedAt"], new Date().toISOString());

  return { id, orderId, symbol: fromBitunixSymbol(symbol), side, quantity, price, fee, filledAtUtc };
}

// ---------------------------------------------------------------------------
// Candle parsers
// ---------------------------------------------------------------------------

/** Parses an array of candle rows into ExchangeCandle objects, sorted chronologically. */
export function parseCandles(payload: unknown): ExchangeCandle[] {
  const rows = extractArray(payload);
  const candles: ExchangeCandle[] = rows.map((row) => parseCandleRow(row));
  candles.sort((a, b) => a.timeUtcMs - b.timeUtcMs);
  return candles;
}

/** Normalizes a single candle row (array or object format). */
export function parseCandleRow(row: unknown): ExchangeCandle {
  if (Array.isArray(row)) return parseCandleArray(row);
  if (isRecord(row)) return parseCandleObject(row);
  throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid candle row format" });
}

function parseCandleArray(row: unknown[]): ExchangeCandle {
  return {
    timeUtcMs: extractArrayNumber(row, 0),
    open: extractArrayNumber(row, 1),
    high: extractArrayNumber(row, 2),
    low: extractArrayNumber(row, 3),
    close: extractArrayNumber(row, 4),
    volume: extractArrayNumber(row, 5, 0)
  };
}

function parseCandleObject(row: JsonRecord): ExchangeCandle {
  return {
    timeUtcMs: extractNumber(row, ["time", "timeUtcMs", "openTime", "ts", "timestamp"]),
    open: extractNumber(row, ["open", "o"]),
    high: extractNumber(row, ["high", "h"]),
    low: extractNumber(row, ["low", "l"]),
    close: extractNumber(row, ["close", "c"]),
    volume: extractNumber(row, ["volume", "v", "b"], 0)
  };
}

/** Parses a WebSocket kline event data object into an ExchangeCandle. */
export function parseKlineEventData(data: JsonRecord, timestampMs: number): ExchangeCandle {
  return {
    timeUtcMs: timestampMs,
    open: extractNumber(data, ["o", "open"]),
    high: extractNumber(data, ["h", "high"]),
    low: extractNumber(data, ["l", "low"]),
    close: extractNumber(data, ["c", "close"]),
    volume: extractNumber(data, ["b", "v", "volume"], 0)
  };
}

// ---------------------------------------------------------------------------
// Balance parsing
// ---------------------------------------------------------------------------

/** Parsed balance used internally before mapping to the public Balance type. */
export type ParsedBalance = Readonly<{
  currency: string;
  available: number;
  locked: number;
  total: number;
}>;

/** Parses a Bitunix balance response into a ParsedBalance snapshot. */
export function parseBalance(payload: unknown, quoteCurrency: string): ParsedBalance {
  if (Array.isArray(payload)) {
    const entry = pickBalanceEntry(payload, quoteCurrency);
    return parseBalanceEntry(entry, quoteCurrency);
  }
  if (isRecord(payload)) {
    const data = payload.data ?? payload;
    if (isRecord(data)) {
      const balances = data.balances ?? data.assets ?? data.list;
      const list = Array.isArray(balances) ? balances : [];
      if (list.length > 0) {
        const entry = pickBalanceEntry(list, quoteCurrency);
        return parseBalanceEntry(entry, quoteCurrency);
      }
      if (data.available !== undefined || data.total !== undefined) {
        const available = extractNumber(data, ["available", "availableBalance", "free"], 0);
        const total = extractNumber(data, ["total", "equity", "balance"], available);
        const locked = Math.max(0, total - available);
        return { currency: quoteCurrency, available, locked, total };
      }
    }
  }
  throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Unable to parse Bitunix balance response" });
}

function pickBalanceEntry(entries: readonly unknown[], quoteCurrency: string): JsonRecord {
  const upperQuote = quoteCurrency.toUpperCase();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const asset = extractOptionalString(entry, ["asset", "currency", "coin"]);
    if (asset !== null && asset.toUpperCase() === upperQuote) return entry;
  }
  const first = entries[0];
  if (!isRecord(first)) throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Balance entry missing" });
  return first;
}

function parseBalanceEntry(entry: JsonRecord, currency: string): ParsedBalance {
  const available = extractNumber(entry, ["free", "available", "availableBalance"], 0);
  const locked = extractNumber(entry, ["locked", "frozen"], 0);
  // Bitunix futures account uses "walletBalance" for total wallet balance
  // (available + in-use margin). Fall back to available+locked if neither present.
  const total = extractNumber(entry, ["walletBalance", "currencyEquity", "total", "balance"], available + locked);
  return { currency, available, locked, total };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Computes unrealized PnL given position side and prices. */
export function computeUnrealizedPnl(
  side: Position["side"],
  entry: number,
  current: number,
  qty: number
): number {
  return side === "long" ? (current - entry) * qty : (entry - current) * qty;
}
