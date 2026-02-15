import { z } from "zod";

import type { SupabaseClient } from "../supabase/client.js";

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const nullableTimestampSchema = z.union([z.string().min(1), z.null()]);

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: "Expected a UUID"
  });

const botRowSchema = z.object({
  id: uuidSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  name: z.string().min(1),
  status: z.union([
    z.literal("stopped"),
    z.literal("starting"),
    z.literal("running"),
    z.literal("stopping"),
    z.literal("error"),
    z.literal("paused")
  ]),
  exchange: z.string().min(1),
  symbol: z.string().min(1),
  interval: z.string().min(1),
  params_snapshot: z.unknown(),
  initial_balance: numericSchema,
  current_balance: numericSchema,
  current_equity: numericSchema,
  max_daily_loss_pct: numericSchema,
  max_position_size_pct: numericSchema,
  error_message: z.string().nullable(),
  error_count: z.union([z.number().int(), z.string().transform(Number)]),
  last_heartbeat_at: nullableTimestampSchema,
  started_at: nullableTimestampSchema,
  stopped_at: nullableTimestampSchema
});

type BotRow = z.infer<typeof botRowSchema>;

export type BotStatus = BotRow["status"];

export type Bot = Readonly<{
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  status: BotStatus;
  exchange: string;
  symbol: string;
  interval: string;
  paramsSnapshot: unknown;
  initialBalance: number;
  currentBalance: number;
  currentEquity: number;
  maxDailyLossPct: number;
  maxPositionSizePct: number;
  errorMessage: string | null;
  errorCount: number;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
}>;

type BotCreateArgs = Readonly<{
  supabase: SupabaseClient;
  name: string;
  status: BotStatus;
  exchange: string;
  symbol: string;
  interval: string;
  paramsSnapshot: unknown;
  initialBalance: number;
  maxDailyLossPct: number;
  maxPositionSizePct: number;
}>;

type BotStatusUpdateArgs = Readonly<{
  supabase: SupabaseClient;
  id: string;
  status: BotStatus;
  errorMessage?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
}>;

type BotBalanceUpdateArgs = Readonly<{
  supabase: SupabaseClient;
  id: string;
  balance: number;
  equity: number;
}>;

function toIsoUtc(ts: string | null): string | null {
  if (ts === null) {
    return null;
  }
  return new Date(ts).toISOString();
}

function mapRowToDto(row: BotRow): Bot {
  return {
    id: row.id,
    createdAt: toIsoUtc(row.created_at) ?? new Date(row.created_at).toISOString(),
    updatedAt: toIsoUtc(row.updated_at) ?? new Date(row.updated_at).toISOString(),
    name: row.name,
    status: row.status,
    exchange: row.exchange,
    symbol: row.symbol,
    interval: row.interval,
    paramsSnapshot: row.params_snapshot,
    initialBalance: Number(row.initial_balance),
    currentBalance: Number(row.current_balance),
    currentEquity: Number(row.current_equity),
    maxDailyLossPct: Number(row.max_daily_loss_pct),
    maxPositionSizePct: Number(row.max_position_size_pct),
    errorMessage: row.error_message,
    errorCount: Number(row.error_count),
    lastHeartbeatAt: toIsoUtc(row.last_heartbeat_at),
    startedAt: toIsoUtc(row.started_at),
    stoppedAt: toIsoUtc(row.stopped_at)
  };
}

/**
 * Creates a bot row with initial balances.
 *
 * Inputs:
 * - Required bot configuration fields.
 *
 * Outputs:
 * - The created bot DTO.
 *
 * Edge cases:
 * - Unique name violations will surface as Supabase errors.
 *
 * Error behavior:
 * - Throws on insert or validation errors.
 */
export async function createBot(args: BotCreateArgs): Promise<Bot> {
  const insertPayload = {
    name: args.name,
    status: args.status,
    exchange: args.exchange,
    symbol: args.symbol,
    interval: args.interval,
    params_snapshot: args.paramsSnapshot,
    initial_balance: args.initialBalance,
    current_balance: args.initialBalance,
    current_equity: args.initialBalance,
    max_daily_loss_pct: args.maxDailyLossPct,
    max_position_size_pct: args.maxPositionSizePct,
    error_message: null,
    error_count: 0,
    last_heartbeat_at: null,
    started_at: null,
    stopped_at: null
  };

  const result = await args.supabase.from("bots").insert(insertPayload).select("*").single();
  if (result.error !== null) {
    throw result.error;
  }

  const row = botRowSchema.parse(result.data);
  return mapRowToDto(row);
}

