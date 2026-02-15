import { DateTime } from "luxon";
import { z } from "zod";

import type { IExchangeAdapter } from "../exchange/IExchangeAdapter.js";
import type { StrategyParams } from "../domain/strategyParams.js";
import type { Signal } from "../strategy/types.js";
import type { SupabaseClient } from "../supabase/client.js";
import type { Database } from "../supabase/database.js";

import type { Bot } from "./botRepo.js";
import { getBotById } from "./botRepo.js";

export type RiskCheckResult = Readonly<{
  allowed: boolean;
  reason?: string;
}>;

export type DailyLossStatus = Readonly<{
  exceeded: boolean;
  currentLossPct: number;
  limit: number;
}>;

export type RiskMetrics = Readonly<{
  totalPositionValue: number;
  totalRiskAmount: number;
  riskPctOfEquity: number;
  openPositionsCount: number;
  dailyPnl: number;
  maxDrawdownPct: number;
}>;

export type PositionSizeParams = Readonly<{
  sizingMode: StrategyParams["risk"]["sizingMode"];
  entryPrice: number;
  stopLossPrice: number;
  equity: number;
  availableBalance: number;
  riskPctPerTrade: number;
  fixedNotional: number;
  maxPositionSizePct: number;
  minSize?: number;
  maxSize?: number;
  stepSize?: number;
}>;

type LivePositionRow = Database["public"]["Tables"]["live_positions"]["Row"];
type LiveTradeRow = Database["public"]["Tables"]["live_trades"]["Row"];
type AccountSnapshotRow = Database["public"]["Tables"]["account_snapshots"]["Row"];

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const positionRowSchema = z.object({
  id: z.string().min(1),
  bot_id: z.string().min(1),
  symbol: z.string().min(1),
  status: z.string().min(1),
  entry_price: numericSchema,
  current_price: nullableNumericSchema,
  quantity: numericSchema,
  risk_amount: nullableNumericSchema
});

const tradeRowSchema = z.object({
  id: z.string().min(1),
  pnl: numericSchema,
  session_date_ny: z.string().min(1)
});

const snapshotRowSchema = z.object({
  id: z.string().min(1),
  equity: numericSchema,
  created_at: z.string().min(1)
});

/**
 * Enforces pre-trade risk rules and provides risk metrics.
 */
export class RiskManager {
  private readonly supabase: SupabaseClient;
  private readonly adapter: IExchangeAdapter;
  private readonly botId: string;
  private readonly params: StrategyParams;
  private readonly maxOpenPositions: number;

  /**
   * Creates a risk manager for a bot.
   */
  public constructor(args: Readonly<{
    supabase: SupabaseClient;
    adapter: IExchangeAdapter;
    botId: string;
    params: StrategyParams;
    maxOpenPositions?: number;
  }>) {
    this.supabase = args.supabase;
    this.adapter = args.adapter;
    this.botId = args.botId;
    this.params = args.params;
    this.maxOpenPositions = args.maxOpenPositions ?? 1;
  }

  /**
   * Runs pre-trade risk checks before allowing an entry order.
   *
   * Inputs:
   * - botId: target bot id (validated against instance).
   * - signal: strategy signal containing entry price and quantity.
   *
   * Outputs:
   * - RiskCheckResult (allowed + reason if blocked).
   *
   * Edge cases:
   * - Missing price/quantity yields a rejection.
   *
   * Error behavior:
   * - Throws on DB or exchange errors.
   */
  public async checkPreTradeRisk(botId: string, signal: Signal): Promise<RiskCheckResult> {
    if (botId !== this.botId) {
      return { allowed: false, reason: "Bot id mismatch for risk check" };
    }

    if (signal.type !== "ENTRY_LONG" && signal.type !== "ENTRY_SHORT") {
      return { allowed: true };
    }

    const bot = await this.loadBot();
    const symbolResult = this.validateSymbol(bot);
    if (!symbolResult.allowed) {
      return symbolResult;
    }

    const sessionResult = this.validateSessionWindow();
    if (!sessionResult.allowed) {
      return sessionResult;
    }

    const dailyLoss = await this.checkDailyLoss(botId);
    if (dailyLoss.exceeded) {
      return {
        allowed: false,
        reason: `Daily loss limit exceeded (${dailyLoss.currentLossPct.toFixed(2)}% <= -${dailyLoss.limit}%)`
      };
    }

    const openPositionsCount = await this.countOpenPositions(botId);
    if (openPositionsCount >= this.maxOpenPositions) {
      return { allowed: false, reason: "Max open positions reached" };
    }

    const price = signal.price;
    const quantity = signal.quantity;
    if (price === null || quantity === null) {
      return { allowed: false, reason: "Missing entry price or quantity for risk validation" };
    }

    const sizeResult = this.validatePositionSize(bot, price, quantity);
    if (!sizeResult.allowed) {
      return sizeResult;
    }

    const balanceResult = await this.validateBalance(bot, price, quantity);
    if (!balanceResult.allowed) {
      return balanceResult;
    }

    return { allowed: true };
  }

