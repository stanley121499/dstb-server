import { DateTime } from "luxon";
import { z } from "zod";

import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { SupabaseClient } from "../supabase/client.js";

import type { Bot } from "./botRepo.js";
import { getBotById } from "./botRepo.js";

export type AlertSeverity = "info" | "warn" | "critical";

export type Alert = Readonly<{
  severity: AlertSeverity;
  code: string;
  message: string;
  context?: Readonly<Record<string, unknown>>;
}>;

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const tradeRowSchema = z.object({
  id: z.string().min(1),
  pnl: numericSchema,
  r_multiple: nullableNumericSchema,
  session_date_ny: z.string().min(1)
});

const positionRowSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  status: z.string().min(1)
});

/**
 * Detects alert conditions and records critical alerts.
 */
export class AlertManager {
  private readonly supabase: SupabaseClient;
  private readonly botId: string;
  private readonly adapter?: IExchangeAdapter;

  /**
   * Creates an alert manager for a bot.
   */
  public constructor(args: Readonly<{ supabase: SupabaseClient; botId: string; adapter?: IExchangeAdapter }>) {
    this.supabase = args.supabase;
    this.botId = args.botId;
    if (args.adapter !== undefined) {
      this.adapter = args.adapter;
    }
  }

  /**
   * Checks for alert conditions and returns any active alerts.
   *
   * Inputs:
   * - botId.
   *
   * Outputs:
   * - Array of alerts with severity and context.
   *
   * Error behavior:
   * - Throws on DB or validation errors.
   */
  public async checkAlerts(botId: string): Promise<readonly Alert[]> {
    if (botId !== this.botId) {
      throw new Error(`Bot id mismatch for alerts: ${botId}`);
    }

    const bot = await this.loadBot();
    const alerts: Alert[] = [];

    const dailyLoss = await this.checkDailyLoss(bot);
    if (dailyLoss) {
      alerts.push(dailyLoss);
    }

    const largeLoss = await this.checkLargeLossTrade();
    if (largeLoss) {
      alerts.push(largeLoss);
    }

    const heartbeatAlert = this.checkHeartbeat(bot);
    if (heartbeatAlert) {
      alerts.push(heartbeatAlert);
    }

    const errorAlert = await this.checkErrorRate();
    if (errorAlert) {
      alerts.push(errorAlert);
    }

    const unexpectedPosition = await this.checkUnexpectedPosition(bot);
    if (unexpectedPosition) {
      alerts.push(unexpectedPosition);
    }

    const balanceMismatch = await this.checkBalanceMismatch(bot);
    if (balanceMismatch) {
      alerts.push(balanceMismatch);
    }

    return alerts;
  }

  /**
   * Logs a critical alert to the bot_logs table.
   *
   * Inputs:
   * - botId and alert payload.
   *
   * Outputs:
   * - None.
   *
   * Error behavior:
   * - Throws on DB errors.
   */
  public async sendAlert(botId: string, alert: Alert): Promise<void> {
    if (botId !== this.botId) {
      throw new Error(`Bot id mismatch for alert send: ${botId}`);
    }

    const payload = {
      bot_id: this.botId,
      level: "critical",
      category: "system",
      message: alert.message,
      context: alert.context ?? {}
    };

    const result = await this.supabase.from("bot_logs").insert(payload);
    if (result.error !== null) {
      throw result.error;
    }
  }

  private async loadBot(): Promise<Bot> {
    const bot = await getBotById({ supabase: this.supabase, id: this.botId });
    if (bot === null) {
      throw new Error(`Bot not found: ${this.botId}`);
    }
    return bot;
  }

