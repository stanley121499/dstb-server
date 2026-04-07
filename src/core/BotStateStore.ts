import type {
  Bot,
  BotConfig,
  BotStatus,
  Order,
  OrderStatus,
  Position,
  Trade,
  TradeCandleBundle
} from "./types.js";

/**
 * Persistence contract for trading bot state (Supabase implementation).
 * Mirrors the former SQLite StateManager surface area.
 */
export interface BotStateStore {
  createBot(bot: BotConfig): Promise<string>;
  upsertBot(id: string, bot: BotConfig): Promise<string>;
  getBot(id: string): Promise<Bot | null>;
  getAllBots(): Promise<Bot[]>;
  updateBotStatus(id: string, status: BotStatus): Promise<void>;
  updateBotEquity(id: string, equity: number): Promise<void>;
  updateBotHeartbeat(id: string): Promise<void>;
  createPosition(position: Position): Promise<string>;
  getOpenPositions(botId: string): Promise<Position[]>;
  updatePosition(id: string, updates: Partial<Position>): Promise<void>;
  closePosition(
    id: string,
    exitPrice: number,
    reason: string,
    tradeCandles?: ReadonlyArray<TradeCandleBundle>
  ): Promise<void>;
  saveTrade(trade: Trade): Promise<string>;
  getTrades(botId: string, days?: number): Promise<Trade[]>;
  createOrder(order: Order): Promise<string>;
  updateOrderStatus(clientOrderId: string, status: OrderStatus): Promise<void>;
  getOrder(clientOrderId: string): Promise<Order | null>;
  getAllOpenPositions(): Promise<Position[]>;
  getDailyPnL(botId: string, date: string): Promise<number>;
  backup(): Promise<void>;
}

/**
 * Narrow structural check for dependency injection (replaces instanceof StateManager).
 */
export function isBotStateStore(value: unknown): value is BotStateStore {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v["createBot"] === "function" &&
    typeof v["getBot"] === "function" &&
    typeof v["closePosition"] === "function"
  );
}