  /**
   * Calculates a position size based on sizing mode and risk constraints.
   *
   * Inputs:
   * - PositionSizeParams with sizing configuration and balances.
   *
   * Outputs:
   * - Position size (quantity).
   *
   * Edge cases:
   * - Invalid or non-positive inputs return 0.
   *
   * Error behavior:
   * - Throws on invalid numeric inputs.
   */
  public calculatePositionSize(params: PositionSizeParams): number {
    const normalized = this.normalizeSizingParams(params);
    if (normalized === null) {
      return 0;
    }

    const rawQuantity = this.calculateBaseQuantity(normalized);
    const capped = this.applyRiskCaps(rawQuantity, normalized);
    const final = this.applyExchangeLimits(capped, params);
    
    // CRITICAL SAFETY CHECK: Verify position notional vs balance
    const positionNotional = final * normalized.entryPrice;
    const maxAllowedNotional = normalized.equity * 10; // Max 10x of balance (for leveraged futures)
    
    if (positionNotional > maxAllowedNotional) {
      console.warn(
        `[RiskManager] Position size rejected: notional=${positionNotional.toFixed(2)}, ` +
        `max=${maxAllowedNotional.toFixed(2)}, balance=${normalized.equity.toFixed(2)}`
      );
      return 0;
    }
    
    return final;
  }

  /**
   * Checks the daily loss percentage vs configured limit.
   *
   * Inputs:
   * - botId.
   *
   * Outputs:
   * - DailyLossStatus with current loss percent and limit.
   *
   * Edge cases:
   * - No trades today returns 0% loss.
   *
   * Error behavior:
   * - Throws on DB or validation errors.
   */
  public async checkDailyLoss(botId: string): Promise<DailyLossStatus> {
    const bot = await this.loadBot();
    if (bot.id !== botId) {
      throw new Error(`Bot id mismatch for daily loss check: ${botId}`);
    }

    const todayNy = DateTime.now().setZone("America/New_York").toISODate();
    if (todayNy === null) {
      return { exceeded: false, currentLossPct: 0, limit: bot.maxDailyLossPct };
    }

    const trades = await this.supabase
      .from("live_trades")
      .select("id,pnl,session_date_ny")
      .eq("bot_id", botId)
      .eq("session_date_ny", todayNy);

    if (trades.error !== null) {
      throw trades.error;
    }

    const rows = z.array(tradeRowSchema).parse(trades.data ?? []);
    const todayPnl = rows.reduce((sum, row) => sum + Number(row.pnl), 0);
    const dailyLossPct = bot.initialBalance > 0 ? (todayPnl / bot.initialBalance) * 100 : 0;
    const exceeded = dailyLossPct < -bot.maxDailyLossPct;

    return {
      exceeded,
      currentLossPct: dailyLossPct,
      limit: bot.maxDailyLossPct
    };
  }

