/**
 * @file API DTO schemas (Phase 1).
 *
 * Authoritative source:
 * - docs/15-api-contracts.md
 * - docs/17-supabase-schema-and-migrations.md (entity field names)
 */

import { z } from "zod";

import {
  IsoUtcDateTimeSchema,
  LimitSchema,
  NyDateSchema,
  OffsetSchema,
  UuidSchema
} from "./primitives";
import { BacktestParamsSchema, IntervalSchema, SymbolSchema } from "./backtestParams";

/**
 * Pagination query params: offset/limit.
 *
 * Authoritative defaults/bounds from docs:
 * - offset: int, default 0, min 0
 * - limit: int, default 50, min 1, max 500
 */
export const PaginationQuerySchema = z.object({
  offset: OffsetSchema,
  limit: LimitSchema
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Build a paged response schema for a given item schema.
 */
export function makePagedResponseSchema<TItemSchema extends z.ZodType<unknown>>(
  itemSchema: TItemSchema
) {
  return z.object({
    items: z.array(itemSchema),
    total: z
      .number({ invalid_type_error: "Must be a number" })
      .int("Must be an integer")
      .min(0, "Must be >= 0"),
    offset: z
      .number({ invalid_type_error: "Must be a number" })
      .int("Must be an integer")
      .min(0, "Must be >= 0"),
    limit: z
      .number({ invalid_type_error: "Must be a number" })
      .int("Must be an integer")
      .min(1, "Must be >= 1")
      .max(500, "Must be <= 500")
  });
}

/**
 * Entity: ParameterSet (maps to DB table `parameter_sets`).
 */
export const ParameterSetSchema = z.object({
  id: UuidSchema,
  createdAt: IsoUtcDateTimeSchema,
  updatedAt: IsoUtcDateTimeSchema,
  name: z.string().min(1, "Must not be empty"),
  description: z.string().nullable(),
  paramsVersion: z.string().min(1, "Must not be empty"),
  params: BacktestParamsSchema,
  isDeleted: z.boolean()
});

export type ParameterSet = z.infer<typeof ParameterSetSchema>;

export const BacktestRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed"
]);

export type BacktestRunStatus = z.infer<typeof BacktestRunStatusSchema>;

/**
 * Entity: BacktestRun (maps to DB table `backtest_runs`).
 */
export const BacktestRunSchema = z.object({
  id: UuidSchema,
  createdAt: IsoUtcDateTimeSchema,

  status: BacktestRunStatusSchema,

  parameterSetId: UuidSchema.nullable(),

  /** Exact params used in this run (DB: params_snapshot). */
  paramsSnapshot: BacktestParamsSchema,

  symbol: SymbolSchema,
  interval: IntervalSchema,
  startTimeUtc: IsoUtcDateTimeSchema,
  endTimeUtc: IsoUtcDateTimeSchema,

  initialEquity: z.number({ invalid_type_error: "Must be a number" }),
  finalEquity: z.number({ invalid_type_error: "Must be a number" }).nullable(),

  totalReturnPct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  maxDrawdownPct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  winRatePct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  profitFactor: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  tradeCount: z
    .number({ invalid_type_error: "Must be a number" })
    .int("Must be an integer")
    .nullable(),

  dataSource: z.string().min(1, "Must not be empty"),

  /**
   * A fingerprint for reproducibility (DB: jsonb).
   * Kept flexible early on to avoid over-constraining v1.
   */
  dataFingerprint: z.record(z.unknown()),

  errorMessage: z.string().nullable()
});

export type BacktestRun = z.infer<typeof BacktestRunSchema>;

/**
 * BacktestRunSummary (authoritative subset for list/compare screens).
 */
