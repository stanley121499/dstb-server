/**
 * Runtime schema validators for Bitunix API responses.
 *
 * These are lightweight type-guards that validate the shape of each API
 * response at the boundary. When Bitunix changes a field name or type this
 * module will throw a descriptive SchemaError instead of silently returning
 * wrong data downstream.
 *
 * Usage:
 *   const depth = validateDepthResponse(raw);   // throws SchemaError on mismatch
 */

// ---------------------------------------------------------------------------
// SchemaError
// ---------------------------------------------------------------------------

/**
 * Thrown when a Bitunix API response does not match the expected schema.
 * Callers should treat this like INTERNAL_ERROR: the adapter needs updating.
 */
export class SchemaError extends Error {
  public readonly path: string;
  public readonly received: unknown;

  public constructor(args: { path: string; message: string; received?: unknown }) {
    super(`[BitunixSchema] ${args.path}: ${args.message}`);
    this.name = "SchemaError";
    this.path = args.path;
    this.received = args.received;
  }
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new SchemaError({ path, message: `expected string, got ${typeof value}`, received: value });
  }
}

/**
 * Strict numeric check: rejects string representation of numbers.
 * Use for fields like errorCode that should always be a JS number.
 */
function assertStrictNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SchemaError({ path, message: `expected number, got ${typeof value}`, received: value });
  }
}

/**
 * Lenient numeric check: also accepts string-encoded numbers (e.g. "30000.5").
 * Use for price/quantity fields that Bitunix returns as strings.
 */
function assertNumericValue(value: unknown, path: string): void {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new SchemaError({ path, message: `expected finite number or numeric string, got ${typeof value}`, received: value });
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new SchemaError({ path, message: `expected array, got ${typeof value}`, received: value });
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SchemaError({ path, message: `expected object, got ${typeof value}`, received: value });
  }
}

// ---------------------------------------------------------------------------
// Bitunix API response schemas
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/futures/market/depth
 */
export type DepthResponse = Readonly<{
  asks: ReadonlyArray<readonly [string, string]>;
  bids: ReadonlyArray<readonly [string, string]>;
}>;

export function validateDepthResponse(raw: unknown): DepthResponse {
  assertObject(raw, "depth");
  assertArray(raw["asks"], "depth.asks");
  assertArray(raw["bids"], "depth.bids");

  for (const [i, ask] of (raw["asks"] as unknown[]).entries()) {
    assertArray(ask, `depth.asks[${i}]`);
    assertString((ask as unknown[])[0], `depth.asks[${i}][0]`);
    assertString((ask as unknown[])[1], `depth.asks[${i}][1]`);
  }
  for (const [i, bid] of (raw["bids"] as unknown[]).entries()) {
    assertArray(bid, `depth.bids[${i}]`);
    assertString((bid as unknown[])[0], `depth.bids[${i}][0]`);
    assertString((bid as unknown[])[1], `depth.bids[${i}][1]`);
  }

  return raw as DepthResponse;
}

// ---------------------------------------------------------------------------

/**
 * Single trade record from GET /api/v1/futures/trade/get_history_trades
 */
export type TradeRecord = Readonly<{
  tradeId: string;
  orderId: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  fee: string;
  ctime: number;
}>;

export function validateTradeRecord(raw: unknown, path = "trade"): TradeRecord {
  assertObject(raw, path);
  assertString(raw["tradeId"], `${path}.tradeId`);
  assertString(raw["orderId"], `${path}.orderId`);
  assertString(raw["symbol"], `${path}.symbol`);
  assertString(raw["side"], `${path}.side`);
  assertString(raw["qty"], `${path}.qty`);
  assertString(raw["price"], `${path}.price`);
  assertString(raw["fee"], `${path}.fee`);
  assertStrictNumber(raw["ctime"], `${path}.ctime`);
  return raw as TradeRecord;
}

// ---------------------------------------------------------------------------

/**
 * Batch order success entry from POST /api/v1/futures/trade/batch_order
 */
export type BatchSuccessEntry = Readonly<{ orderId: string; clientId: string }>;