  /**
   * Computes current risk exposure metrics for a bot.
   *
   * Inputs:
   * - botId.
   *
   * Outputs:
   * - RiskMetrics including drawdown and daily PnL.
   *
   * Error behavior:
   * - Throws on DB or validation errors.
   */
  public async calculateRiskMetrics(botId: string): Promise<RiskMetrics> {
    const bot = await this.loadBot();
    if (bot.id !== botId) {
      throw new Error(`Bot id mismatch for risk metrics: ${botId}`);
    }

    const positionsResult = await this.supabase
      .from("live_positions")
      .select("id,bot_id,symbol,status,entry_price,current_price,quantity,risk_amount")
      .eq("bot_id", botId)
      .in("status", ["open", "closing"]);

    if (positionsResult.error !== null) {
      throw positionsResult.error;
    }

    const positions = z.array(positionRowSchema).parse(positionsResult.data ?? []);
    const totalPositionValue = positions.reduce((sum, row) => {
      const price = row.current_price === null ? Number(row.entry_price) : Number(row.current_price);
      return sum + price * Number(row.quantity);
    }, 0);
    const totalRiskAmount = positions.reduce((sum, row) => sum + (row.risk_amount === null ? 0 : Number(row.risk_amount)), 0);
    const riskPctOfEquity = bot.currentEquity > 0 ? (totalRiskAmount / bot.currentEquity) * 100 : 0;

    const todayNy = DateTime.now().setZone("America/New_York").toISODate();
    const tradesResult = await this.supabase
      .from("live_trades")
      .select("id,pnl,session_date_ny")
      .eq("bot_id", botId)
      .eq("session_date_ny", todayNy ?? "");
    if (tradesResult.error !== null) {
      throw tradesResult.error;
    }
    const trades = z.array(tradeRowSchema).parse(tradesResult.data ?? []);
    const dailyPnl = trades.reduce((sum, row) => sum + Number(row.pnl), 0);

    const snapshotsResult = await this.supabase
      .from("account_snapshots")
      .select("id,equity,created_at")
      .eq("bot_id", botId)
      .order("created_at", { ascending: true });

    if (snapshotsResult.error !== null) {
      throw snapshotsResult.error;
    }

    const snapshots = z.array(snapshotRowSchema).parse(snapshotsResult.data ?? []);
    const maxDrawdownPct = this.calculateMaxDrawdownPct(snapshots.map((row) => Number(row.equity)), bot.initialBalance);

    return {
      totalPositionValue,
      totalRiskAmount,
      riskPctOfEquity,
      openPositionsCount: positions.length,
      dailyPnl,
      maxDrawdownPct
    };
  }

  private async loadBot(): Promise<Bot> {
    const bot = await getBotById({ supabase: this.supabase, id: this.botId });
    if (bot === null) {
      throw new Error(`Bot not found: ${this.botId}`);
    }
    return bot;
  }

  private validateSymbol(bot: Bot): RiskCheckResult {
    if (bot.symbol !== this.params.symbol) {
      return { allowed: false, reason: "Bot symbol does not match strategy params" };
    }
    return { allowed: true };
  }

  private validateSessionWindow(): RiskCheckResult {
    const timezone = this.params.session.timezone;
    const startTime = this.params.session.startTime;
    const endTime = this.params.risk.sessionEndTime;

    const now = DateTime.now().setZone(timezone);
    const start = DateTime.fromFormat(startTime, "HH:mm", { zone: timezone });
    const end = DateTime.fromFormat(endTime, "HH:mm", { zone: timezone });

    if (!start.isValid || !end.isValid) {
      return { allowed: true };
    }

    const startTs = now.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
    let endTs = now.set({ hour: end.hour, minute: end.minute, second: 0, millisecond: 0 });
    if (endTs <= startTs) {
      endTs = endTs.plus({ days: 1 });
    }

    if (now < startTs || now > endTs) {
      return { allowed: false, reason: "Outside configured trading session window" };
    }

    return { allowed: true };
  }

  private async countOpenPositions(botId: string): Promise<number> {
    const result = await this.supabase
      .from("live_positions")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .in("status", ["open", "closing"]);

    if (result.error !== null) {
      throw result.error;
    }

    return result.count ?? 0;
  }

  private validatePositionSize(bot: Bot, price: number, quantity: number): RiskCheckResult {
    if (bot.currentEquity <= 0) {
      return { allowed: false, reason: "Bot equity is non-positive" };
    }

    const positionValue = price * quantity;
    const positionPct = (positionValue / bot.currentEquity) * 100;
    if (positionPct > bot.maxPositionSizePct) {
      return { allowed: false, reason: "Position size exceeds max position size percent" };
    }

    return { allowed: true };
  }

