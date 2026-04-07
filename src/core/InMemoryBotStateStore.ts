import { randomUUID } from "node:crypto";

import type { BotStateStore } from "./BotStateStore.js";
import type {
  Bot,
  BotConfig,
  BotStatus,
  Order,
  OrderStatus,
  Position,
  PositionSide,
  Trade,
  TradeCandleBundle
} from "./types.js";

/**
 * In-memory BotStateStore for tests and offline scripts (no Supabase).
 */
export class InMemoryBotStateStore implements BotStateStore {
  private readonly bots = new Map<string, Bot>();
  private readonly positions = new Map<string, Position>();
  private readonly trades = new Map<string, Trade>();
  private readonly orders = new Map<string, Order>();

  public async createBot(bot: BotConfig): Promise<string> {
    const configId = randomUUID();
    const id = randomUUID();
    const now = Date.now();
    const row: Bot = {
      id,
      configId,
      name: bot.name,
      strategy: bot.strategy,
      initialBalance: bot.initialBalance,
      currentEquity: bot.initialBalance,
      status: "running",
      config: bot,
      createdAt: now,
      lastHeartbeat: now
    };
    this.bots.set(id, row);
    return id;
  }

  public async upsertBot(id: string, bot: BotConfig): Promise<string> {
    const now = Date.now();
    const existing = this.bots.get(id);
    if (existing !== undefined) {
      this.bots.set(id, {
        ...existing,
        name: bot.name,
        strategy: bot.strategy,
        config: bot,
        status: "running",
        lastHeartbeat: now
      });
      return id;
    }

    const configId = randomUUID();
    this.bots.set(id, {
      id,
      configId,
      name: bot.name,
      strategy: bot.strategy,
      initialBalance: bot.initialBalance,
      currentEquity: bot.initialBalance,
      status: "running",
      config: bot,
      createdAt: now,
      lastHeartbeat: now
    });
    return id;
  }

  public async getBot(id: string): Promise<Bot | null> {
    return this.bots.get(id) ?? null;
  }

  public async getAllBots(): Promise<Bot[]> {
    return [...this.bots.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  public async updateBotStatus(id: string, status: BotStatus): Promise<void> {
    const b = this.bots.get(id);
    if (b !== undefined) {
      this.bots.set(id, { ...b, status });
    }
  }

  public async updateBotEquity(id: string, equity: number): Promise<void> {
    const b = this.bots.get(id);
    if (b !== undefined) {
      this.bots.set(id, { ...b, currentEquity: equity });
    }
  }

  public async updateBotHeartbeat(id: string): Promise<void> {
    const b = this.bots.get(id);
    if (b !== undefined) {
      this.bots.set(id, { ...b, lastHeartbeat: Date.now() });
    }
  }

  public async createPosition(position: Position): Promise<string> {
    const id = randomUUID();
    this.positions.set(id, { ...position, id });
    return id;
  }

  public async getOpenPositions(botId: string): Promise<Position[]> {
    return [...this.positions.values()].filter((p) => p.botId === botId);
  }

  public async updatePosition(id: string, updates: Partial<Position>): Promise<void> {
    const p = this.positions.get(id);
    if (p === undefined) {
      return;
    }
    this.positions.set(id, { ...p, ...updates });
  }

  public async closePosition(
    id: string,
    exitPrice: number,
    reason: string,
    _tradeCandles?: ReadonlyArray<TradeCandleBundle>
  ): Promise<void> {
    const pos = this.positions.get(id);
    if (pos === undefined) {
      return;
    }

    const pnl =
      pos.side === "LONG"
        ? (exitPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - exitPrice) * pos.quantity;

    const tradeId = randomUUID();
    const now = Date.now();
    const trade: Trade = {
      id: tradeId,
      botId: pos.botId,
      symbol: pos.symbol,
      side: pos.side as PositionSide,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnl,
      entryTime: pos.entryTime,
      exitTime: now,
      exitReason: reason
    };
    this.trades.set(tradeId, trade);
    this.positions.delete(id);
  }

  public async saveTrade(trade: Trade): Promise<string> {
    const id = trade.id.length > 0 ? trade.id : randomUUID();
    this.trades.set(id, { ...trade, id });
    return id;
  }

  public async getTrades(botId: string, days?: number): Promise<Trade[]> {
    const all = [...this.trades.values()].filter((t) => t.botId === botId);
    if (days === undefined) {
      return all.sort((a, b) => b.exitTime - a.exitTime);
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return all.filter((t) => t.exitTime >= cutoff).sort((a, b) => b.exitTime - a.exitTime);
  }

  public async createOrder(order: Order): Promise<string> {
    const id = randomUUID();
    this.orders.set(order.clientOrderId, { ...order, id });
    return id;
  }

  public async updateOrderStatus(clientOrderId: string, status: OrderStatus): Promise<void> {
    const o = this.orders.get(clientOrderId);
    if (o !== undefined) {
      this.orders.set(clientOrderId, { ...o, status });
    }
  }

  public async getOrder(clientOrderId: string): Promise<Order | null> {
    return this.orders.get(clientOrderId) ?? null;
  }

  public async getAllOpenPositions(): Promise<Position[]> {
    return [...this.positions.values()];
  }

  public async getDailyPnL(botId: string, date: string): Promise<number> {
    const range = this.getDateRangeMs(date);
    if (range === null) {
      return 0;
    }
    return [...this.trades.values()]
      .filter((t) => t.botId === botId && t.exitTime >= range.start && t.exitTime < range.end)
      .reduce((sum, t) => sum + t.pnl, 0);
  }

  public async backup(): Promise<void> {
    /* no-op */
  }

  private getDateRangeMs(date: string): { start: number; end: number } | null {
    const parts = date.split("-");
    if (parts.length !== 3) {
      return null;
    }
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y === undefined || m === undefined || d === undefined) {
      return null;
    }
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    return { start: start.getTime(), end: end.getTime() };
  }
}
