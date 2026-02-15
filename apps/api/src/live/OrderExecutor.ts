import { randomUUID } from "node:crypto";

import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { Order as ExchangeOrder, OrderSide, OrderType } from "../exchange/types.js";
import type { SupabaseClient } from "../supabase/client.js";
import type { Database } from "../supabase/database.js";

type LiveOrderRow = Database["public"]["Tables"]["live_orders"]["Row"];
type LiveOrderInsert = Database["public"]["Tables"]["live_orders"]["Insert"];

export type LiveOrderStatus = "pending" | "submitted" | "partial" | "filled" | "cancelled" | "rejected" | "error";

type CreateOrderArgs = Readonly<{
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  parentPositionId?: string | null;
}>;

/**
 * Handles order submission, persistence, and polling for fills.
 */
export class OrderExecutor {
  private readonly supabase: SupabaseClient;
  private readonly adapter: IExchangeAdapter;
  private readonly botId: string;
  private readonly exchange: string;
  private readonly symbol: string;

  /**
   * Creates a new order executor for a specific bot and adapter.
   */
  public constructor(args: Readonly<{
    supabase: SupabaseClient;
    adapter: IExchangeAdapter;
    botId: string;
    exchange: string;
    symbol: string;
  }>) {
    this.supabase = args.supabase;
    this.adapter = args.adapter;
    this.botId = args.botId;
    this.exchange = args.exchange;
    this.symbol = args.symbol;
  }

  /**
   * Places a market order and returns the persisted record.
   */
  public async placeMarketOrder(args: Readonly<{ side: OrderSide; quantity: number; parentPositionId?: string | null }>): Promise<LiveOrderRow> {
    return this.placeOrder({
      side: args.side,
      type: "market",
      quantity: args.quantity,
      parentPositionId: args.parentPositionId ?? null
    });
  }

  /**
   * Places a limit order and returns the persisted record.
   */
  public async placeLimitOrder(args: Readonly<{ side: OrderSide; quantity: number; price: number; parentPositionId?: string | null }>): Promise<LiveOrderRow> {
    return this.placeOrder({
      side: args.side,
      type: "limit",
      quantity: args.quantity,
      price: args.price,
      parentPositionId: args.parentPositionId ?? null
    });
  }

  /**
   * Places a stop loss order and returns the persisted record.
   */
  public async placeStopLossOrder(args: Readonly<{ side: OrderSide; quantity: number; stopPrice: number; parentPositionId?: string | null }>): Promise<LiveOrderRow> {
    return this.placeOrder({
      side: args.side,
      type: "stop_loss",
      quantity: args.quantity,
      stopPrice: args.stopPrice,
      parentPositionId: args.parentPositionId ?? null
    });
  }

  /**
   * Places a take profit order and returns the persisted record.
   */
  public async placeTakeProfitOrder(args: Readonly<{
    side: OrderSide;
    quantity: number;
    takeProfitPrice: number;
    parentPositionId?: string | null;
  }>): Promise<LiveOrderRow> {
    return this.placeOrder({
      side: args.side,
      type: "take_profit",
      quantity: args.quantity,
      stopPrice: args.takeProfitPrice,
      parentPositionId: args.parentPositionId ?? null
    });
  }

  /**
   * Cancels an order by id and updates the DB record.
   */
  public async cancelOrder(orderId: string): Promise<LiveOrderRow> {
    const order = await this.getOrder(orderId);
    if (order.exchange_order_id === null) {
      return this.updateOrder(order.id, {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        error_message: "Missing exchange order id"
      });
    }

    const exchangeOrder = await this.adapter.cancelOrder(order.exchange_order_id);
    return this.updateOrder(order.id, {
      status: this.mapExchangeStatus(exchangeOrder.status),
      cancelled_at: exchangeOrder.status === "cancelled" ? new Date().toISOString() : null
    });
  }

  /**
   * Retrieves an order by id from Supabase.
   */
  public async getOrderStatus(orderId: string): Promise<LiveOrderRow> {
    return this.getOrder(orderId);
  }

