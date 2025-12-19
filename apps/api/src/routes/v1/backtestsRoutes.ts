import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { validationError } from "../../http/apiError.js";
import { parsePaginationQuery, toPagedResponse } from "../../http/pagination.js";
import type { EquityPoint } from "../../domain/dtos.js";
import { strategyParamsSchema } from "../../domain/strategyParams.js";
import { setObjectPath } from "../../utils/objectPath.js";
import { getParameterSetById } from "../../supabase/parameterSetsRepo.js";
import { compareBacktestRuns, createBacktestRun, getBacktestRunById, listBacktestRuns } from "../../supabase/backtestRunsRepo.js";
import { listAllTradesByRunId, listTradesByRunId } from "../../supabase/backtestTradesRepo.js";
import { insertRunEvent } from "../../supabase/runEventsRepo.js";

const isoUtcSchema = z.string().datetime({ offset: true });

const symbolSchema = z.enum(["BTC-USD", "ETH-USD"]);
const intervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);

const runIdParamsSchema = z
  .object({
    runId: z.string().uuid()
  })
  .strict();

const createBacktestBodySchema = z
  .object({
    parameterSetId: z.string().uuid().optional(),
    params: strategyParamsSchema.optional(),
    symbol: symbolSchema,
    interval: intervalSchema,
    startTimeUtc: isoUtcSchema,
    endTimeUtc: isoUtcSchema,
    initialEquity: z.number().positive().optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasId = v.parameterSetId !== undefined;
    const hasParams = v.params !== undefined;
    if (hasId === hasParams) {
      ctx.addIssue({
        code: "custom",
        path: ["parameterSetId"],
        message: "Provide exactly one of parameterSetId or params"
      });
    }
    const start = new Date(v.startTimeUtc).getTime();
    const end = new Date(v.endTimeUtc).getTime();
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
      ctx.addIssue({
        code: "custom",
        path: ["endTimeUtc"],
        message: "endTimeUtc must be after startTimeUtc"
      });
    }
  });

const compareBodySchema = z
  .object({
    runIds: z.array(z.string().uuid()).min(1)
  })
  .strict();

const gridOverrideSchema = z
  .object({
    path: z.string().trim().min(1),
    values: z.array(z.union([z.number(), z.string(), z.boolean()])).min(1)
  })
  .strict();

const gridBodySchema = z
  .object({
    baseParams: strategyParamsSchema,
    overrides: z.array(gridOverrideSchema),
    symbols: z.array(symbolSchema).min(1),
    intervals: z.array(intervalSchema).min(1),
    startTimeUtc: isoUtcSchema,
    endTimeUtc: isoUtcSchema,
    initialEquity: z.number().positive().optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    const start = new Date(v.startTimeUtc).getTime();
    const end = new Date(v.endTimeUtc).getTime();
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
      ctx.addIssue({
        code: "custom",
        path: ["endTimeUtc"],
        message: "endTimeUtc must be after startTimeUtc"
      });
    }
  });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecordOrThrow(args: Readonly<{ value: unknown; path: string }>): Record<string, unknown> {
  if (!isPlainObject(args.value)) {
    throw validationError({
      message: "Validation failed",
      details: [{ path: args.path, message: "Expected object" }]
    });
  }
  return args.value;
}

function cartesianProduct<T>(arrays: readonly (readonly T[])[]): readonly T[][] {
  let acc: T[][] = [[]];
  for (const values of arrays) {
    const next: T[][] = [];
    for (const prefix of acc) {
      for (const v of values) {
        next.push([...prefix, v]);
      }
    }
    acc = next;
  }
  return acc;
}

function buildEquityPoints(args: Readonly<{
  initialEquity: number;
  startTimeUtc: string;
  trades: readonly { exitTimeUtc: string; pnl: number }[];
}>): readonly EquityPoint[] {
  const points: EquityPoint[] = [];
  let equity = args.initialEquity;
  points.push({ timeUtc: new Date(args.startTimeUtc).toISOString(), equity });
  for (const t of args.trades) {
    equity += t.pnl;
    points.push({ timeUtc: new Date(t.exitTimeUtc).toISOString(), equity });
  }
  return points;
}

/**
 * Phase 1 Backtest routes.
 */
