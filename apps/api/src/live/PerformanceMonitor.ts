import { DateTime } from "luxon";
import { z } from "zod";

import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { SupabaseClient } from "../supabase/client.js";
import type { Database } from "../supabase/database.js";

import type { Bot } from "./botRepo.js";
import { getBotById } from "./botRepo.js";

export type AccountSnapshot = Database["public"]["Tables"]["account_snapshots"]["Row"];

export type PerformanceReport = Readonly<{
  totalPnl: number;
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number | null;
  averageRMultiple: number | null;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
  tradeCount: number;
  averageTradeDurationMinutes: number | null;
}>;

export type EquityPoint = Readonly<{
  timestamp: string;
  equity: number;
}>;

export type HealthStatus = Readonly<{
  healthy: boolean;
  issues: string[];
}>;

type AccountSnapshotInsert = Database["public"]["Tables"]["account_snapshots"]["Insert"];

type BotLogLevel = "debug" | "info" | "warn" | "error" | "critical";

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const tradeRowSchema = z.object({
  id: z.string().min(1),
  entry_time: z.string().min(1),
  exit_time: z.string().min(1),
  pnl: numericSchema,
  r_multiple: nullableNumericSchema
});

const snapshotRowSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().min(1),
  equity: numericSchema,
  snapshot_type: z.string().min(1),
  daily_pnl: numericSchema,
  total_pnl_since_start: numericSchema
});


/**
 * Tracks and reports bot performance from live trades and snapshots.
 */
export class PerformanceMonitor {
  private readonly supabase: SupabaseClient;
  private readonly botId: string;
  private readonly exchange: string;
  private readonly adapter?: IExchangeAdapter;

  /**
   * Creates a performance monitor for a bot.
   */
  public constructor(args: Readonly<{
    supabase: SupabaseClient;
    botId: string;
    exchange: string;
    adapter?: IExchangeAdapter;
  }>) {
    this.supabase = args.supabase;
    this.botId = args.botId;
    this.exchange = args.exchange;
    if (args.adapter !== undefined) {
      this.adapter = args.adapter;
    }
  }

  /**
   * Captures a point-in-time account snapshot and persists to Supabase.
   *
   * Inputs:
   * - botId and snapshot type.
   *
   * Outputs:
   * - Inserted account snapshot row.
   *
   * Edge cases:
   * - If no session_start snapshot exists, daily PnL uses initial balance.
   *
   * Error behavior:
   * - Throws on DB or exchange errors.
   */
  public async captureSnapshot(
    botId: string,
    type: "periodic" | "session_start" | "session_end" | "manual"
  ): Promise<AccountSnapshot> {
    if (botId !== this.botId) {
      throw new Error(`Bot id mismatch for snapshot: ${botId}`);
    }
    if (this.adapter === undefined) {
      throw new Error("Exchange adapter is required to capture snapshots");
    }

    const bot = await this.loadBot();
    const balance = await this.adapter.getBalance();
    const position = await this.adapter.getPosition();
    const totalUnrealized = position === null ? 0 : position.unrealizedPnl;
    const equity = balance.total + totalUnrealized;

    const openPositionsCount = await this.countOpenPositions();
    const dailyPnl = await this.calculateDailyPnl(equity, bot.initialBalance);
    const totalPnlSinceStart = equity - bot.initialBalance;

    const payload: AccountSnapshotInsert = {
      bot_id: bot.id,
      exchange: this.exchange,
      balance: balance.total,
      equity,
      open_positions_count: openPositionsCount,
      total_unrealized_pnl: totalUnrealized,
      daily_pnl: dailyPnl,
      total_pnl_since_start: totalPnlSinceStart,
      snapshot_type: type
    };

    const result = await this.supabase.from("account_snapshots").insert(payload).select("*").single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error("Failed to insert account snapshot");
    }