  private async validateBalance(bot: Bot, price: number, quantity: number): Promise<RiskCheckResult> {
    const balance = await this.adapter.getBalance();
    const required = this.calculateRequiredCapital(price, quantity);
    if (balance.available < required) {
      return { allowed: false, reason: "Insufficient available balance for trade" };
    }
    return { allowed: true };
  }

  private calculateRequiredCapital(price: number, quantity: number): number {
    const notional = price * quantity;
    const fees = notional * (this.params.execution.feeBps / 10000) * 2;
    const buffer = notional * 0.05;
    return notional + fees + buffer;
  }

  private calculateMaxDrawdownPct(equities: readonly number[], initialBalance: number): number {
    const seed = Math.max(0, initialBalance);
    let peak = seed;
    let maxDrawdown = 0;

    for (const equity of equities) {
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

  private assertFinite(value: number, label: string): number {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite number`);
    }
    return value;
  }

  private roundDownToStep(value: number, step: number): number {
    if (step <= 0) {
      return value;
    }
    return Math.floor(value / step) * step;
  }

  private normalizeSizingParams(params: PositionSizeParams): Readonly<{
    sizingMode: StrategyParams["risk"]["sizingMode"];
    entryPrice: number;
    stopLossPrice: number;
    equity: number;
    availableBalance: number;
    riskPct: number;
    fixedNotional: number;
    maxPositionPct: number;
  }> | null {
    const entryPrice = this.assertFinite(params.entryPrice, "entryPrice");
    const stopLossPrice = this.assertFinite(params.stopLossPrice, "stopLossPrice");
    const equity = this.assertFinite(params.equity, "equity");
    const availableBalance = this.assertFinite(params.availableBalance, "availableBalance");
    const riskPct = this.assertFinite(params.riskPctPerTrade, "riskPctPerTrade");
    const fixedNotional = this.assertFinite(params.fixedNotional, "fixedNotional");
    const maxPositionPct = this.assertFinite(params.maxPositionSizePct, "maxPositionSizePct");

    if (entryPrice <= 0 || equity <= 0 || availableBalance <= 0) {
      return null;
    }

    return {
      sizingMode: params.sizingMode,
      entryPrice,
      stopLossPrice,
      equity,
      availableBalance,
      riskPct,
      fixedNotional,
      maxPositionPct
    };
  }

  private calculateBaseQuantity(
    params: Readonly<{
      sizingMode: StrategyParams["risk"]["sizingMode"];
      entryPrice: number;
      stopLossPrice: number;
      equity: number;
      riskPct: number;
      fixedNotional: number;
    }>
  ): number {
    if (params.sizingMode === "fixed_notional") {
      return params.fixedNotional > 0 ? params.fixedNotional / params.entryPrice : 0;
    }

    const riskAmount = params.equity * (params.riskPct / 100);
    const riskPerUnit = Math.abs(params.entryPrice - params.stopLossPrice);
    return riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
  }

  private applyRiskCaps(
    rawQuantity: number,
    params: Readonly<{
      entryPrice: number;
      equity: number;
      availableBalance: number;
      maxPositionPct: number;
    }>
  ): number {
    const maxNotional = params.equity * (params.maxPositionPct / 100);
    const maxByPct = maxNotional > 0 ? maxNotional / params.entryPrice : 0;
    const maxByBalance = params.availableBalance / params.entryPrice;
    return Math.min(rawQuantity, maxByPct, maxByBalance);
  }

  private applyExchangeLimits(quantity: number, params: PositionSizeParams): number {
    const maxSize = params.maxSize === undefined ? null : this.assertFinite(params.maxSize, "maxSize");
    const minSize = params.minSize === undefined ? null : this.assertFinite(params.minSize, "minSize");
    const stepSize = params.stepSize === undefined ? null : this.assertFinite(params.stepSize, "stepSize");

    let adjusted = quantity;
    if (maxSize !== null && adjusted > maxSize) {
      adjusted = maxSize;
    }
    if (stepSize !== null && stepSize > 0) {
      adjusted = this.roundDownToStep(adjusted, stepSize);
    }
    if (minSize !== null && adjusted < minSize) {
      return 0;
    }

    return Math.max(0, adjusted);
  }
}
