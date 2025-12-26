import { z } from "zod";

import type { BacktestCompareResponse, BacktestRun, BacktestRunStatus, BacktestRunSummary } from "../domain/dtos.js";
import { notFoundError } from "../http/apiError.js";
import type { Pagination } from "../http/pagination.js";
import type { StrategyParams } from "../domain/strategyParams.js";
import type { SupabaseClient } from "./client.js";

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const backtestRunRowSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().min(1),
  status: z.union([z.literal("queued"), z.literal("running"), z.literal("completed"), z.literal("failed")]),
  parameter_set_id: z.string().uuid().nullable(),
  params_snapshot: z.unknown(),
  symbol: z.string().min(1),
  interval: z.string().min(1),
  start_time_utc: z.string().min(1),
  end_time_utc: z.string().min(1),
  initial_equity: numericSchema,
  final_equity: nullableNumericSchema,
  total_return_pct: nullableNumericSchema,
  max_drawdown_pct: nullableNumericSchema,
  win_rate_pct: nullableNumericSchema,
  profit_factor: nullableNumericSchema,
  trade_count: z.union([z.number().int(), z.string().transform(Number), z.null()]),
  data_source: z.string().min(1),
  data_fingerprint: z.unknown(),
  error_message: z.string().nullable()
});

type BacktestRunRow = z.infer<typeof backtestRunRowSchema>;

function toIsoUtc(ts: string): string {
  return new Date(ts).toISOString();
}

function mapRowToDto(row: BacktestRunRow): BacktestRun {
  const tradeCount = row.trade_count === null ? null : Number(row.trade_count);
  return {
    id: row.id,
    createdAt: toIsoUtc(row.created_at),
    status: row.status,
    parameterSetId: row.parameter_set_id,
    paramsSnapshot: row.params_snapshot as StrategyParams,
    symbol: row.symbol,
    interval: row.interval,
    startTimeUtc: toIsoUtc(row.start_time_utc),
    endTimeUtc: toIsoUtc(row.end_time_utc),
    initialEquity: Number(row.initial_equity),
    finalEquity: row.final_equity === null ? null : Number(row.final_equity),
    totalReturnPct: row.total_return_pct === null ? null : Number(row.total_return_pct),
    maxDrawdownPct: row.max_drawdown_pct === null ? null : Number(row.max_drawdown_pct),
    winRatePct: row.win_rate_pct === null ? null : Number(row.win_rate_pct),
    profitFactor: row.profit_factor === null ? null : Number(row.profit_factor),
    tradeCount,
    errorMessage: row.error_message
  };
}

function mapRowToSummary(row: BacktestRunRow): BacktestRunSummary {
  const tradeCount = row.trade_count === null ? null : Number(row.trade_count);
  return {
    id: row.id,
    createdAt: toIsoUtc(row.created_at),
    status: row.status,
    symbol: row.symbol,
    interval: row.interval,
    startTimeUtc: toIsoUtc(row.start_time_utc),
    endTimeUtc: toIsoUtc(row.end_time_utc),
    tradeCount,
    totalReturnPct: row.total_return_pct === null ? null : Number(row.total_return_pct),
    maxDrawdownPct: row.max_drawdown_pct === null ? null : Number(row.max_drawdown_pct),
    winRatePct: row.win_rate_pct === null ? null : Number(row.win_rate_pct),
    profitFactor: row.profit_factor === null ? null : Number(row.profit_factor),
    strategyParams: row.params_snapshot as StrategyParams
  };
}

/**
 * Creates a queued backtest run row.
 *
 * `data_fingerprint` is required in the schema doc and will be filled in by the runner.
 */
export async function createBacktestRun(args: Readonly<{
  supabase: SupabaseClient;
  id: string;
  parameterSetId: string | null;
  paramsSnapshot: StrategyParams;
  /** Engine version stored in DB for reproducibility (docs/10 NFR1). */
  engineVersion: string;
  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  initialEquity: number;
}>): Promise<BacktestRun> {
  const insertPayload = {
    id: args.id,
    status: "queued" satisfies BacktestRunStatus,
    parameter_set_id: args.parameterSetId,
    params_snapshot: args.paramsSnapshot,
    engine_version: args.engineVersion,
    symbol: args.symbol,
    interval: args.interval,
    start_time_utc: args.startTimeUtc,
    end_time_utc: args.endTimeUtc,
    initial_equity: args.initialEquity,
    data_source: "yfinance",
    data_fingerprint: {
      status: "pending"
    },
    error_message: null
  };

  const result = await args.supabase.from("backtest_runs").insert(insertPayload).select("*").single();
  if (result.error !== null) {
    throw result.error;
  }

  const row = backtestRunRowSchema.parse(result.data);
  return mapRowToDto(row);
}

/**
 * Bulk creates multiple backtest runs in a single database operation.
 * Much faster than calling createBacktestRun in a loop for grid search.
 * 
 * Optimization mode is enabled for bulk operations to skip expensive logging.
 */