export const BacktestRunSummarySchema = z.object({
  id: UuidSchema,
  createdAt: IsoUtcDateTimeSchema,
  status: BacktestRunStatusSchema,
  symbol: SymbolSchema,
  interval: IntervalSchema,
  startTimeUtc: IsoUtcDateTimeSchema,
  endTimeUtc: IsoUtcDateTimeSchema,
  tradeCount: z
    .number({ invalid_type_error: "Must be a number" })
    .int("Must be an integer")
    .nullable(),
  totalReturnPct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  maxDrawdownPct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  winRatePct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  profitFactor: z.number({ invalid_type_error: "Must be a number" }).nullable()
});

export type BacktestRunSummary = z.infer<typeof BacktestRunSummarySchema>;

/**
 * Entity: Trade (maps to DB table `backtest_trades`).
 */
export const TradeDirectionSchema = z.enum(["long", "short"]);

export const TradeSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  sessionDateNy: NyDateSchema,
  direction: TradeDirectionSchema,
  entryTimeUtc: IsoUtcDateTimeSchema,
  entryPrice: z.number({ invalid_type_error: "Must be a number" }),
  exitTimeUtc: IsoUtcDateTimeSchema,
  exitPrice: z.number({ invalid_type_error: "Must be a number" }),
  quantity: z.number({ invalid_type_error: "Must be a number" }),
  feeTotal: z.number({ invalid_type_error: "Must be a number" }),
  pnl: z.number({ invalid_type_error: "Must be a number" }),
  rMultiple: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  exitReason: z.string().min(1, "Must not be empty")
});

export type Trade = z.infer<typeof TradeSchema>;

/**
 * Entity: EquityPoint.
 *
 * The API may later support compressed series. For v1, we validate a single point.
 */
export const EquityPointSchema = z.object({
  timeUtc: IsoUtcDateTimeSchema,
  equity: z.number({ invalid_type_error: "Must be a number" })
});

export type EquityPoint = z.infer<typeof EquityPointSchema>;

// --- Requests / Responses ---

export const CreateParameterSetRequestSchema = z.object({
  name: z.string().min(1, "Must not be empty"),
  description: z.string().optional(),
  params: BacktestParamsSchema
});

export const CreateParameterSetResponseSchema = ParameterSetSchema;

export const ListParameterSetsQuerySchema = PaginationQuerySchema;
export const ListParameterSetsResponseSchema = makePagedResponseSchema(ParameterSetSchema);

export const GetParameterSetResponseSchema = ParameterSetSchema;

export const RunBacktestRequestSchema = z
  .object({
    parameterSetId: UuidSchema.optional(),
    params: BacktestParamsSchema.optional(),

    symbol: SymbolSchema,
    interval: IntervalSchema,
    startTimeUtc: IsoUtcDateTimeSchema,
    endTimeUtc: IsoUtcDateTimeSchema,
    initialEquity: z.number({ invalid_type_error: "Must be a number" }).optional()
  })
  .superRefine((req, ctx) => {
    const hasParameterSetId = typeof req.parameterSetId === "string";
    const hasParams = typeof req.params === "object" && req.params !== null;

    if (hasParameterSetId === hasParams) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameterSetId"],
        message: "Provide exactly one of parameterSetId or params"
      });
    }

    if (hasParams) {
      if (req.params?.symbol !== req.symbol) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["symbol"],
          message: "Must match params.symbol when params are provided"
        });
      }

      if (req.params?.interval !== req.interval) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["interval"],
          message: "Must match params.interval when params are provided"
        });
      }
    }
  });

export const RunBacktestResponseSchema = BacktestRunSchema;

export const GetBacktestRunResponseSchema = BacktestRunSchema;

export const ListBacktestRunsQuerySchema = PaginationQuerySchema;
export const ListBacktestRunsResponseSchema = makePagedResponseSchema(BacktestRunSummarySchema);

export const GetBacktestTradesQuerySchema = PaginationQuerySchema;
export const GetBacktestTradesResponseSchema = makePagedResponseSchema(TradeSchema);

export const GetBacktestEquityQuerySchema = PaginationQuerySchema;
export const GetBacktestEquityResponseSchema = makePagedResponseSchema(EquityPointSchema);