/**
 * Batch order failure entry from POST /api/v1/futures/trade/batch_order
 */
export type BatchFailureEntry = Readonly<{ clientId: string; errorMsg: string; errorCode: number }>;

export type BatchOrderResponse = Readonly<{
  successList: ReadonlyArray<BatchSuccessEntry>;
  failureList: ReadonlyArray<BatchFailureEntry>;
}>;

export function validateBatchOrderResponse(raw: unknown): BatchOrderResponse {
  assertObject(raw, "batchOrder");
  assertArray(raw["successList"], "batchOrder.successList");
  assertArray(raw["failureList"], "batchOrder.failureList");

  for (const [i, entry] of (raw["successList"] as unknown[]).entries()) {
    assertObject(entry, `batchOrder.successList[${i}]`);
    assertString((entry as Record<string, unknown>)["orderId"], `batchOrder.successList[${i}].orderId`);
    assertString((entry as Record<string, unknown>)["clientId"], `batchOrder.successList[${i}].clientId`);
  }
  for (const [i, entry] of (raw["failureList"] as unknown[]).entries()) {
    assertObject(entry, `batchOrder.failureList[${i}]`);
    assertString((entry as Record<string, unknown>)["clientId"], `batchOrder.failureList[${i}].clientId`);
    assertString((entry as Record<string, unknown>)["errorMsg"], `batchOrder.failureList[${i}].errorMsg`);
    assertStrictNumber((entry as Record<string, unknown>)["errorCode"], `batchOrder.failureList[${i}].errorCode`);
  }

  return raw as BatchOrderResponse;
}

// ---------------------------------------------------------------------------

/**
 * Account balance record from GET /api/v1/futures/account
 */
export type BalanceRecord = Readonly<{
  available: string;
  balance: string;
}>;

export function validateBalanceRecord(raw: unknown, path = "balance"): BalanceRecord {
  assertObject(raw, path);
  // Accept either string or numeric forms from the API.
  if (raw["available"] === undefined) {
    throw new SchemaError({ path: `${path}.available`, message: "field missing", received: undefined });
  }
  if (raw["balance"] === undefined && raw["total"] === undefined && raw["equity"] === undefined) {
    throw new SchemaError({ path: `${path}.balance/total/equity`, message: "no balance field found", received: raw });
  }
  return raw as BalanceRecord;
}

// ---------------------------------------------------------------------------

/**
 * Position record from GET /api/v1/futures/position/get_pending_positions
 */
export type PositionRecord = Readonly<{
  positionId: string;
  symbol: string;
  side: string;
  avgOpenPrice: string;
  qty: string;
}>;

export function validatePositionRecord(raw: unknown, path = "position"): PositionRecord {
  assertObject(raw, path);
  // Accept positionId or id.
  if (raw["positionId"] === undefined && raw["id"] === undefined) {
    throw new SchemaError({ path: `${path}.positionId`, message: "field missing", received: undefined });
  }
  assertString(raw["symbol"], `${path}.symbol`);
  assertString(raw["side"], `${path}.side`);
  // Accept avgOpenPrice or entryPrice.
  if (raw["avgOpenPrice"] === undefined && raw["entryPrice"] === undefined && raw["avg_price"] === undefined) {
    throw new SchemaError({ path: `${path}.avgOpenPrice`, message: "no price field found", received: raw });
  }
  // Accept qty or positionQty or size.
  if (raw["qty"] === undefined && raw["positionQty"] === undefined && raw["size"] === undefined) {
    throw new SchemaError({ path: `${path}.qty`, message: "no quantity field found", received: raw });
  }
  return raw as PositionRecord;
}

// ---------------------------------------------------------------------------

/**
 * Order record from GET /api/v1/futures/trade/get_order_detail
 */
export type OrderRecord = Readonly<{
  orderId: string;
  symbol: string;
  side: string;
  status: string;
  qty: string;
}>;