export const backtestsRoutes: FastifyPluginAsync = async (server) => {
  server.post("/backtests", async (request) => {
    const body = createBacktestBodySchema.parse(request.body);

    const initialEquity = body.initialEquity ?? 10_000;

    let baseParams = body.params;
    let parameterSetId: string | null = null;

    if (body.parameterSetId !== undefined) {
      const ps = await getParameterSetById({ supabase: server.supabase, id: body.parameterSetId });
      baseParams = ps.params;
      parameterSetId = ps.id;
    }

    const validatedBase = strategyParamsSchema.parse(baseParams);
    const paramsSnapshot = strategyParamsSchema.parse({
      ...validatedBase,
      symbol: body.symbol,
      interval: body.interval
    });

    const id = randomUUID();
    const run = await createBacktestRun({
      supabase: server.supabase,
      id,
      parameterSetId,
      paramsSnapshot,
      engineVersion: server.env.ENGINE_VERSION,
      symbol: body.symbol,
      interval: body.interval,
      startTimeUtc: body.startTimeUtc,
      endTimeUtc: body.endTimeUtc,
      initialEquity
    });

    server.backtestQueue.enqueue(id);
    return run;
  });

  server.get("/backtests/:runId", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    return await getBacktestRunById({ supabase: server.supabase, id: params.runId });
  });

  server.get("/backtests", async (request) => {
    const pagination = parsePaginationQuery(request.query);
    const result = await listBacktestRuns({ supabase: server.supabase, pagination });
    return toPagedResponse({ items: result.items, total: result.total, pagination });
  });

  server.get("/backtests/:runId/trades", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const pagination = parsePaginationQuery(request.query);
    const result = await listTradesByRunId({ supabase: server.supabase, runId: params.runId, pagination });
    return toPagedResponse({ items: result.items, total: result.total, pagination });
  });

  server.get("/backtests/:runId/equity", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const pagination = parsePaginationQuery(request.query);

    const run = await getBacktestRunById({ supabase: server.supabase, id: params.runId });
    const trades = await listAllTradesByRunId({ supabase: server.supabase, runId: params.runId });

    const points = buildEquityPoints({
      initialEquity: run.initialEquity,
      startTimeUtc: run.startTimeUtc,
      trades: trades.map((t) => ({ exitTimeUtc: t.exitTimeUtc, pnl: t.pnl }))
    });

    const start = pagination.offset;
    const end = pagination.offset + pagination.limit;
    const page = points.slice(start, end);
    return toPagedResponse({ items: page, total: points.length, pagination });
  });

  server.post("/backtests/compare", async (request) => {
    const body = compareBodySchema.parse(request.body);
    return await compareBacktestRuns({ supabase: server.supabase, runIds: body.runIds });
  });

  server.post("/backtests/grid", async (request) => {
    const body = gridBodySchema.parse(request.body);
    const initialEquity = body.initialEquity ?? 10_000;

    const baseValidated = strategyParamsSchema.parse(body.baseParams);
    const baseObj = toRecordOrThrow({ value: structuredClone(baseValidated), path: "baseParams" });

    const overrideValueLists = body.overrides.map((o) => o.values);
    const combinations = cartesianProduct(overrideValueLists);

    const gridRunId = randomUUID();
    const runIds: string[] = [];

    for (const symbol of body.symbols) {
      for (const interval of body.intervals) {
        for (const combo of combinations) {
          let nextParamsObj: Record<string, unknown> = baseObj;

          for (let i = 0; i < body.overrides.length; i += 1) {
            const o = body.overrides[i];
            const v = combo[i];
            if (o === undefined || v === undefined) {
              continue;
            }
            nextParamsObj = setObjectPath({ obj: nextParamsObj, path: o.path, value: v });
          }

          // Ensure run-level symbol/interval are consistent.
          nextParamsObj = setObjectPath({ obj: nextParamsObj, path: "symbol", value: symbol });
          nextParamsObj = setObjectPath({ obj: nextParamsObj, path: "interval", value: interval });

          const paramsSnapshot = strategyParamsSchema.parse(nextParamsObj);
          const id = randomUUID();

          await createBacktestRun({
            supabase: server.supabase,
            id,
            parameterSetId: null,
            paramsSnapshot,
            engineVersion: server.env.ENGINE_VERSION,
            symbol,
            interval,
            startTimeUtc: body.startTimeUtc,
            endTimeUtc: body.endTimeUtc,
            initialEquity
          });

          runIds.push(id);
          server.backtestQueue.enqueue(id);

          // Optional: keep a light trace of the grid run association.
          await insertRunEvent({
            supabase: server.supabase,
            event: {
              id: randomUUID(),
              run_id: id,
              level: "info",
              code: "GRID_RUN_MEMBER",
              message: "Run created as part of a grid run.",
              context: { gridRunId }
            }
          });
        }
      }
    }

    return { gridRunId, runIds };
  });
};

