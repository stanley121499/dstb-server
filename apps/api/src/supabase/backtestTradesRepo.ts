import { z } from "zod";

import type { Trade } from "../domain/dtos.js";
import { notFoundError } from "../http/apiError.js";
import type { Pagination } from "../http/pagination.js";
import type { SupabaseClient } from "./client.js";

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const tradeRowSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  session_date_ny: z.string().min(1),
  direction: z.union([z.literal("long"), z.literal("short")]),
  entry_time_utc: z.string().min(1),
  entry_price: numericSchema,
  exit_time_utc: z.string().min(1),
  exit_price: numericSchema,
  quantity: numericSchema,
  fee_total: numericSchema,
  pnl: numericSchema,
  r_multiple: nullableNumericSchema,
  exit_reason: z.union([
    z.literal("stop"),
    z.literal("take_profit"),
    z.literal("time_exit"),
    z.literal("session_end"),
    z.literal("manual")
  ])
});

type TradeRow = z.infer<typeof tradeRowSchema>;

const tradeInsertSchema = z
  .object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    session_date_ny: z.string().min(1),
    direction: z.union([z.literal("long"), z.literal("short")]),
    entry_time_utc: z.string().min(1),
    entry_price: z.number(),
    exit_time_utc: z.string().min(1),
    exit_price: z.number(),
    quantity: z.number(),
    fee_total: z.number(),
    pnl: z.number(),
    r_multiple: z.number().nullable(),
    exit_reason: z.union([
      z.literal("stop"),
      z.literal("take_profit"),
      z.literal("time_exit"),
      z.literal("session_end"),
      z.literal("manual")
    ])
  })
  .strict();

export type TradeInsert = z.infer<typeof tradeInsertSchema>;

function toIsoUtc(ts: string): string {
  return new Date(ts).toISOString();
}

function mapRowToDto(row: TradeRow): Trade {
  return {
    id: row.id,
    runId: row.run_id,
    sessionDateNy: row.session_date_ny,
    direction: row.direction,
    entryTimeUtc: toIsoUtc(row.entry_time_utc),
    entryPrice: Number(row.entry_price),
    exitTimeUtc: toIsoUtc(row.exit_time_utc),
    exitPrice: Number(row.exit_price),
    quantity: Number(row.quantity),
    feeTotal: Number(row.fee_total),
    pnl: Number(row.pnl),
    rMultiple: row.r_multiple === null ? null : Number(row.r_multiple),
    exitReason: row.exit_reason
  };
}

/**
 * Inserts trades for a completed run.
 */
export async function insertTrades(args: Readonly<{ supabase: SupabaseClient; trades: readonly TradeInsert[] }>): Promise<void> {
  const payload = z.array(tradeInsertSchema).parse(args.trades);
  if (payload.length === 0) {
    return;
  }

  const result = await args.supabase.from("backtest_trades").insert(payload);
  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Returns paged trades for a run.
 */
export async function listTradesByRunId(args: Readonly<{
  supabase: SupabaseClient;
  runId: string;
  pagination: Pagination;
}>): Promise<Readonly<{ items: readonly Trade[]; total: number }>> {
  const end = args.pagination.offset + args.pagination.limit - 1;

  const result = await args.supabase
    .from("backtest_trades")
    .select("*", { count: "exact" })
    .eq("run_id", args.runId)
    .order("entry_time_utc", { ascending: true })
    .range(args.pagination.offset, end);

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(tradeRowSchema).parse(result.data);
  const items = rows.map(mapRowToDto);
  const total = result.count ?? items.length;
  return { items, total };
}

/**
 * Loads all trades for a run in exit-time order.
 *
 * Used for deriving equity series without requiring an equity table.
 */
export async function listAllTradesByRunId(args: Readonly<{
  supabase: SupabaseClient;
  runId: string;
}>): Promise<readonly Trade[]> {
  const result = await args.supabase
    .from("backtest_trades")
    .select("*")
    .eq("run_id", args.runId)
    .order("exit_time_utc", { ascending: true });

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(tradeRowSchema).parse(result.data);
  return rows.map(mapRowToDto);
}

/**
 * Ensures a run has trades (used for endpoints that expect completed artifacts).
 */
export async function assertRunHasTrades(args: Readonly<{ supabase: SupabaseClient; runId: string }>): Promise<void> {
  const result = await args.supabase
    .from("backtest_trades")
    .select("id", { count: "exact", head: true })
    .eq("run_id", args.runId);

  if (result.error !== null) {
    throw result.error;
  }

  if ((result.count ?? 0) === 0) {
    throw notFoundError(`No trades found for run ${args.runId}`);
  }
}





