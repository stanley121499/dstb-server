import { randomUUID } from "node:crypto";
import { toBitunixSymbol } from "./bitunixSymbolMapper.js";
import type { BitunixClient } from "./BitunixClient.js";
import { extractArray, isRecord, parseOrder, parseTrade, parseHistoryOrder } from "./BitunixParsers.js";
import { ExchangeError } from "./ExchangeError.js";
import type { Order, OrderSide, Trade } from "./types.js";
import type { BatchOrderParams, BatchOrderResult, HistoryOrder, PaginationArgs } from "./bitunixTypes.js";

/**
 * BitunixTradeApi — all futures trading endpoints.
 * Wraps: place, cancel, cancel all, modify, get, get pending, get history orders,
 *        history trades, batch order, flash close position, close all positions.
 */
export class BitunixTradeApi {
  private readonly client: BitunixClient;

  public constructor(client: BitunixClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Place order (with idempotency guard)
  // ---------------------------------------------------------------------------

  /**
   * Places a single futures order.
   * POST /api/v1/futures/trade/place_order
   * Includes network-error idempotency guard: if submission fails with NETWORK_ERROR,
   * it queries by clientId before throwing to avoid duplicate orders.
   */
  public async placeOrder(args: Readonly<{
    symbol: string;
    side: OrderSide;
    type: "MARKET" | "LIMIT" | "STOP_LOSS" | "TAKE_PROFIT";
    quantity: number;
    price?: number;
    stopPrice?: number;
    clientId?: string;
    isClose?: boolean;
    positionId?: string;
  }>): Promise<Order> {
    const bitunixSymbol = toBitunixSymbol(args.symbol);
    const clientId = args.clientId ?? this.createClientOrderId();

    const body: Record<string, unknown> = {
      symbol: bitunixSymbol,
      side: args.side.toUpperCase(),
      tradeSide: args.isClose === true ? "CLOSE" : "OPEN",
      orderType: args.type,
      qty: String(args.quantity),
      clientId
    };
    if (args.price !== undefined) body.price = String(args.price);
    if (args.stopPrice !== undefined) body.stopPrice = String(args.stopPrice);
    if (args.positionId !== undefined) body.positionId = args.positionId;

    let response: unknown;
    try {
      response = await this.client.request({
        method: "POST",
        path: "/api/v1/futures/trade/place_order",
        body,
        isPrivate: true
      });
    } catch (err: unknown) {
      // IDEMPOTENCY GUARD: if network error, check if order landed anyway
      if (err instanceof ExchangeError && err.code === "NETWORK_ERROR") {
        console.warn(`[BitunixTradeApi] Network error placing order ${clientId}; checking Bitunix for existing order...`);
        try {
          return await this.getOrderDetail({ clientId });
        } catch {
          // Not found — original error stands
        }
      }
      throw err;
    }

    const identifiers = this.extractOrderIdentifiers(response, clientId);
    const pending = this.buildPendingSnapshot({
      orderId: identifiers.orderId,
      clientId: identifiers.clientId,
      symbol: args.symbol,
      side: args.side,
      type: args.type,
      quantity: args.quantity,
      price: args.price ?? null,
      triggerPrice: args.stopPrice ?? null
    });

    return this.confirmOrder({ orderId: identifiers.orderId, clientId: identifiers.clientId, fallbackOrder: pending });
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * Cancels a single order by orderId.
   * POST /api/v1/futures/trade/cancel_orders
   */
  public async cancelOrder(args: Readonly<{ symbol: string; orderId: string }>): Promise<Order> {
    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/trade/cancel_orders",
      body: {
        symbol: toBitunixSymbol(args.symbol),
        orderId: args.orderId
      },
      isPrivate: true
    });
    return parseOrder(response);
  }