/**
 * Loads a bot by id.
 *
 * Inputs:
 * - Bot id.
 *
 * Outputs:
 * - Bot DTO or null if not found.
 *
 * Error behavior:
 * - Throws on query or validation errors.
 */
export async function getBotById(args: Readonly<{ supabase: SupabaseClient; id: string }>): Promise<Bot | null> {
  const result = await args.supabase.from("bots").select("*").eq("id", args.id).maybeSingle();
  if (result.error !== null) {
    throw result.error;
  }
  if (result.data === null) {
    return null;
  }
  const row = botRowSchema.parse(result.data);
  return mapRowToDto(row);
}

/**
 * Loads a bot by name.
 *
 * Inputs:
 * - Bot name.
 *
 * Outputs:
 * - Bot DTO or null if not found.
 *
 * Error behavior:
 * - Throws on query or validation errors.
 */
export async function getBotByName(args: Readonly<{ supabase: SupabaseClient; name: string }>): Promise<Bot | null> {
  const result = await args.supabase.from("bots").select("*").eq("name", args.name).maybeSingle();
  if (result.error !== null) {
    throw result.error;
  }
  if (result.data === null) {
    return null;
  }
  const row = botRowSchema.parse(result.data);
  return mapRowToDto(row);
}

/**
 * Lists bots, optionally filtered by status.
 *
 * Inputs:
 * - Optional status filter.
 *
 * Outputs:
 * - Array of bot DTOs.
 *
 * Error behavior:
 * - Throws on query or validation errors.
 */
export async function listBots(args: Readonly<{
  supabase: SupabaseClient;
  status?: BotStatus;
}>): Promise<readonly Bot[]> {
  let query = args.supabase.from("bots").select("*").order("created_at", { ascending: false });
  if (args.status !== undefined) {
    query = query.eq("status", args.status);
  }

  const result = await query;
  if (result.error !== null) {
    throw result.error;
  }
  const rows = z.array(botRowSchema).parse(result.data);
  return rows.map(mapRowToDto);
}

/**
 * Updates a bot's status and optional error/timestamps.
 *
 * Inputs:
 * - Bot id, new status, optional error message and timestamps.
 *
 * Outputs:
 * - None.
 *
 * Error behavior:
 * - Throws on update errors.
 */
export async function updateBotStatus(args: BotStatusUpdateArgs): Promise<void> {
  const updatePayload: {
    status: BotStatus;
    error_message: string | null;
    started_at?: string | null;
    stopped_at?: string | null;
  } = {
    status: args.status,
    error_message: args.errorMessage ?? null
  };

  if (args.startedAt !== undefined) {
    updatePayload.started_at = args.startedAt;
  }
  if (args.stoppedAt !== undefined) {
    updatePayload.stopped_at = args.stoppedAt;
  }

  const result = await args.supabase.from("bots").update(updatePayload).eq("id", args.id);
  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Updates the bot heartbeat timestamp.
 *
 * Inputs:
 * - Bot id.
 *
 * Outputs:
 * - None.
 *
 * Error behavior:
 * - Throws on update errors.
 */
export async function updateBotHeartbeat(args: Readonly<{ supabase: SupabaseClient; id: string }>): Promise<void> {
  const now = new Date().toISOString();
  const result = await args.supabase.from("bots").update({ last_heartbeat_at: now }).eq("id", args.id);
  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Updates the current balance and equity fields.
 *
 * Inputs:
 * - Bot id, balance, equity.
 *
 * Outputs:
 * - None.
 *
 * Error behavior:
 * - Throws on update errors.
 */
export async function updateBotBalance(args: BotBalanceUpdateArgs): Promise<void> {
  const updatePayload = {
    current_balance: args.balance,
    current_equity: args.equity
  };
  const result = await args.supabase.from("bots").update(updatePayload).eq("id", args.id);
  if (result.error !== null) {
    throw result.error;
  }
}

/**
 * Deletes a bot by id.
 *
 * Inputs:
 * - Bot id.
 *
 * Outputs:
 * - None.
 *
 * Error behavior:
 * - Throws on delete errors.
 */
export async function deleteBot(args: Readonly<{ supabase: SupabaseClient; id: string }>): Promise<void> {
  const result = await args.supabase.from("bots").delete().eq("id", args.id);
  if (result.error !== null) {
    throw result.error;
  }
}