export const BacktestCompareRequestSchema = z.object({
  runIds: z.array(UuidSchema).min(1, "Must include at least one runId")
});

export const BacktestCompareMetricsSchema = z.object({
  totalReturnPct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  maxDrawdownPct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  winRatePct: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  profitFactor: z.number({ invalid_type_error: "Must be a number" }).nullable(),
  tradeCount: z
    .number({ invalid_type_error: "Must be a number" })
    .int("Must be an integer")
    .nullable()
});

export const BacktestCompareRowSchema = z.object({
  runId: UuidSchema,
  createdAt: IsoUtcDateTimeSchema,
  symbol: SymbolSchema,
  interval: IntervalSchema,
  status: BacktestRunStatusSchema,
  metrics: BacktestCompareMetricsSchema
});

export const BacktestCompareResponseSchema = z.object({
  rows: z.array(BacktestCompareRowSchema)
});

export const BacktestGridResponseSchema = z.object({
  gridRunId: UuidSchema,
  runIds: z.array(UuidSchema)
});

/**
 * BacktestGridRequest is not fully spelled out in docs yet; we keep it minimal.
 *
 * This is intentionally conservative:
 * - Validate required conceptual pieces (base params, overrides, symbols, intervals, date range)
 * - Keep override values flexible (string/number/boolean)
 */
export const BacktestGridOverrideSchema = z.object({
  path: z.string().min(1, "Must not be empty"),
  values: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .min(1, "Must include at least one value")
});

export const BacktestGridRequestSchema = z.object({
  baseParams: BacktestParamsSchema,
  overrides: z.array(BacktestGridOverrideSchema),
  symbols: z.array(SymbolSchema).min(1, "Must include at least one symbol"),
  intervals: z.array(IntervalSchema).min(1, "Must include at least one interval"),
  startTimeUtc: IsoUtcDateTimeSchema,
  endTimeUtc: IsoUtcDateTimeSchema,
  initialEquity: z.number({ invalid_type_error: "Must be a number" }).optional()
});

export type CreateParameterSetRequest = z.infer<typeof CreateParameterSetRequestSchema>;
export type CreateParameterSetResponse = z.infer<typeof CreateParameterSetResponseSchema>;

export type ListParameterSetsQuery = z.infer<typeof ListParameterSetsQuerySchema>;
export type ListParameterSetsResponse = z.infer<typeof ListParameterSetsResponseSchema>;

export type GetParameterSetResponse = z.infer<typeof GetParameterSetResponseSchema>;

export type RunBacktestRequest = z.infer<typeof RunBacktestRequestSchema>;
export type RunBacktestResponse = z.infer<typeof RunBacktestResponseSchema>;

export type GetBacktestRunResponse = z.infer<typeof GetBacktestRunResponseSchema>;

export type ListBacktestRunsQuery = z.infer<typeof ListBacktestRunsQuerySchema>;
export type ListBacktestRunsResponse = z.infer<typeof ListBacktestRunsResponseSchema>;

export type GetBacktestTradesQuery = z.infer<typeof GetBacktestTradesQuerySchema>;
export type GetBacktestTradesResponse = z.infer<typeof GetBacktestTradesResponseSchema>;

export type GetBacktestEquityQuery = z.infer<typeof GetBacktestEquityQuerySchema>;
export type GetBacktestEquityResponse = z.infer<typeof GetBacktestEquityResponseSchema>;

export type BacktestCompareRequest = z.infer<typeof BacktestCompareRequestSchema>;
export type BacktestCompareResponse = z.infer<typeof BacktestCompareResponseSchema>;

export type BacktestGridOverride = z.infer<typeof BacktestGridOverrideSchema>;
export type BacktestGridRequest = z.infer<typeof BacktestGridRequestSchema>;
export type BacktestGridResponse = z.infer<typeof BacktestGridResponseSchema>;




