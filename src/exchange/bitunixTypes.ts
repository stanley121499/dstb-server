import type { OrderSide } from "./types.js";

// ---------------------------------------------------------------------------
// Shared transport types
// ---------------------------------------------------------------------------

export type RequestMethod = "GET" | "POST" | "DELETE" | "PUT";

export type RequestArgs = Readonly<{
  method: RequestMethod;
  path: string;
  query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  body?: Readonly<Record<string, unknown>>;
  isPrivate?: boolean;
  restBaseOverride?: string;
}>;

export type JsonRecord = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Market types
// ---------------------------------------------------------------------------

/** Aggregated order book snapshot */
export type OrderBook = Readonly<{
  bids: ReadonlyArray<readonly [number, number]>;
  asks: ReadonlyArray<readonly [number, number]>;
  timestampUtc: string;
}>;

/** Single funding rate entry */
export type FundingRate = Readonly<{
  symbol: string;
  fundingRate: number;
  nextFundingTimeUtc: string;
  markPrice: number;
}>;

/** A tradable futures pair */
export type TradingPair = Readonly<{
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  pricePrecision: number;
  quantityPrecision: number;
  minOrderQty: number;
  maxOrderQty: number;
  maxLeverage: number;
  isActive: boolean;
}>;

// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

/** Leverage and margin mode snapshot for a symbol */
export type LeverageInfo = Readonly<{
  symbol: string;
  leverage: number;
  marginMode: "isolated" | "cross";
  positionMode: "one_way" | "hedge";
}>;

/** Position mode change request */
export type PositionMode = "one_way" | "hedge";

/** Margin mode for an account or symbol */
export type MarginMode = "isolated" | "cross";

// ---------------------------------------------------------------------------
// Position types
// ---------------------------------------------------------------------------

/** Historical closed position record */
export type HistoryPosition = Readonly<{
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  closePrice: number;
  quantity: number;
  realizedPnl: number;
  totalFeesPaid: number;
  openedAtUtc: string;
  closedAtUtc: string;
}>;

/** Position tier / margin bracket */
export type PositionTier = Readonly<{
  tier: number;
  symbol: string;
  minNotional: number;
  maxNotional: number;
  maxLeverage: number;
  maintenanceMarginRate: number;
}>;

// ---------------------------------------------------------------------------
// Trade types
// ---------------------------------------------------------------------------

/** Batch order request item */
export type BatchOrderParams = Readonly<{
  symbol: string;
  side: OrderSide;
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  reduceOnly?: boolean;
}>;

/** Batch order placement result */
export type BatchOrderResult = Readonly<{
  symbol: string;
  successList: ReadonlyArray<Readonly<{ orderId: string; clientId: string }>>;
  failureList: ReadonlyArray<Readonly<{ clientId: string; errorMsg: string; errorCode: number }>>;
}>;

/** Historical order record (differs slightly from pending order) */
export type HistoryOrder = Readonly<{
  orderId: string;
  clientId: string;
  symbol: string;
  side: OrderSide;
  type: string;
  status: string;
  quantity: number;
  filledQuantity: number;
  averageFillPrice: number | null;
  price: number | null;
  triggerPrice: number | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  filledAtUtc: string | null;
  fee: number;
}>;

// ---------------------------------------------------------------------------
// TP/SL types
// ---------------------------------------------------------------------------

/** Side of a TP/SL trigger */
export type TpSlTriggerSide = "take_profit" | "stop_loss";

/** Status of a TP/SL order */
export type TpSlOrderStatus = "pending" | "triggered" | "cancelled" | "expired";

/** A TP/SL order record returned by the API */
export type TpSlOrder = Readonly<{
  tpslId: string;
  symbol: string;
  positionId?: string;
  triggerSide: TpSlTriggerSide;
  status: TpSlOrderStatus;
  triggerPrice: number;
  quantity: number;
  orderSide: OrderSide;
  createdAtUtc: string;
  updatedAtUtc: string;
}>;

/** Args to place a TP/SL order */
export type PlaceTpSlOrderArgs = Readonly<{
  symbol: string;
  /** BUY or SELL to close the position */
  side: OrderSide;
  /** stop_loss or take_profit */
  triggerSide: TpSlTriggerSide;
  triggerPrice: number;
  quantity: number;
  /** The position id to attach the TP/SL to (optional) */
  positionId?: string;
}>;

/** Args to place a position-level TP/SL bracket */
export type PlacePositionTpSlArgs = Readonly<{
  symbol: string;
  positionId: string;
  /** Take profit trigger price */
  takeProfitPrice?: number;
  /** Stop loss trigger price */
  stopLossPrice?: number;
}>;

/** Args to modify a TP/SL order */
export type ModifyTpSlOrderArgs = Readonly<{
  tpslId: string;
  symbol: string;
  triggerPrice: number;
  quantity?: number;
}>;

/** Args to modify a position-level TP/SL */
export type ModifyPositionTpSlArgs = Readonly<{
  positionId: string;
  symbol: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}>;

// ---------------------------------------------------------------------------
// Asset / Transfer types
// ---------------------------------------------------------------------------

/** Result of a sub-account transfer */
export type TransferResult = Readonly<{
  success: boolean;
}>;

/** Sub-account asset balance entry */
export type AssetBalance = Readonly<{
  coin: string;
  available: number;
  locked: number;
  total: number;
}>;

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

/** Common pagination args used across history endpoints */
export type PaginationArgs = Readonly<{
  pageNum?: number;
  pageSize?: number;
  startTimeMs?: number;
  endTimeMs?: number;
}>;
