import type { SupabaseClient } from "../supabase/client.js";
import type { Database } from "../supabase/database.js";

type LivePositionRow = Database["public"]["Tables"]["live_positions"]["Row"];
type LivePositionInsert = Database["public"]["Tables"]["live_positions"]["Insert"];
type LivePositionUpdate = Database["public"]["Tables"]["live_positions"]["Update"];
type LiveOrderRow = Database["public"]["Tables"]["live_orders"]["Row"];
type LiveTradeInsert = Database["public"]["Tables"]["live_trades"]["Insert"];

type CreatePositionArgs = Readonly<{
  botId: string;
  exchange: string;
  symbol: string;
  direction: "long" | "short";
  entryOrderId: string | null;
  entryTime: string;
  entryPrice: number;
  quantity: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  trailingStopPrice: number | null;
  riskAmount: number | null;
  sessionDateNy: string;
}>;

/**
 * Manages live positions and trade archival for a bot.
 */
export class PositionManager {
  private readonly supabase: SupabaseClient;

  /**
   * Creates a new position manager.
   */
  public constructor(args: Readonly<{ supabase: SupabaseClient }>) {
    this.supabase = args.supabase;
  }

  /**
   * Creates a new open position in the database.
   */
  public async createPosition(args: CreatePositionArgs): Promise<LivePositionRow> {
    const payload: LivePositionInsert = {
      bot_id: args.botId,
      exchange: args.exchange,
      symbol: args.symbol,
      direction: args.direction,
      status: "open",
      entry_order_id: args.entryOrderId,
      entry_time: args.entryTime,
      entry_price: args.entryPrice,
      quantity: args.quantity,
      stop_loss_price: args.stopLossPrice,
      take_profit_price: args.takeProfitPrice,
      trailing_stop_price: args.trailingStopPrice,
      stop_order_id: null,
      tp_order_id: null,
      current_price: args.entryPrice,
      unrealized_pnl: 0,
      realized_pnl: 0,
      fee_total: 0,
      risk_amount: args.riskAmount,
      r_multiple: null,
      session_date_ny: args.sessionDateNy,
      closed_at: null,
      exit_reason: null
    };

    const result = await this.supabase.from("live_positions").insert(payload).select("*").single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error("Failed to create live position");
    }
    return result.data as LivePositionRow;
  }

  /**
   * Loads open positions for a bot.
   */
  public async getOpenPositions(botId: string): Promise<readonly LivePositionRow[]> {
    const result = await this.supabase.from("live_positions").select("*").eq("bot_id", botId).eq("status", "open");
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error("Failed to load live positions");
    }
    return result.data as LivePositionRow[];
  }

  /**
   * Updates a position record.
   */
  public async updatePosition(positionId: string, updates: LivePositionUpdate): Promise<void> {
    const result = await this.supabase.from("live_positions").update(updates).eq("id", positionId);
    if (result.error !== null) {
      throw result.error;
    }
  }

  /**
   * Closes a position and archives a trade record.
   */
  public async closePosition(args: Readonly<{
    positionId: string;
    exitOrder: LiveOrderRow;
    exitReason: string;
  }>): Promise<Database["public"]["Tables"]["live_trades"]["Row"]> {
    const position = await this.getPositionById(args.positionId);

    const exitPrice = this.toNumber(args.exitOrder.avg_fill_price ?? args.exitOrder.price, "exitPrice");
    const entryPrice = this.toNumber(position.entry_price, "entryPrice");
    const quantity = this.toNumber(position.quantity, "quantity");
    const feeTotal = this.sumFees([args.exitOrder.fee_paid]);
    const direction = position.direction as "long" | "short";
    const pnl = this.calculatePnl(direction, entryPrice, exitPrice, quantity) - feeTotal;
    const riskAmount = this.toOptionalNumber(position.risk_amount);
    const rMultiple = riskAmount !== null && riskAmount !== 0 ? pnl / riskAmount : null;

    await this.updatePosition(position.id, {
      status: "closed",
      closed_at: new Date().toISOString(),
      exit_reason: args.exitReason,
      realized_pnl: pnl,
      fee_total: feeTotal,
      r_multiple: rMultiple
    });

    return this.archiveToTrade({
      position,
      exitOrder: args.exitOrder,
      exitPrice,
      pnl,
      rMultiple
    });
  }

  /**
   * Calculates unrealized PnL for a position at a given price.
   */
  public calculateUnrealizedPnL(position: LivePositionRow, currentPrice: number): number {
    const entryPrice = this.toNumber(position.entry_price, "entryPrice");
    const quantity = this.toNumber(position.quantity, "quantity");
    return position.direction === "long"
      ? (currentPrice - entryPrice) * quantity
      : (entryPrice - currentPrice) * quantity;
  }

  /**
   * Archives a closed position into live_trades.
   */
  public async archiveToTrade(args: Readonly<{
    position: LivePositionRow;
    exitOrder: LiveOrderRow;
    exitPrice: number;
    pnl: number;
    rMultiple: number | null;
  }>): Promise<Database["public"]["Tables"]["live_trades"]["Row"]> {
    const entryPrice = this.toNumber(args.position.entry_price, "entryPrice");
    const quantity = this.toNumber(args.position.quantity, "quantity");
    const entryTime = args.position.entry_time;
    const exitTime = args.exitOrder.filled_at ?? new Date().toISOString();
    const feeTotal = this.sumFees([args.exitOrder.fee_paid]);

    const payload: LiveTradeInsert = {
      bot_id: args.position.bot_id,
      position_id: args.position.id,
      exchange: args.position.exchange,
      symbol: args.position.symbol,
      direction: args.position.direction,
      entry_time: entryTime,
      entry_price: entryPrice,
      exit_time: exitTime,
      exit_price: args.exitPrice,
      quantity,
      fee_total: feeTotal,
      pnl: args.pnl,
      r_multiple: args.rMultiple,
      exit_reason: args.position.exit_reason ?? "unknown",
      session_date_ny: args.position.session_date_ny,
      entry_order_id: args.position.entry_order_id,
      exit_order_id: args.exitOrder.id,
      max_favorable_excursion: null,
      max_adverse_excursion: null
    };

    const result = await this.supabase.from("live_trades").insert(payload).select("*").single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error("Failed to archive live trade");
    }
    return result.data as Database["public"]["Tables"]["live_trades"]["Row"];
  }

  private async getPositionById(positionId: string): Promise<LivePositionRow> {
    const result = await this.supabase.from("live_positions").select("*").eq("id", positionId).single();
    if (result.error !== null || result.data === null) {
      throw result.error ?? new Error(`Position not found: ${positionId}`);
    }
    return result.data as LivePositionRow;
  }

  private calculatePnl(direction: "long" | "short", entryPrice: number, exitPrice: number, quantity: number): number {
    return direction === "long" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
  }

  private toNumber(value: unknown, label: string): number {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`${label} must be a finite number`);
    }
    return Number(parsed);
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Number(parsed);
  }

  private sumFees(values: readonly unknown[]): number {
    return values.reduce((sum: number, value) => {
      const parsed = this.toOptionalNumber(value);
      return parsed === null ? sum : sum + parsed;
    }, 0 as number);
  }
}
