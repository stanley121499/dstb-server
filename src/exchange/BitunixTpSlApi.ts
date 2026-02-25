import { toBitunixSymbol } from "./bitunixSymbolMapper.js";
import type { BitunixClient } from "./BitunixClient.js";
import { extractArray, isRecord, parseTpSlOrder } from "./BitunixParsers.js";
import { ExchangeError } from "./ExchangeError.js";
import type {
  TpSlOrder,
  PlaceTpSlOrderArgs,
  PlacePositionTpSlArgs,
  ModifyTpSlOrderArgs,
  ModifyPositionTpSlArgs,
  PaginationArgs
} from "./bitunixTypes.js";

/**
 * BitunixTpSlApi — all TP/SL (take profit / stop loss) endpoints.
 *
 * These are DEDICATED TP/SL endpoints which support position-level bracket
 * orders and provide full lifecycle management (place, list, cancel, modify).
 *
 * @note The regular `placeOrder` with a stop price still works for simple
 * trigger orders, but these dedicated endpoints provide richer bracket linking.
 */
export class BitunixTpSlApi {
  private readonly client: BitunixClient;

  public constructor(client: BitunixClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Place
  // ---------------------------------------------------------------------------

  /**
   * Places a standalone TP or SL order on a symbol.
   * POST /api/v1/futures/tpsl/place_order
   */
  public async placeTpSlOrder(args: PlaceTpSlOrderArgs): Promise<TpSlOrder> {
    if (!Number.isFinite(args.triggerPrice) || args.triggerPrice <= 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "triggerPrice must be a positive number" });
    }
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "quantity must be a positive number" });
    }

    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(args.symbol),
      side: args.side.toUpperCase(),
      tpslType: args.triggerSide === "take_profit" ? "TAKE_PROFIT" : "STOP_LOSS",
      triggerPrice: String(args.triggerPrice),
      qty: String(args.quantity)
    };
    if (args.positionId !== undefined) body.positionId = args.positionId;

    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/tpsl/place_order",
      body,
      isPrivate: true
    });

    return parseTpSlOrder(isRecord(response) ? response : { ...body, tpslId: String((response as Record<string, unknown>)?.tpslId ?? response ?? `tpsl-${Date.now()}`) });
  }

  /**
   * Places a bracket TP/SL order at the position level (attaches to an open position).
   * POST /api/v1/futures/tpsl/position/place_order
   */
  public async placePositionTpSlOrder(args: PlacePositionTpSlArgs): Promise<{ success: boolean }> {
    if (args.takeProfitPrice === undefined && args.stopLossPrice === undefined) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "placePositionTpSlOrder requires at least one of: takeProfitPrice, stopLossPrice" });
    }

    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(args.symbol),
      positionId: args.positionId
    };
    if (args.takeProfitPrice !== undefined) body.tpPrice = String(args.takeProfitPrice);
    if (args.stopLossPrice !== undefined) body.slPrice = String(args.stopLossPrice);

    await this.client.request({
      method: "POST",
      path: "/api/v1/futures/tpsl/position/place_order",
      body,
      isPrivate: true
    });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Gets all pending (active) TP/SL orders for a symbol.
   * GET /api/v1/futures/tpsl/get_pending_orders
   */
  public async getPendingTpSlOrders(symbol: string): Promise<readonly TpSlOrder[]> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/tpsl/get_pending_orders",
      query: { symbol: toBitunixSymbol(symbol) },
      isPrivate: true
    });
    return extractArray(response).map((row) => parseTpSlOrder(row));
  }

  /**
   * Gets historical (triggered/cancelled) TP/SL orders for a symbol.
   * GET /api/v1/futures/tpsl/get_history_orders
   */
  public async getHistoryTpSlOrders(args: Readonly<{
    symbol?: string;
  } & PaginationArgs>): Promise<readonly TpSlOrder[]> {
    const query: Record<string, string | number | undefined> = {
      pageNum: args.pageNum ?? 1,
      pageSize: args.pageSize ?? 50
    };
    if (args.symbol !== undefined) query.symbol = toBitunixSymbol(args.symbol);
    if (args.startTimeMs !== undefined) query.startTime = args.startTimeMs;
    if (args.endTimeMs !== undefined) query.endTime = args.endTimeMs;

    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/tpsl/get_history_orders",
      query,
      isPrivate: true
    });
    return extractArray(response).map((row) => parseTpSlOrder(row));
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * Cancels a single TP/SL order.
   * POST /api/v1/futures/tpsl/cancel_order
   */
  public async cancelTpSlOrder(args: Readonly<{ symbol: string; tpslId: string }>): Promise<{ success: boolean }> {
    await this.client.request({
      method: "POST",
      path: "/api/v1/futures/tpsl/cancel_order",
      body: {
        symbol: toBitunixSymbol(args.symbol),
        tpslId: args.tpslId
      },
      isPrivate: true
    });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Modify
  // ---------------------------------------------------------------------------

  /**
   * Modifies an existing TP/SL order's trigger price and/or quantity.
   * POST /api/v1/futures/tpsl/modify_order
   */
  public async modifyTpSlOrder(args: ModifyTpSlOrderArgs): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(args.symbol),
      tpslId: args.tpslId,
      triggerPrice: String(args.triggerPrice)
    };
    if (args.quantity !== undefined) body.qty = String(args.quantity);

    await this.client.request({
      method: "POST",
      path: "/api/v1/futures/tpsl/modify_order",
      body,
      isPrivate: true
    });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Modify
  // ---------------------------------------------------------------------------

  /**
   * Modifies the TP and/or SL prices attached to an entire position.
   * POST /api/v1/futures/tp_sl/modify_position_tp_sl_order
   */
  public async modifyPositionTpSlOrder(args: ModifyPositionTpSlArgs): Promise<{ success: boolean }> {
    if (args.takeProfitPrice === undefined && args.stopLossPrice === undefined) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "modifyPositionTpSlOrder requires at least one of: takeProfitPrice, stopLossPrice" });
    }

    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(args.symbol),
      positionId: args.positionId
    };
    if (args.takeProfitPrice !== undefined) body.tpPrice = String(args.takeProfitPrice);
    if (args.stopLossPrice !== undefined) body.slPrice = String(args.stopLossPrice);

    await this.client.request({
      method: "POST",
      path: "/api/v1/futures/tpsl/position/modify_order",
      body,
      isPrivate: true
    });
    return { success: true };
  }
}