    return result.data as AccountSnapshot;
  }

  /**
   * Calculates a performance report from trades over the last N days.
   *
   * Inputs:
   * - botId and number of days.
   *
   * Outputs:
   * - PerformanceReport metrics.
   *
   * Error behavior:
   * - Throws on DB or validation errors.
   */
  public async calculatePerformance(botId: string, days: number): Promise<PerformanceReport> {
    if (botId !== this.botId) {
      throw new Error(`Bot id mismatch for performance: ${botId}`);
    }

    const bot = await this.loadBot();
    const cutoff = DateTime.now().minus({ days }).toISO();
    const tradesResult = await this.supabase
      .from("live_trades")
      .select("id,entry_time,exit_time,pnl,r_multiple")
      .eq("bot_id", botId)
      .gte("exit_time", cutoff ?? "");

    if (tradesResult.error !== null) {
      throw tradesResult.error;
    }

    const trades = z.array(tradeRowSchema).parse(tradesResult.data ?? []);
    const tradeCount = trades.length;
    const totalPnl = trades.reduce((sum, trade) => sum + Number(trade.pnl), 0);
    const totalReturnPct = bot.initialBalance > 0 ? (totalPnl / bot.initialBalance) * 100 : 0;

    const winners = trades.filter((trade) => Number(trade.pnl) > 0);
    const losers = trades.filter((trade) => Number(trade.pnl) < 0);
    const winRatePct = tradeCount > 0 ? (winners.length / tradeCount) * 100 : 0;

    const grossProfit = winners.reduce((sum, trade) => sum + Number(trade.pnl), 0);
    const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + Number(trade.pnl), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

    const rValues = trades
      .map((trade) => (trade.r_multiple === null ? null : Number(trade.r_multiple)))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const averageRMultiple = rValues.length > 0 ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null;

    const maxDrawdownPct = this.calculateTradeDrawdownPct(trades, bot.initialBalance);
    const sharpeRatio = this.calculateSharpeRatio(trades, bot.initialBalance);
    const averageTradeDurationMinutes = this.calculateAverageTradeDurationMinutes(trades);

    return {
      totalPnl,
      totalReturnPct,
      winRatePct,
      profitFactor,
      averageRMultiple,
      maxDrawdownPct,
      sharpeRatio,
      tradeCount,
      averageTradeDurationMinutes
    };
  }

  /**
   * Returns equity curve data points for charting.
   *
   * Inputs:
   * - botId.
   *
   * Outputs:
   * - Array of timestamp/equity points.
   *
   * Error behavior:
   * - Throws on DB or validation errors.
   */
  public async getEquityCurve(botId: string): Promise<readonly EquityPoint[]> {
    if (botId !== this.botId) {
      throw new Error(`Bot id mismatch for equity curve: ${botId}`);
    }

    const result = await this.supabase
      .from("account_snapshots")
      .select("id,created_at,equity")
      .eq("bot_id", botId)
      .order("created_at", { ascending: true });

    if (result.error !== null) {
      throw result.error;
    }

    const rows = z.array(snapshotRowSchema.pick({ id: true, created_at: true, equity: true })).parse(result.data ?? []);
    return rows.map((row) => ({
      timestamp: row.created_at,
      equity: Number(row.equity)
    }));
  }

  /**
   * Checks bot health based on heartbeats, logs, status, and balance.
   *
   * Inputs:
   * - botId.
   *
   * Outputs:
   * - HealthStatus with issues list.
   *
   * Error behavior:
   * - Throws on DB or validation errors.
   */
  public async checkBotHealth(botId: string): Promise<HealthStatus> {
    if (botId !== this.botId) {
      throw new Error(`Bot id mismatch for health check: ${botId}`);
    }

    const bot = await this.loadBot();
    const issues: string[] = [];

    if (bot.status !== "running") {
      issues.push(`Bot status is ${bot.status}`);
    }

    const lastHeartbeat = bot.lastHeartbeatAt === null ? null : Date.parse(bot.lastHeartbeatAt);
    if (lastHeartbeat === null || Date.now() - lastHeartbeat > 2 * 60 * 1000) {
      issues.push("Last heartbeat is older than 2 minutes");
    }

    const errorCountLastHour = await this.countLogsSince("error", 60);
    if (errorCountLastHour >= 10) {
      issues.push("Error count exceeded 10 in last hour");
    }

    const criticalRecent = await this.countCriticalSince(30);
    if (criticalRecent > 0) {
      issues.push("Critical errors detected in last 30 minutes");
    }

    if (bot.initialBalance > 0 && bot.currentBalance <= bot.initialBalance * 0.5) {
      issues.push("Balance dropped more than 50% from initial");
    }

    return { healthy: issues.length === 0, issues };
  }

  private async loadBot(): Promise<Bot> {
    const bot = await getBotById({ supabase: this.supabase, id: this.botId });
    if (bot === null) {
      throw new Error(`Bot not found: ${this.botId}`);
    }
    return bot;
  }

  private async countOpenPositions(): Promise<number> {
    const result = await this.supabase
      .from("live_positions")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", this.botId)
      .in("status", ["open", "closing"]);

    if (result.error !== null) {
      throw result.error;
    }

    return result.count ?? 0;
  }

  private async calculateDailyPnl(equity: number, initialBalance: number): Promise<number> {
    const result = await this.supabase
      .from("account_snapshots")
      .select("id,created_at,equity,snapshot_type,daily_pnl,total_pnl_since_start")
      .eq("bot_id", this.botId)
      .eq("snapshot_type", "session_start")
      .order("created_at", { ascending: false })
      .limit(1);

    if (result.error !== null) {
      throw result.error;
    }

    const rows = z.array(snapshotRowSchema).parse(result.data ?? []);
    if (rows.length === 0) {
      return equity - initialBalance;
    }

    const sessionStartEquity = Number(rows[0]?.equity ?? initialBalance);
    return equity - sessionStartEquity;
  }

  private calculateTradeDrawdownPct(trades: readonly z.infer<typeof tradeRowSchema>[], initialBalance: number): number {
    let equity = initialBalance;
    let peak = initialBalance;
    let maxDrawdown = 0;

    for (const trade of trades) {
      equity += Number(trade.pnl);
      if (equity > peak) {
        peak = equity;
        continue;
      }
      if (peak > 0) {
        const drawdown = ((peak - equity) / peak) * 100;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    return maxDrawdown;
  }

  private calculateSharpeRatio(trades: readonly z.infer<typeof tradeRowSchema>[], initialBalance: number): number | null {
    if (trades.length < 10 || initialBalance <= 0) {
      return null;
    }

    const returns = trades.map((trade) => Number(trade.pnl) / initialBalance);
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
      returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, returns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) {
      return null;
    }
    return (mean / stdDev) * Math.sqrt(returns.length);
  }

  private calculateAverageTradeDurationMinutes(trades: readonly z.infer<typeof tradeRowSchema>[]): number | null {
    if (trades.length === 0) {
      return null;
    }
    const durations = trades.map((trade) => {
      const entry = Date.parse(trade.entry_time);
      const exit = Date.parse(trade.exit_time);
      if (!Number.isFinite(entry) || !Number.isFinite(exit)) {
        return null;
      }
      return (exit - entry) / 60000;
    });
    const valid = durations.filter((value): value is number => value !== null && Number.isFinite(value));
    if (valid.length === 0) {
      return null;
    }
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  private async countLogsSince(level: BotLogLevel, minutes: number): Promise<number> {
    const since = DateTime.now().minus({ minutes }).toISO();
    const result = await this.supabase
      .from("bot_logs")
      .select("id,created_at,level", { count: "exact", head: true })
      .eq("bot_id", this.botId)
      .eq("level", level)
      .gte("created_at", since ?? "");

    if (result.error !== null) {
      throw result.error;
    }

    return result.count ?? 0;
  }

  private async countCriticalSince(minutes: number): Promise<number> {
    const since = DateTime.now().minus({ minutes }).toISO();
    const result = await this.supabase
      .from("bot_logs")
      .select("id,created_at,level", { count: "exact", head: true })
      .eq("bot_id", this.botId)
      .eq("level", "critical")
      .gte("created_at", since ?? "");

    if (result.error !== null) {
      throw result.error;
    }

    return result.count ?? 0;
  }
}