  /**
   * Cancels all open orders for a symbol.
   * POST /api/v1/futures/trade/cancel_all_orders
   */
  public async cancelAllOrders(symbol: string): Promise<{ cancelledCount: number }> {
    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/trade/cancel_all_orders",
      body: { symbol: toBitunixSymbol(symbol) },
      isPrivate: true
    });
    const cancelledCount = isRecord(response)
      ? Number(response.cancelledCount ?? response.count ?? 0)
      : 0;
    return { cancelledCount };
  }

  // ---------------------------------------------------------------------------
  // Modify
  // ---------------------------------------------------------------------------

  /**
   * Modifies an existing open order's price and/or quantity.
   * POST /api/v1/futures/trade/modify_order
   */
  public async modifyOrder(args: Readonly<{
    symbol: string;
    orderId: string;
    quantity?: number;
    price?: number;
    triggerPrice?: number;
  }>): Promise<Order> {
    if (args.quantity === undefined && args.price === undefined && args.triggerPrice === undefined) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "modifyOrder requires at least one of: quantity, price, triggerPrice" });
    }

    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(args.symbol),
      orderId: args.orderId
    };
    if (args.quantity !== undefined) body.qty = String(args.quantity);
    if (args.price !== undefined) body.price = String(args.price);
    if (args.triggerPrice !== undefined) body.triggerPrice = String(args.triggerPrice);

    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/trade/modify_order",
      body,
      isPrivate: true
    });
    return parseOrder(response);
  }

  // ---------------------------------------------------------------------------
  // Order queries
  // ---------------------------------------------------------------------------

  /**
   * Gets the detail of a single order by orderId or clientId.
   * GET /api/v1/futures/trade/get_order_detail
   */
  public async getOrderDetail(args: Readonly<{ orderId?: string; clientId?: string }>): Promise<Order> {
    if (!args.orderId && !args.clientId) {
      throw new ExchangeError({ code: "INVALID_ORDER", message: "orderId or clientId must be provided" });
    }
    const query: Record<string, string> = {};
    if (args.orderId) query.orderId = args.orderId;
    if (args.clientId) query.clientId = args.clientId;

    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/trade/get_order_detail",
      query,
      isPrivate: true
    });
    return parseOrder(response);
  }

  /**
   * Lists currently pending (open) orders for a symbol.
   * GET /api/v1/futures/trade/get_pending_orders
   */
  public async getPendingOrders(symbol: string): Promise<readonly Order[]> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/trade/get_pending_orders",
      query: { symbol: toBitunixSymbol(symbol) },
      isPrivate: true
    });
    return extractArray(response).map((item) => parseOrder(item));
  }

  /**
   * Gets historical (filled/cancelled) orders with pagination.
   * GET /api/v1/futures/trade/get_history_orders
   */
  public async getHistoryOrders(args: Readonly<{
    symbol?: string;
    orderId?: string;
    status?: string;
  } & PaginationArgs>): Promise<readonly HistoryOrder[]> {
    const query: Record<string, string | number | undefined> = {
      pageNum: args.pageNum ?? 1,
      pageSize: args.pageSize ?? 50
    };
    if (args.symbol !== undefined) query.symbol = toBitunixSymbol(args.symbol);
    if (args.orderId !== undefined) query.orderId = args.orderId;
    if (args.status !== undefined) query.status = args.status;
    if (args.startTimeMs !== undefined) query.startTime = args.startTimeMs;
    if (args.endTimeMs !== undefined) query.endTime = args.endTimeMs;

    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/trade/get_history_orders",
      query,
      isPrivate: true
    });
    return extractArray(response).map((item) => parseHistoryOrder(item));
  }

  /**
   * Gets account trade history (fills).
   * GET /api/v1/futures/trade/get_history_trades
   */
  public async getHistoryTrades(args: Readonly<{
    symbol?: string;
    orderId?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }>): Promise<readonly Trade[]> {
    const query: Record<string, string | number | undefined> = {};
    if (args.symbol) query.symbol = toBitunixSymbol(args.symbol);
    if (args.orderId) query.orderId = args.orderId;
    if (args.startTime) query.startTime = args.startTime;
    if (args.endTime) query.endTime = args.endTime;
    if (args.limit) query.limit = args.limit;

    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/trade/get_history_trades",
      query,
      isPrivate: true
    });
    return extractArray(response)
      .filter((item) => isRecord(item))
      .map((item) => parseTrade(item));
  }

  // ---------------------------------------------------------------------------
  // Batch
  // ---------------------------------------------------------------------------

  /**
   * Places multiple orders in a single API call, grouped by symbol.
   * POST /api/v1/futures/trade/batch_order
   */
  public async placeBatchOrders(orders: ReadonlyArray<BatchOrderParams>): Promise<ReadonlyArray<BatchOrderResult>> {
    if (orders.length === 0) return [];

    for (const order of orders) {
      if (!order.symbol || order.symbol.trim().length === 0) {
        throw new ExchangeError({ code: "INVALID_PARAMETER", message: "BatchOrderParams.symbol must be non-empty" });
      }
      if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
        throw new ExchangeError({ code: "INVALID_PARAMETER", message: "BatchOrderParams.quantity must be positive" });
      }
      if (order.type === "LIMIT" && (order.price === undefined || order.price <= 0)) {
        throw new ExchangeError({ code: "INVALID_PARAMETER", message: `LIMIT order for ${order.symbol} requires a positive price` });
      }
    }

    // Group by symbol
    const bySymbol = new Map<string, Array<Record<string, unknown>>>();
    for (const order of orders) {
      const sym = toBitunixSymbol(order.symbol);
      const item: Record<string, unknown> = {
        side: order.side.toUpperCase(),
        tradeSide: order.reduceOnly === true ? "CLOSE" : "OPEN",
        orderType: order.type,
        qty: String(order.quantity),
        clientId: this.createClientOrderId()
      };
      if (order.type === "LIMIT" && order.price !== undefined) item.price = String(order.price);
      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym)!.push(item);
    }

    const results: BatchOrderResult[] = [];
    for (const [sym, symOrders] of bySymbol) {
      try {
        const response = await this.client.request({
          method: "POST",
          path: "/api/v1/futures/trade/batch_order",
          body: { symbol: sym, orderList: symOrders },
          isPrivate: true
        });

        const successList = isRecord(response) && Array.isArray(response.successList)
          ? (response.successList as Array<Record<string, unknown>>).map((o) => ({ orderId: String(o.orderId ?? ""), clientId: String(o.clientId ?? "") }))
          : [];
        const failureList = isRecord(response) && Array.isArray(response.failureList)
          ? (response.failureList as Array<Record<string, unknown>>).map((o) => ({ clientId: String(o.clientId ?? ""), errorMsg: String(o.errorMsg ?? "unknown error"), errorCode: Number(o.errorCode ?? 0) }))
          : [];

        results.push({ symbol: sym, successList, failureList });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "unknown error";
        results.push({ symbol: sym, successList: [], failureList: [{ clientId: "", errorMsg, errorCode: -1 }] });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Close position
  // ---------------------------------------------------------------------------

  /**
   * Flash-closes a position (instant market fill via Bitunix endpoint).
   * POST /api/v1/futures/trade/flash_close_position
   */
  public async flashClosePosition(args: Readonly<{ symbol: string; positionId: string; quantity: number; side: OrderSide }>): Promise<Order> {
    try {
      await this.client.request({
        method: "POST",
        path: "/api/v1/futures/trade/flash_close_position",
        body: { positionId: args.positionId },
        isPrivate: true
      });
      const nowUtc = new Date().toISOString();
      return {
        id: `flash-close-${Date.now()}`,
        symbol: args.symbol,
        side: args.side === "long" ? "sell" : "buy",
        type: "market",
        quantity: args.quantity,
        price: null,
        triggerPrice: null,
        status: "filled",
        filledQuantity: args.quantity,
        averageFillPrice: null,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
        filledAtUtc: nowUtc
      };
    } catch {
      // Fallback: regular market close order
      return this.placeOrder({
        symbol: args.symbol,
        side: args.side === "long" ? "sell" : "buy",
        type: "MARKET",
        quantity: args.quantity,
        isClose: true,
        positionId: args.positionId
      });
    }
  }

  /**
   * Closes all positions for a symbol using the bulk close endpoint.
   * POST /api/v1/futures/trade/close_all_position
   */
  public async closeAllPositions(symbol: string): Promise<{ closedCount: number }> {
    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/trade/close_all_position",
      body: { symbol: toBitunixSymbol(symbol) },
      isPrivate: true
    });
    const closedCount = isRecord(response)
      ? Number(response.closedCount ?? response.count ?? 0)
      : 0;
    return { closedCount };
  }

  // ---------------------------------------------------------------------------
  // Order confirmation polling
  // ---------------------------------------------------------------------------

  /** Polls get_order_detail until the order reaches a terminal state. */
  public async confirmOrder(args: Readonly<{
    orderId?: string;
    clientId: string;
    fallbackOrder: Order;
    maxAttempts?: number;
    delayMs?: number;
  }>): Promise<Order> {
    const maxAttempts = args.maxAttempts ?? 10;
    const delayMs = args.delayMs ?? 500;
    let lastKnown = args.fallbackOrder;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(delayMs);
      try {
        const order = await this.getOrderDetail({
          ...(args.orderId != null && { orderId: args.orderId }),
          clientId: args.clientId
        });
        lastKnown = order;
        if (order.status === "filled") return order;
        if (order.status === "rejected" || order.status === "cancelled") {
          throw new ExchangeError({ code: "INVALID_ORDER", message: `Order ${order.status}`, details: { orderId: args.orderId, status: order.status } });
        }
      } catch (err: unknown) {
        if (err instanceof ExchangeError && err.code === "ORDER_NOT_FOUND") continue;
        throw err;
      }
    }

    console.warn(`[BitunixTradeApi] Order ${args.clientId} status unknown after polling timeout`);
    return lastKnown;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  public createClientOrderId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 32);
  }

  private extractOrderIdentifiers(response: unknown, fallbackClientId: string): { orderId: string; clientId: string } {
    if (!isRecord(response)) {
      return { orderId: `pending-${Date.now()}`, clientId: fallbackClientId };
    }
    const orderId = String(response.orderId ?? response.id ?? `pending-${Date.now()}`);
    const clientId = String(response.clientId ?? fallbackClientId);
    return { orderId, clientId };
  }

  private buildPendingSnapshot(args: Readonly<{
    orderId: string;
    clientId: string;
    symbol: string;
    side: OrderSide;
    type: string;
    quantity: number;
    price: number | null;
    triggerPrice: number | null;
  }>): Order {
    const nowUtc = new Date().toISOString();
    return {
      id: args.orderId,
      symbol: args.symbol,
      type: args.type === "LIMIT" ? "limit"
        : args.type === "STOP_LOSS" ? "stop_loss"
          : args.type === "TAKE_PROFIT" ? "take_profit"
            : "market",
      side: args.side,
      status: "pending",
      quantity: args.quantity,
      filledQuantity: 0,
      averageFillPrice: null,
      price: args.price,
      triggerPrice: args.triggerPrice,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
      filledAtUtc: null
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
