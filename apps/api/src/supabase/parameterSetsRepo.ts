import { z } from "zod";

import { notFoundError } from "../http/apiError.js";
import type { Pagination } from "../http/pagination.js";
import type { ParameterSet } from "../domain/dtos.js";
import { strategyParamsSchema } from "../domain/strategyParams.js";
import type { SupabaseClient } from "./client.js";

const parameterSetRowSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  params_version: z.string().min(1),
  params: z.unknown(),
  is_deleted: z.boolean()
});

type ParameterSetRow = z.infer<typeof parameterSetRowSchema>;

function toIsoUtc(ts: string): string {
  // Supabase returns timestamptz as a string; normalize to a stable ISO UTC string.
  return new Date(ts).toISOString();
}

function mapRowToDto(row: ParameterSetRow): ParameterSet {
  const params = strategyParamsSchema.parse(row.params);
  return {
    id: row.id,
    createdAt: toIsoUtc(row.created_at),
    updatedAt: toIsoUtc(row.updated_at),
    name: row.name,
    description: row.description,
    paramsVersion: row.params_version,
    params
  };
}

/**
 * Inserts a parameter set row into Supabase and returns the API DTO.
 */
export async function createParameterSet(args: Readonly<{
  supabase: SupabaseClient;
  name: string;
  description: string | null;
  params: unknown;
}>): Promise<ParameterSet> {
  const validatedParams = strategyParamsSchema.parse(args.params);
  const insertPayload = {
    name: args.name,
    description: args.description,
    params_version: validatedParams.version,
    params: validatedParams
  };

  const result = await args.supabase
    .from("parameter_sets")
    .insert(insertPayload)
    .select("*")
    .single();

  if (result.error !== null) {
    throw result.error;
  }

  const row = parameterSetRowSchema.parse(result.data);
  return mapRowToDto(row);
}

/**
 * Fetches a paged list of parameter sets.
 *
 * Notes:
 * - Uses offset/limit pagination per `docs/15-api-contracts.md`.
 * - Filters `is_deleted = false`.
 */
export async function listParameterSets(args: Readonly<{
  supabase: SupabaseClient;
  pagination: Pagination;
}>): Promise<Readonly<{ items: readonly ParameterSet[]; total: number }>> {
  const end = args.pagination.offset + args.pagination.limit - 1;

  const result = await args.supabase
    .from("parameter_sets")
    .select("*", { count: "exact" })
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false })
    .range(args.pagination.offset, end);

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(parameterSetRowSchema).parse(result.data);
  const items = rows.map(mapRowToDto);
  const total = result.count ?? items.length;

  return { items, total };
}

/**
 * Fetches a single parameter set by ID.
 *
 * @throws NOT_FOUND when no row exists.
 */
export async function getParameterSetById(args: Readonly<{
  supabase: SupabaseClient;
  id: string;
}>): Promise<ParameterSet> {
  const result = await args.supabase
    .from("parameter_sets")
    .select("*")
    .eq("id", args.id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (result.error !== null) {
    throw result.error;
  }

  if (result.data === null) {
    throw notFoundError(`ParameterSet ${args.id} not found`);
  }

  const row = parameterSetRowSchema.parse(result.data);
  return mapRowToDto(row);
}