export async function createBacktestRunsBulk(args: Readonly<{
  supabase: SupabaseClient;
  runs: readonly Readonly<{
    id: string;
    parameterSetId: string | null;
    paramsSnapshot: StrategyParams;
    engineVersion: string;
    symbol: string;
    interval: string;
    startTimeUtc: string;
    endTimeUtc: string;
    initialEquity: number;
  }>[];
}>): Promise<void> {
  if (args.runs.length === 0) {
    return;
  }

  const insertPayloads = args.runs.map((run) => ({
    id: run.id,
    status: "queued" satisfies BacktestRunStatus,
    parameter_set_id: run.parameterSetId,
    params_snapshot: run.paramsSnapshot,
    engine_version: run.engineVersion,
    symbol: run.symbol,
    interval: run.interval,
    start_time_utc: run.startTimeUtc,
    end_time_utc: run.endTimeUtc,
    initial_equity: run.initialEquity,
    data_source: "yfinance",
    data_fingerprint: {
      status: "pending",
      optimization_mode: true  // Enable fast mode for bulk operations
    },
    error_message: null
  }));

  const result = await args.supabase.from("backtest_runs").insert(insertPayloads);
  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Loads a run row and returns both the raw row and validated DTO.
 */
export async function getBacktestRunById(args: Readonly<{
  supabase: SupabaseClient;
  id: string;
}>): Promise<BacktestRun> {
  const result = await args.supabase.from("backtest_runs").select("*").eq("id", args.id).maybeSingle();
  if (result.error !== null) {
    throw result.error;
  }
  if (result.data === null) {
    throw notFoundError(`BacktestRun ${args.id} not found`);
  }

  const row = backtestRunRowSchema.parse(result.data);
  return mapRowToDto(row);
}

/**
 * Loads a run row including the `params_snapshot` payload (validated by the caller).
 */
export async function getBacktestRunRowById(args: Readonly<{
  supabase: SupabaseClient;
  id: string;
}>): Promise<BacktestRunRow> {
  const result = await args.supabase.from("backtest_runs").select("*").eq("id", args.id).maybeSingle();
  if (result.error !== null) {
    throw result.error;
  }
  if (result.data === null) {
    throw notFoundError(`BacktestRun ${args.id} not found`);
  }
  return backtestRunRowSchema.parse(result.data);
}

/**
 * Lists run summaries for UI screens.
 */
export async function listBacktestRuns(args: Readonly<{
  supabase: SupabaseClient;
  pagination: Pagination;
}>): Promise<Readonly<{ items: readonly BacktestRunSummary[]; total: number }>> {
  const end = args.pagination.offset + args.pagination.limit - 1;

  const result = await args.supabase
    .from("backtest_runs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(args.pagination.offset, end);

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(backtestRunRowSchema).parse(result.data);
  const items = rows.map(mapRowToSummary);
  const total = result.count ?? items.length;
  return { items, total };
}

/**
 * Updates run status (and optional error message).
 */
export async function updateBacktestRunStatus(args: Readonly<{
  supabase: SupabaseClient;
  id: string;
  status: BacktestRunStatus;
  errorMessage: string | null;
}>): Promise<void> {
  const result = await args.supabase
    .from("backtest_runs")
    .update({ status: args.status, error_message: args.errorMessage })
    .eq("id", args.id);

  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Updates run completion metrics and fingerprint.
 */
export async function completeBacktestRun(args: Readonly<{
  supabase: SupabaseClient;
  id: string;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  tradeCount: number;
  dataFingerprint: unknown;
}>): Promise<void> {
  const updatePayload = {
    status: "completed" satisfies BacktestRunStatus,
    final_equity: args.finalEquity,
    total_return_pct: args.totalReturnPct,
    max_drawdown_pct: args.maxDrawdownPct,
    win_rate_pct: args.winRatePct,
    profit_factor: args.profitFactor,
    trade_count: args.tradeCount,
    data_fingerprint: args.dataFingerprint,
    error_message: null
  };

  const result = await args.supabase.from("backtest_runs").update(updatePayload).eq("id", args.id);
  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Loads run compare rows (authoritative response shape in docs/15).
 */
export async function compareBacktestRuns(args: Readonly<{
  supabase: SupabaseClient;
  runIds: readonly string[];
}>): Promise<BacktestCompareResponse> {
  const result = await args.supabase
    .from("backtest_runs")
    .select("*")
    .in("id", [...args.runIds]);

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(backtestRunRowSchema).parse(result.data);

  return {
    rows: rows.map((row) => ({
      runId: row.id,
      createdAt: toIsoUtc(row.created_at),
      symbol: row.symbol,
      interval: row.interval,
      status: row.status,
      metrics: {
        totalReturnPct: row.total_return_pct === null ? null : Number(row.total_return_pct),
        maxDrawdownPct: row.max_drawdown_pct === null ? null : Number(row.max_drawdown_pct),
        winRatePct: row.win_rate_pct === null ? null : Number(row.win_rate_pct),
        profitFactor: row.profit_factor === null ? null : Number(row.profit_factor),
        tradeCount: row.trade_count === null ? null : Number(row.trade_count)
      }
    }))
  };
}