export function validateOrderRecord(raw: unknown, path = "order"): OrderRecord {
  assertObject(raw, path);
  if (raw["orderId"] === undefined && raw["id"] === undefined && raw["order_id"] === undefined) {
    throw new SchemaError({ path: `${path}.orderId`, message: "no id field found", received: raw });
  }
  assertString(raw["symbol"], `${path}.symbol`);
  assertString(raw["side"], `${path}.side`);
  assertString(raw["status"], `${path}.status`);
  if (raw["qty"] === undefined && raw["quantity"] === undefined && raw["origQty"] === undefined) {
    throw new SchemaError({ path: `${path}.qty`, message: "no quantity field found", received: raw });
  }
  return raw as OrderRecord;
}

// ---------------------------------------------------------------------------

/**
 * Single OHLCV kline row from GET /api/v1/futures/market/kline.
 * Bitunix returns each row as an array: [time, open, high, low, close, volume]
 */
export type KlineRow = readonly [number, string, string, string, string, string];

export function validateKlineRow(raw: unknown, index = 0): KlineRow {
  const path = `kline[${index}]`;
  assertArray(raw, path);
  if ((raw as unknown[]).length < 6) {
    throw new SchemaError({ path, message: `expected at least 6 elements, got ${(raw as unknown[]).length}`, received: raw });
  }
  assertStrictNumber((raw as unknown[])[0], `${path}[0] (time)`);
  assertNumericValue((raw as unknown[])[1], `${path}[1] (open)`);
  assertNumericValue((raw as unknown[])[2], `${path}[2] (high)`);
  assertNumericValue((raw as unknown[])[3], `${path}[3] (low)`);
  assertNumericValue((raw as unknown[])[4], `${path}[4] (close)`);
  assertNumericValue((raw as unknown[])[5], `${path}[5] (volume)`);
  return raw as unknown as KlineRow;
}

// ---------------------------------------------------------------------------

/**
 * Ticker record from GET /api/v1/futures/market/tickers
 */
export type TickerRecord = Readonly<{
  symbol: string;
  lastPrice: string;
}>;

export function validateTickerRecord(raw: unknown, path = "ticker"): TickerRecord {
  assertObject(raw, path);
  assertString(raw["symbol"], `${path}.symbol`);
  // Accept lastPrice, last, or price
  if (raw["lastPrice"] === undefined && raw["last"] === undefined && raw["price"] === undefined) {
    throw new SchemaError({ path: `${path}.lastPrice`, message: "no price field found", received: raw });
  }
  const priceField = raw["lastPrice"] ?? raw["last"] ?? raw["price"];
  assertNumericValue(priceField, `${path}.lastPrice`);
  return raw as TickerRecord;
}

// ---------------------------------------------------------------------------

/**
 * Funding rate record from GET /api/v1/futures/market/funding_rate
 */
export type FundingRateRecord = Readonly<{
  symbol: string;
  fundingRate: string;
  nextFundingTime: number;
  markPrice: string;
}>;

export function validateFundingRateRecord(raw: unknown, path = "fundingRate"): FundingRateRecord {
  assertObject(raw, path);
  assertString(raw["symbol"], `${path}.symbol`);
  assertNumericValue(raw["fundingRate"], `${path}.fundingRate`);
  if (raw["nextFundingTime"] !== undefined) {
    assertStrictNumber(raw["nextFundingTime"], `${path}.nextFundingTime`);
  }
  if (raw["markPrice"] !== undefined) {
    assertNumericValue(raw["markPrice"], `${path}.markPrice`);
  }
  return raw as FundingRateRecord;
}

// ---------------------------------------------------------------------------

/**
 * Leverage and margin mode record from
 * GET /api/v1/futures/account/get_leverage_margin_mode
 */
export type LeverageModeRecord = Readonly<{
  symbol: string;
  marginMode: string;
}>;