  /**
   * Polls for a fill until timeout.
   */
  public async waitForFill(orderId: string, timeoutMs: number): Promise<LiveOrderRow> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const order = await this.refreshOrderStatus(orderId);
      if (order.status === "filled") {
        return order;
      }
      if (order.status === "cancelled" || order.status === "rejected" || order.status === "error") {
        return order;
      }
      await this.sleep(2_000);
    }

    await this.updateOrder(orderId, {
      status: "error",
      error_message: "Order fill timeout"
    });
    throw new Error(`Order ${orderId} not filled within timeout`);
  }

  private async placeOrder(args: CreateOrderArgs): Promise<LiveOrderRow> {
    const row = await this.createOrder(args);
    const exchangeOrder = await this.submitToExchange(args);

    return this.updateOrder(row.id, {
      status: this.mapExchangeStatus(exchangeOrder.status),
      exchange_order_id: exchangeOrder.id,
      submitted_at: new Date().toISOString(),
      exchange_response: exchangeOrder
    });
  }

  private async submitToExchange(args: CreateOrderArgs): Promise<ExchangeOrder> {
    if (args.type === "market") {
      return this.adapter.placeMarketOrder({ side: args.side, quantity: args.quantity });
    }
    if (args.type === "limit" && args.price !== undefined && args.price !== null) {
      return this.adapter.placeLimitOrder({ side: args.side, quantity: args.quantity, price: args.price });
    }
    if (args.type === "stop_loss" && args.stopPrice !== undefined && args.stopPrice !== null) {
      return this.adapter.placeStopLossOrder({ side: args.side, quantity: args.quantity, stopPrice: args.stopPrice });
    }
    if (args.type === "take_profit" && args.stopPrice !== undefined && args.stopPrice !== null) {
      return this.adapter.placeTakeProfitOrder({
        side: args.side,
        quantity: args.quantity,
        takeProfitPrice: args.stopPrice
      });
    }
    throw new Error(`Unsupported order submission: ${args.type}`);
  }

  private async createOrder(args: CreateOrderArgs): Promise<LiveOrderRow> {
    const payload: LiveOrderInsert = {
      bot_id: this.botId,
      exchange: this.exchange,
      exchange_order_id: null,
      client_order_id: randomUUID(),
      symbol: this.symbol,
      side: args.side,
      type: args.type,
      status: "pending",
      quantity: args.quantity,
      price: args.price ?? null,
      stop_price: args.stopPrice ?? null,
      filled_quantity: 0,
      avg_fill_price: null,
      fee_paid: null,
      fee_currency: null,
      time_in_force: null,
      request_payload: {
        side: args.side,
        type: args.type,
        quantity: args.quantity,
        price: args.price ?? null,
        stopPrice: args.stopPrice ?? null
      },
      exchange_response: null,
      error_message: null,
      submitted_at: null,
      filled_at: null,
      cancelled_at: null,
      parent_position_id: args.parentPositionId ?? null
    };

    const result = await this.supabase.from("live_orders").insert(payload).select("*").single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error("Failed to create live order");
    }

    return result.data as LiveOrderRow;
  }

  private async refreshOrderStatus(orderId: string): Promise<LiveOrderRow> {
    const order = await this.getOrder(orderId);
    if (order.exchange_order_id === null) {
      return order;
    }

    const exchangeOrder = await this.adapter.getOrder(order.exchange_order_id);
    if (exchangeOrder === null) {
      return this.updateOrder(orderId, {
        status: "error",
        error_message: "Exchange order not found"
      });
    }

    const status = this.mapExchangeStatus(exchangeOrder.status);
    const filledAt = exchangeOrder.filledAtUtc ?? null;

    return this.updateOrder(orderId, {
      status,
      filled_quantity: exchangeOrder.filledQuantity,
      avg_fill_price: exchangeOrder.averageFillPrice,
      filled_at: filledAt,
      exchange_response: exchangeOrder
    });
  }

  private async getOrder(orderId: string): Promise<LiveOrderRow> {
    const result = await this.supabase.from("live_orders").select("*").eq("id", orderId).single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error(`Order not found: ${orderId}`);
    }
    return result.data as LiveOrderRow;
  }

  private async updateOrder(orderId: string, updates: Database["public"]["Tables"]["live_orders"]["Update"]): Promise<LiveOrderRow> {
    const result = await this.supabase.from("live_orders").update(updates).eq("id", orderId).select("*").single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error(`Failed to update order: ${orderId}`);
    }
    return result.data as LiveOrderRow;
  }

  private mapExchangeStatus(status: ExchangeOrder["status"]): LiveOrderStatus {
    if (status === "filled") {
      return "filled";
    }
    if (status === "cancelled") {
      return "cancelled";
    }
    if (status === "rejected") {
      return "rejected";
    }
    if (status === "open" || status === "pending") {
      return "submitted";
    }
    return "error";
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
