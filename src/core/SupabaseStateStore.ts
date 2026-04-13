import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "../supabase/client.js";
import { loadSupabaseEnv } from "../supabase/env.js";
import { botConfigToColumns, configRowToBotConfig, type ConfigRow } from "./configMapping.js";
import { Logger } from "./Logger.js";
import type { BotLogInsert, BotStateStore } from "./BotStateStore.js";
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

type BotsJoinRow = Readonly<{
  id: string;
  config_id: string;
  status: string;
  equity: string | number | null;
  last_heartbeat: string | null;
  created_at: string;
  configs: ConfigRow | ConfigRow[] | null;
}>;

/**
 * Supabase-backed implementation of BotStateStore (service role).
 */
export class SupabaseStateStore implements BotStateStore {
  public readonly client: SupabaseClient;
  private readonly logger: Logger;

  public constructor(client: SupabaseClient, logger: Logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * Factory using SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
   */
  public static fromEnv(logger: Logger): SupabaseStateStore {
    const env = loadSupabaseEnv();
    return new SupabaseStateStore(createServiceRoleClient(env), logger);
  }

  /**
   * Enabled config rows for BotManager startup.
   */
  public async fetchEnabledConfigRows(): Promise<ConfigRow[]> {
    const { data, error } = await this.client
      .from("configs")
      .select("*")
      .eq("enabled", true)
      .order("name", { ascending: true });

    if (error !== null) {
      this.logger.error("fetchEnabledConfigRows failed", { error: error.message });
      return [];
    }

    return (data ?? []) as ConfigRow[];
  }

  /**
   * Toggle config.enabled (control plane).
   */
  public async setConfigEnabled(configId: string, enabled: boolean): Promise<void> {
    const { error } = await this.client.from("configs").update({ enabled }).eq("id", configId);
    if (error !== null) {
      this.logger.error("setConfigEnabled failed", { error: error.message, configId });
    }
  }

  /**
   * Resolve runtime bot id by config display name (Telegram /start).
   */
  public async findBotIdByConfigName(name: string): Promise<string | null> {
    const { data: cfg, error: cErr } = await this.client
      .from("configs")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (cErr !== null || cfg === null) {
      return null;
    }

    const configId = (cfg as { id: string }).id;
    const { data: bot, error: bErr } = await this.client
      .from("bots")
      .select("id")
      .eq("config_id", configId)
      .maybeSingle();

    if (bErr !== null || bot === null) {
      return null;
    }

    return (bot as { id: string }).id;
  }

  /**
   * Ensure a `bots` row exists for a config (idempotent).
   */
  public async ensureBotRowForConfigId(configId: string): Promise<string> {
    const { data: existing, error: selErr } = await this.client
      .from("bots")
      .select("id")
      .eq("config_id", configId)
      .maybeSingle();

    if (selErr !== null) {
      throw new Error(`ensureBotRowForConfigId select failed: ${selErr.message}`);
    }

    if (existing !== null) {
      return (existing as { id: string }).id;
    }

    const { data: inserted, error: insErr } = await this.client
      .from("bots")
      .insert({
        config_id: configId,
        status: "stopped"
      })
      .select("id")
      .single();

    if (insErr !== null) {
      const { data: raced } = await this.client
        .from("bots")
        .select("id")
        .eq("config_id", configId)
        .maybeSingle();
      if (raced !== null) {
        return (raced as { id: string }).id;
      }
      throw new Error(`ensureBotRowForConfigId insert failed: ${insErr.message}`);
    }

    return (inserted as { id: string }).id;
  }

  /**
   * Count bots in a given status (health endpoint).
   */
  public async countBotsWithStatus(status: BotStatus): Promise<number> {
    const { count, error } = await this.client
      .from("bots")
      .select("*", { count: "exact", head: true })
      .eq("status", status);

    if (error !== null) {
      this.logger.error("countBotsWithStatus failed", { error: error.message });
      return 0;
    }

    return count ?? 0;
  }

  /**
   * Structured operational log (bot_logs).
   */
  public async insertBotLog(args: BotLogInsert): Promise<void> {
    const { error } = await this.client.from("bot_logs").insert({
      bot_id: args.botId,
      level: args.level,
      event: args.event,
      message: args.message,
      metadata: args.metadata ?? {}
    });

    if (error !== null) {
      this.logger.error("insertBotLog failed", { error: error.message, event: args.event });
    }
  }

  public async createBot(bot: BotConfig): Promise<string> {
    const cols = botConfigToColumns(bot);

    const { data: existing, error: findErr } = await this.client
      .from("configs")
      .select("id")
      .eq("name", cols.name)
      .eq("symbol", cols.symbol)
      .maybeSingle();

    if (findErr !== null) {
      this.logger.error("createBot find config failed", { error: findErr.message });
      return "";
    }

    let configId: string;

    if (existing !== null) {
      configId = (existing as { id: string }).id;
      const { error: upErr } = await this.client
        .from("configs")
        .update({
          ...cols,
          updated_at: new Date().toISOString()
        })
        .eq("id", configId);

      if (upErr !== null) {
        this.logger.error("createBot update config failed", { error: upErr.message });
        return "";
      }
    } else {
      const newId = randomUUID();
      const { error: insErr } = await this.client.from("configs").insert({
        id: newId,
        ...cols,
        enabled: false
      });

      if (insErr !== null) {
        this.logger.error("createBot insert config failed", { error: insErr.message });
        return "";
      }

      configId = newId;
    }

    return await this.ensureBotRowForConfigId(configId);
  }

  public async upsertBot(id: string, bot: BotConfig): Promise<string> {
    const cols = botConfigToColumns(bot);

    const { data: botRow, error: botErr } = await this.client
      .from("bots")
      .select("config_id")
      .eq("id", id)
      .maybeSingle();

    if (botErr !== null || botRow === null) {
      this.logger.error("upsertBot missing bot", { error: botErr?.message, id });
      return "";
    }

    const configId = (botRow as { config_id: string }).config_id;

    const { error: cfgErr } = await this.client
      .from("configs")
      .update({
        ...cols,
        updated_at: new Date().toISOString()
      })
      .eq("id", configId);

    if (cfgErr !== null) {
      this.logger.error("upsertBot update config failed", { error: cfgErr.message });
      return "";
    }

    const { error: stErr } = await this.client
      .from("bots")
      .update({
        status: "running",
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (stErr !== null) {
      this.logger.error("upsertBot update bot failed", { error: stErr.message });
      return "";
    }

    return id;
  }

  public async getBot(id: string): Promise<Bot | null> {
    const mapped = await this.fetchBotJoin(id);
    return mapped;
  }

  public async getAllBots(): Promise<Bot[]> {
    const { data, error } = await this.client.from("bots").select(`
        id,
        config_id,
        status,
        equity,
        last_heartbeat,
        created_at,
        configs (*)
      `);

    if (error !== null) {
      this.logger.error("getAllBots failed", { error: error.message });
      return [];
    }

    const rows = (data ?? []) as BotsJoinRow[];
    const out: Bot[] = [];

    for (const row of rows) {
      const b = this.mapJoinRowToBot(row);
      if (b !== null) {
        out.push(b);
      }
    }

    return out;
  }

  public async updateBotStatus(id: string, status: BotStatus): Promise<void> {
    const { error } = await this.client
      .from("bots")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error !== null) {
      this.logger.error("updateBotStatus failed", { error: error.message, id });
    }
  }

  public async updateBotEquity(id: string, equity: number): Promise<void> {
    const { error } = await this.client
      .from("bots")
      .update({ equity, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error !== null) {
      this.logger.error("updateBotEquity failed", { error: error.message, id });
    }
  }

  public async updateBotHeartbeat(id: string): Promise<void> {
    const { error } = await this.client
      .from("bots")
      .update({
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error !== null) {
      this.logger.error("updateBotHeartbeat failed", { error: error.message, id });
    }
  }

  public async createPosition(position: Position): Promise<string> {
    const { data: botRow, error: bErr } = await this.client
      .from("bots")
      .select("config_id")
      .eq("id", position.botId)
      .maybeSingle();

    if (bErr !== null || botRow === null) {
      this.logger.error("createPosition missing bot", { error: bErr?.message });
      return "";
    }

    const configId = (botRow as { config_id: string }).config_id;
    const id = randomUUID();

    const { error } = await this.client.from("positions").insert({
      id,
      bot_id: position.botId,
      config_id: configId,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      entry_price: position.entryPrice,
      stop_loss: position.stopLoss ?? null,
      take_profit: position.takeProfit ?? null,
      entry_time: new Date(position.entryTime).toISOString()
    });

    if (error !== null) {
      this.logger.error("createPosition failed", { error: error.message });
      return "";
    }

    return id;
  }

  public async getOpenPositions(botId: string): Promise<Position[]> {
    const { data, error } = await this.client.from("positions").select("*").eq("bot_id", botId);

    if (error !== null) {
      this.logger.error("getOpenPositions failed", { error: error.message });
      return [];
    }

    return (data ?? []).map((row) => this.mapPositionRow(row as Record<string, unknown>));
  }

  public async updatePosition(id: string, updates: Partial<Position>): Promise<void> {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (updates.symbol !== undefined) payload["symbol"] = updates.symbol;
    if (updates.side !== undefined) payload["side"] = updates.side;
    if (updates.quantity !== undefined) payload["quantity"] = updates.quantity;
    if (updates.entryPrice !== undefined) payload["entry_price"] = updates.entryPrice;
    if (updates.stopLoss !== undefined) payload["stop_loss"] = updates.stopLoss;
    if (updates.takeProfit !== undefined) payload["take_profit"] = updates.takeProfit;
    if (updates.entryTime !== undefined) {
      payload["entry_time"] = new Date(updates.entryTime).toISOString();
    }

    const { error } = await this.client.from("positions").update(payload).eq("id", id);

    if (error !== null) {
      this.logger.error("updatePosition failed", { error: error.message, id });
    }
  }

  public async closePosition(
    id: string,
    exitPrice: number,
    reason: string,
    tradeCandles?: ReadonlyArray<TradeCandleBundle>
  ): Promise<void> {
    const { data: pos, error: pErr } = await this.client.from("positions").select("*").eq("id", id).maybeSingle();

    if (pErr !== null || pos === null) {
      this.logger.error("closePosition missing position", { error: pErr?.message, id });
      return;
    }

    const row = pos as Record<string, unknown>;
    const botId = String(row["bot_id"]);
    const configId = String(row["config_id"]);
    const side = row["side"] as PositionSide;
    const quantity = Number(row["quantity"]);
    const entryPrice = Number(row["entry_price"]);
    const entryTimeMs = this.parseTs(row["entry_time"]);

    const pnl =
      side === "LONG"
        ? (exitPrice - entryPrice) * quantity
        : (entryPrice - exitPrice) * quantity;

    const rMultiple = this.computeRMultiple(side, entryPrice, exitPrice, row["stop_loss"]);

    const { data: cfg, error: cErr } = await this.client
      .from("configs")
      .select("current_version")
      .eq("id", configId)
      .maybeSingle();

    if (cErr !== null || cfg === null) {
      this.logger.error("closePosition missing config", { error: cErr?.message });
      return;
    }

    const version = Number((cfg as { current_version: number }).current_version);
    const bot = await this.getBot(botId);
    if (bot === null) {
      this.logger.error("closePosition missing bot", { botId });
      return;
    }

    const notional = Math.abs(entryPrice * quantity);
    const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;
    const exitMs = Date.now();
    const tradeId = randomUUID();

    const { error: tErr } = await this.client.from("trades").insert({
      id: tradeId,
      bot_id: botId,
      config_id: configId,
      config_version: version,
      config_snapshot: bot.config as unknown as Record<string, unknown>,
      symbol: String(row["symbol"]),
      side,
      entry_price: entryPrice,
      exit_price: exitPrice,
      quantity,
      stop_loss: row["stop_loss"],
      take_profit: row["take_profit"],
      pnl,
      pnl_pct: pnlPct,
      entry_time: new Date(entryTimeMs).toISOString(),
      exit_time: new Date(exitMs).toISOString(),
      exit_reason: reason,
      metadata: rMultiple !== undefined ? { rMultiple } : {}
    });

    if (tErr !== null) {
      this.logger.error("closePosition trade insert failed", { error: tErr.message });
      return;
    }

    if (tradeCandles !== undefined && tradeCandles.length > 0) {
      for (const bundle of tradeCandles) {
        const { error: cErr2 } = await this.client.from("trade_candles").insert({
          trade_id: tradeId,
          timeframe: bundle.timeframe,
          candles: bundle.candles as unknown[],
          range_start: new Date(bundle.rangeStartMs).toISOString(),
          range_end: new Date(bundle.rangeEndMs).toISOString()
        });
        if (cErr2 !== null) {
          this.logger.error("trade_candles insert failed", { error: cErr2.message });
        }
      }
    }

    const { error: dErr } = await this.client.from("positions").delete().eq("id", id);
    if (dErr !== null) {
      this.logger.error("closePosition delete failed", { error: dErr.message });
    }
  }

  public async saveTrade(trade: Trade): Promise<string> {
    const { data: botRow, error: bErr } = await this.client
      .from("bots")
      .select("config_id")
      .eq("id", trade.botId)
      .maybeSingle();

    if (bErr !== null || botRow === null) {
      this.logger.error("saveTrade missing bot", { error: bErr?.message });
      return "";
    }

    const configId = (botRow as { config_id: string }).config_id;
    const { data: cfg, error: cErr } = await this.client
      .from("configs")
      .select("current_version")
      .eq("id", configId)
      .maybeSingle();

    if (cErr !== null || cfg === null) {
      return "";
    }

    const version = Number((cfg as { current_version: number }).current_version);
    const bot = await this.getBot(trade.botId);
    if (bot === null) {
      return "";
    }

    const notional = Math.abs(trade.entryPrice * trade.quantity);
    const pnlPct = notional > 0 ? (trade.pnl / notional) * 100 : 0;
    const id = randomUUID();

    const { error } = await this.client.from("trades").insert({
      id,
      bot_id: trade.botId,
      config_id: configId,
      config_version: version,
      config_snapshot: bot.config as unknown as Record<string, unknown>,
      symbol: trade.symbol,
      side: trade.side,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice,
      quantity: trade.quantity,
      stop_loss: null,
      take_profit: null,
      pnl: trade.pnl,
      pnl_pct: pnlPct,
      entry_time: new Date(trade.entryTime).toISOString(),
      exit_time: new Date(trade.exitTime).toISOString(),
      exit_reason: trade.exitReason ?? "unknown",
      metadata: trade.rMultiple !== undefined ? { rMultiple: trade.rMultiple } : {}
    });

    if (error !== null) {
      this.logger.error("saveTrade failed", { error: error.message });
      return "";
    }

    return id;
  }

  public async getTrades(botId: string, days?: number): Promise<Trade[]> {
    const cutoffIso =
      days !== undefined
        ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

    let chain = this.client.from("trades").select("*").eq("bot_id", botId);
    if (cutoffIso !== undefined) {
      chain = chain.gte("exit_time", cutoffIso);
    }
    const { data, error } = await chain.order("exit_time", { ascending: false });

    if (error !== null) {
      this.logger.error("getTrades failed", { error: error.message });
      return [];
    }

    return (data ?? []).map((r) => this.mapTradeRow(r as Record<string, unknown>));
  }

  public async createOrder(order: Order): Promise<string> {
    const id = randomUUID();
    const { error } = await this.client.from("orders").insert({
      id,
      bot_id: order.botId,
      client_order_id: order.clientOrderId,
      exchange_order_id: order.exchangeOrderId ?? null,
      symbol: order.symbol,
      side: order.side,
      order_type: "MARKET",
      quantity: order.quantity,
      price: order.price ?? null,
      status: this.appOrderStatusToDb(order.status),
      filled_price: null,
      filled_at: order.filledAt !== undefined ? new Date(order.filledAt).toISOString() : null,
      created_at: new Date(order.createdAt).toISOString()
    });

    if (error !== null) {
      this.logger.error("createOrder failed", { error: error.message });
      return "";
    }

    return id;
  }

  public async updateOrderStatus(clientOrderId: string, status: OrderStatus): Promise<void> {
    const { error } = await this.client
      .from("orders")
      .update({
        status: this.appOrderStatusToDb(status),
        updated_at: new Date().toISOString()
      })
      .eq("client_order_id", clientOrderId);

    if (error !== null) {
      this.logger.error("updateOrderStatus failed", { error: error.message, clientOrderId });
    }
  }

  public async getOrder(clientOrderId: string): Promise<Order | null> {
    const { data, error } = await this.client
      .from("orders")
      .select("*")
      .eq("client_order_id", clientOrderId)
      .maybeSingle();

    if (error !== null || data === null) {
      return null;
    }

    return this.mapOrderRow(data as Record<string, unknown>);
  }

  public async getAllOpenPositions(): Promise<Position[]> {
    const { data, error } = await this.client.from("positions").select("*");

    if (error !== null) {
      this.logger.error("getAllOpenPositions failed", { error: error.message });
      return [];
    }

    return (data ?? []).map((row) => this.mapPositionRow(row as Record<string, unknown>));
  }

  public async getDailyPnL(botId: string, date: string): Promise<number> {
    const range = this.getDateRangeMs(date);
    if (range === null) {
      return 0;
    }

    const { data, error } = await this.client
      .from("trades")
      .select("pnl")
      .eq("bot_id", botId)
      .gte("exit_time", new Date(range.start).toISOString())
      .lt("exit_time", new Date(range.end).toISOString());

    if (error !== null) {
      this.logger.error("getDailyPnL failed", { error: error.message });
      return 0;
    }

    let sum = 0;
    for (const row of data ?? []) {
      const pnl = Number((row as { pnl: number }).pnl);
      if (Number.isFinite(pnl)) {
        sum += pnl;
      }
    }

    return sum;
  }

  public async backup(): Promise<void> {
    this.logger.info("backup() is a no-op for Supabase (use platform backups).", {
      event: "backup_skip"
    });
  }

  private async fetchBotJoin(id: string): Promise<Bot | null> {
    const { data, error } = await this.client
      .from("bots")
      .select(
        `
        id,
        config_id,
        status,
        equity,
        last_heartbeat,
        created_at,
        configs (*)
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (error !== null || data === null) {
      return null;
    }

    return this.mapJoinRowToBot(data as BotsJoinRow);
  }

  private mapJoinRowToBot(row: BotsJoinRow): Bot | null {
    const cfg = Array.isArray(row.configs) ? row.configs[0] : row.configs;
    if (cfg === null || cfg === undefined) {
      return null;
    }

    const config = configRowToBotConfig(cfg as ConfigRow);
    const equity = row.equity !== null && row.equity !== undefined ? Number(row.equity) : config.initialBalance;
    const createdAt = this.parseTs(row.created_at);
    const hb = row.last_heartbeat !== null ? this.parseTs(row.last_heartbeat) : undefined;

    return {
      id: row.id,
      configId: row.config_id,
      name: config.name,
      strategy: config.strategy,
      initialBalance: config.initialBalance,
      currentEquity: Number.isFinite(equity) ? equity : config.initialBalance,
      status: row.status as BotStatus,
      config,
      createdAt,
      ...(hb !== undefined ? { lastHeartbeat: hb } : {})
    };
  }

  private mapPositionRow(row: Record<string, unknown>): Position {
    const slRaw = row["stop_loss"];
    const tpRaw = row["take_profit"];
    const base: Position = {
      id: String(row["id"]),
      botId: String(row["bot_id"]),
      symbol: String(row["symbol"]),
      side: row["side"] as PositionSide,
      quantity: Number(row["quantity"]),
      entryPrice: Number(row["entry_price"]),
      entryTime: this.parseTs(row["entry_time"])
    };
    return {
      ...base,
      ...(slRaw !== null && slRaw !== undefined ? { stopLoss: Number(slRaw) } : {}),
      ...(tpRaw !== null && tpRaw !== undefined ? { takeProfit: Number(tpRaw) } : {})
    };
  }

  private mapTradeRow(row: Record<string, unknown>): Trade {
    const meta = row["metadata"] as Record<string, unknown> | null | undefined;
    const rMult =
      meta !== undefined && meta !== null && typeof meta["rMultiple"] === "number"
        ? meta["rMultiple"]
        : undefined;

    const ex = row["exit_reason"];
    const base: Trade = {
      id: String(row["id"]),
      botId: String(row["bot_id"]),
      symbol: String(row["symbol"]),
      side: row["side"] as PositionSide,
      quantity: Number(row["quantity"]),
      entryPrice: Number(row["entry_price"]),
      exitPrice: Number(row["exit_price"]),
      pnl: Number(row["pnl"]),
      entryTime: this.parseTs(row["entry_time"]),
      exitTime: this.parseTs(row["exit_time"])
    };
    return {
      ...base,
      ...(rMult !== undefined ? { rMultiple: rMult } : {}),
      ...(ex !== null && ex !== undefined ? { exitReason: String(ex) } : {})
    };
  }

  private mapOrderRow(row: Record<string, unknown>): Order {
    const filled = row["filled_at"];
    const ex = row["exchange_order_id"];
    const pr = row["price"];
    const base: Order = {
      id: String(row["id"]),
      botId: String(row["bot_id"]),
      clientOrderId: String(row["client_order_id"]),
      symbol: String(row["symbol"]),
      side: row["side"] as PositionSide,
      quantity: Number(row["quantity"]),
      status: this.dbOrderStatusToApp(String(row["status"])),
      createdAt: this.parseTs(row["created_at"])
    };
    return {
      ...base,
      ...(ex !== null && ex !== undefined ? { exchangeOrderId: String(ex) } : {}),
      ...(pr !== null && pr !== undefined ? { price: Number(pr) } : {}),
      ...(filled !== null && filled !== undefined ? { filledAt: this.parseTs(filled) } : {})
    };
  }

  private appOrderStatusToDb(status: OrderStatus): string {
    switch (status) {
      case "FILLED":
        return "filled";
      case "CANCELED":
        return "cancelled";
      case "REJECTED":
        return "failed";
      default:
        return "pending";
    }
  }

  private dbOrderStatusToApp(status: string): OrderStatus {
    switch (status) {
      case "filled":
        return "FILLED";
      case "cancelled":
        return "CANCELED";
      case "failed":
        return "REJECTED";
      default:
        return "NEW";
    }
  }

  private computeRMultiple(
    side: PositionSide,
    entryPrice: number,
    exitPrice: number,
    stopLoss: unknown
  ): number | undefined {
    if (stopLoss === null || stopLoss === undefined) {
      return undefined;
    }

    const sl = Number(stopLoss);
    if (!Number.isFinite(sl)) {
      return undefined;
    }

    const risk = side === "LONG" ? entryPrice - sl : sl - entryPrice;
    if (risk <= 0) {
      return undefined;
    }

    const reward = side === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;
    return reward / risk;
  }

  private getDateRangeMs(date: string): { start: number; end: number } | null {
    const parts = date.split("-");
    if (parts.length !== 3) {
      return null;
    }

    const yearRaw = parts[0];
    const monthRaw = parts[1];
    const dayRaw = parts[2];
    if (yearRaw === undefined || monthRaw === undefined || dayRaw === undefined) {
      return null;
    }

    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }

    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

    return { start: start.getTime(), end: end.getTime() };
  }

  private parseTs(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : Date.now();
    }
    return Date.now();
  }
}