export function validateLeverageModeRecord(raw: unknown, path = "leverageMode"): LeverageModeRecord {
  assertObject(raw, path);
  // Accept either symbol or infer it from caller context
  if (raw["symbol"] !== undefined) {
    assertString(raw["symbol"], `${path}.symbol`);
  }
  // Accept longLeverage, shortLeverage, or leverage
  if (raw["longLeverage"] === undefined && raw["shortLeverage"] === undefined && raw["leverage"] === undefined) {
    throw new SchemaError({ path: `${path}.leverage`, message: "no leverage field found", received: raw });
  }
  const leverageField = raw["longLeverage"] ?? raw["shortLeverage"] ?? raw["leverage"];
  assertStrictNumber(leverageField, `${path}.leverage`);
  assertString(raw["marginMode"], `${path}.marginMode`);
  return raw as LeverageModeRecord;
}

// ---------------------------------------------------------------------------

/**
 * TP/SL order record from GET /api/v1/futures/tpsl/get_pending_orders
 */
export type TpSlOrderRecord = Readonly<{
  tpslId: string;
  symbol: string;
  side: string;
  tpslType: string;
  status: string;
  triggerPrice: string;
}>;

export function validateTpSlOrderRecord(raw: unknown, path = "tpslOrder"): TpSlOrderRecord {
  assertObject(raw, path);
  assertString(raw["tpslId"], `${path}.tpslId`);
  assertString(raw["symbol"], `${path}.symbol`);
  assertString(raw["side"], `${path}.side`);
  assertString(raw["tpslType"], `${path}.tpslType`);
  if (raw["tpslType"] !== "TAKE_PROFIT" && raw["tpslType"] !== "STOP_LOSS") {
    throw new SchemaError({
      path: `${path}.tpslType`,
      message: `expected TAKE_PROFIT or STOP_LOSS, got ${String(raw["tpslType"])}`,
      received: raw["tpslType"]
    });
  }
  assertString(raw["status"], `${path}.status`);
  assertNumericValue(raw["triggerPrice"], `${path}.triggerPrice`);
  return raw as TpSlOrderRecord;
}

// ---------------------------------------------------------------------------

/**
 * History order record from GET /api/v1/futures/trade/get_history_orders
 */
export type HistoryOrderRecord = Readonly<{
  orderId: string;
  symbol: string;
  side: string;
  status: string;
  origQty: string;
  executedQty: string;
}>;

export function validateHistoryOrderRecord(raw: unknown, path = "historyOrder"): HistoryOrderRecord {
  assertObject(raw, path);
  if (raw["orderId"] === undefined && raw["id"] === undefined) {
    throw new SchemaError({ path: `${path}.orderId`, message: "no id field found", received: undefined });
  }
  assertString(raw["symbol"], `${path}.symbol`);
  assertString(raw["side"], `${path}.side`);
  if (raw["status"] !== undefined) {
    assertString(raw["status"], `${path}.status`);
  }
  if (raw["origQty"] === undefined && raw["qty"] === undefined && raw["quantity"] === undefined) {
    throw new SchemaError({ path: `${path}.origQty`, message: "no quantity field found", received: raw });
  }
  return raw as HistoryOrderRecord;
}

// ---------------------------------------------------------------------------

/**
 * History position record from GET /api/v1/futures/position/get_history_positions
 */
export type HistoryPositionRecord = Readonly<{
  positionId: string;
  symbol: string;
  side: string;
  entryPrice: string;
  closePrice: string;
}>;

export function validateHistoryPositionRecord(raw: unknown, path = "historyPosition"): HistoryPositionRecord {
  assertObject(raw, path);
  if (raw["positionId"] === undefined && raw["id"] === undefined) {
    throw new SchemaError({ path: `${path}.positionId`, message: "no id field found", received: undefined });
  }
  assertString(raw["symbol"], `${path}.symbol`);
  assertString(raw["side"], `${path}.side`);
  // Accept entryPrice or avgOpenPrice
  if (raw["entryPrice"] === undefined && raw["avgOpenPrice"] === undefined) {
    throw new SchemaError({ path: `${path}.entryPrice`, message: "no entry price field found", received: raw });
  }
  // closePrice may not be present for still-open positions
  if (raw["closePrice"] !== undefined) {
    assertNumericValue(raw["closePrice"], `${path}.closePrice`);
  }
  return raw as HistoryPositionRecord;
}