  private async checkDailyLoss(bot: Bot): Promise<Alert | null> {
    const todayNy = DateTime.now().setZone("America/New_York").toISODate();
    if (todayNy === null) {
      return null;
    }

    const tradesResult = await this.supabase
      .from("live_trades")
      .select("id,pnl,r_multiple,session_date_ny")
      .eq("bot_id", bot.id)
      .eq("session_date_ny", todayNy);

    if (tradesResult.error !== null) {
      throw tradesResult.error;
    }

    const trades = z.array(tradeRowSchema).parse(tradesResult.data ?? []);
    const todayPnl = trades.reduce((sum, trade) => sum + Number(trade.pnl), 0);
    const dailyLossPct = bot.initialBalance > 0 ? (todayPnl / bot.initialBalance) * 100 : 0;
    if (dailyLossPct < -bot.maxDailyLossPct) {
      return {
        severity: "critical",
        code: "DAILY_LOSS_LIMIT",
        message: `Daily loss limit hit (${dailyLossPct.toFixed(2)}% <= -${bot.maxDailyLossPct}%)`,
        context: { dailyLossPct, limit: bot.maxDailyLossPct }
      };
    }

    return null;
  }

  private async checkLargeLossTrade(): Promise<Alert | null> {
    const cutoff = DateTime.now().minus({ days: 1 }).toISO();
    const result = await this.supabase
      .from("live_trades")
      .select("id,pnl,r_multiple,session_date_ny")
      .eq("bot_id", this.botId)
      .gte("exit_time", cutoff ?? "")
      .order("exit_time", { ascending: false })
      .limit(50);

    if (result.error !== null) {
      throw result.error;
    }

    const trades = z.array(tradeRowSchema).parse(result.data ?? []);
    const trade = trades.find((row) => row.r_multiple !== null && Number(row.r_multiple) <= -3);
    if (trade === undefined) {
      return null;
    }

    return {
      severity: "warn",
      code: "LARGE_LOSS_TRADE",
      message: "Large loss detected on single trade (> 3R)",
      context: { tradeId: trade.id, rMultiple: trade.r_multiple, pnl: trade.pnl }
    };
  }

  private checkHeartbeat(bot: Bot): Alert | null {
    const lastHeartbeat = bot.lastHeartbeatAt === null ? null : Date.parse(bot.lastHeartbeatAt);
    if (lastHeartbeat === null || Date.now() - lastHeartbeat > 2 * 60 * 1000) {
      return {
        severity: "critical",
        code: "HEARTBEAT_STALE",
        message: "Bot heartbeat stale for more than 2 minutes",
        context: { lastHeartbeatAt: bot.lastHeartbeatAt }
      };
    }
    return null;
  }

  private async checkErrorRate(): Promise<Alert | null> {
    const since = DateTime.now().minus({ hours: 1 }).toISO();
    const result = await this.supabase
      .from("bot_logs")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", this.botId)
      .in("level", ["error", "critical"])
      .gte("created_at", since ?? "");

    if (result.error !== null) {
      throw result.error;
    }

    const count = result.count ?? 0;
    if (count > 10) {
      return {
        severity: "warn",
        code: "ERROR_RATE_HIGH",
        message: "Error count exceeded 10 in the last hour",
        context: { count }
      };
    }

    return null;
  }

  private async checkUnexpectedPosition(bot: Bot): Promise<Alert | null> {
    const result = await this.supabase
      .from("live_positions")
      .select("id,symbol,status")
      .eq("bot_id", bot.id)
      .eq("status", "open");

    if (result.error !== null) {
      throw result.error;
    }

    const positions = z.array(positionRowSchema).parse(result.data ?? []);
    const unexpected = positions.find((row) => row.symbol !== bot.symbol);
    if (unexpected === undefined) {
      return null;
    }

    return {
      severity: "warn",
      code: "UNEXPECTED_POSITION",
      message: "Unexpected open position detected",
      context: { positionId: unexpected.id, symbol: unexpected.symbol }
    };
  }

  private async checkBalanceMismatch(bot: Bot): Promise<Alert | null> {
    if (this.adapter === undefined) {
      return null;
    }

    const balance = await this.adapter.getBalance();
    const diff = Math.abs(balance.total - bot.currentBalance);
    const pct = bot.currentBalance > 0 ? (diff / bot.currentBalance) * 100 : 0;

    if (pct > 2) {
      return {
        severity: "warn",
        code: "BALANCE_MISMATCH",
        message: "Balance mismatch between exchange and DB",
        context: { exchangeBalance: balance.total, dbBalance: bot.currentBalance, diffPct: pct }
      };
    }

    return null;
  }
}
