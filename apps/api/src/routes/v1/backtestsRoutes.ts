import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { strategyParamsSchema } from "../../domain/strategyParams.js";
import { parsePaginationQuery, toPagedResponse } from "../../http/pagination.js";
import { compareBacktestRuns, createBacktestRun, getBacktestRunById, listBacktestRuns } from "../../supabase/backtestRunsRepo.js";
import { getParameterSetById } from "../../supabase/parameterSetsRepo.js";
import { listTradesByRunId } from "../../supabase/backtestTradesRepo.js";

const isoDateSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => Number.isFinite(Date.parse(v)), { message: "Expected a valid date string (ISO-8601 recommended)" });

const runBacktestBodySchema = z
  .object({
    parameterSetId: z.string().uuid().optional(),
    params: strategyParamsSchema.optional(),

    symbol: z.string().trim().min(1),
    interval: z.string().trim().min(1),
    startTimeUtc: isoDateSchema,
    endTimeUtc: isoDateSchema,
    initialEquity: z
      .number()
      .positive("initialEquity must be > 0")
      .optional()
      .default(10_000)
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasParamSetId = v.parameterSetId !== undefined;
    const hasInlineParams = v.params !== undefined;

    if (hasParamSetId === hasInlineParams) {
      ctx.addIssue({
        code: "custom",
        path: ["parameterSetId"],
        message: "Provide exactly one of: parameterSetId OR params"
      });
    }

    const startMs = Date.parse(v.startTimeUtc);
    const endMs = Date.parse(v.endTimeUtc);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= endMs) {
      ctx.addIssue({
        code: "custom",
        path: ["startTimeUtc"],
        message: "startTimeUtc must be < endTimeUtc"
      });
    }

    if (v.params !== undefined) {
      if (v.params.symbol !== v.symbol) {
        ctx.addIssue({
          code: "custom",
          path: ["params", "symbol"],
          message: "params.symbol must match symbol"
        });
      }
      if (v.params.interval !== v.interval) {
        ctx.addIssue({
          code: "custom",
          path: ["params", "interval"],
          message: "params.interval must match interval"
        });
      }
    }
  });

const idParamsSchema = z
  .object({
    runId: z.string().uuid()
  })
  .strict();

const compareBodySchema = z
  .object({
    runIds: z.array(z.string().uuid()).min(1)
  })
  .strict();

/**
 * Phase 1 backtest routes (docs/15-api-contracts.md).
 */
export const backtestsRoutes: FastifyPluginAsync = async (server) => {
  server.post("/backtests", async (request) => {
    const body = runBacktestBodySchema.parse(request.body);

    const runId = randomUUID();

    let resolvedParams: z.infer<typeof strategyParamsSchema>;
    if (body.parameterSetId !== undefined) {
      // Load parameter set and ensure it is valid (repo already validates).
      // Allow symbol/interval to come from request, but keep everything else from the saved set.
      const ps = await getParameterSetById({ supabase: server.supabase, id: body.parameterSetId });
      resolvedParams = strategyParamsSchema.parse({ ...ps.params, symbol: body.symbol, interval: body.interval });
    } else {
      // Should be impossible due to schema refinement; keep defensive.
      if (body.params === undefined) {
        throw new Error("Missing params snapshot");
      }
      resolvedParams = body.params;
    }

    const created = await createBacktestRun({
      supabase: server.supabase,
      id: runId,
      parameterSetId: body.parameterSetId ?? null,
      paramsSnapshot: resolvedParams,
      engineVersion: server.env.ENGINE_VERSION,
      symbol: body.symbol,
      interval: body.interval,
      startTimeUtc: new Date(body.startTimeUtc).toISOString(),
      endTimeUtc: new Date(body.endTimeUtc).toISOString(),
      initialEquity: body.initialEquity
    });

    // Async processing: queue the run and return immediately.
    server.backtestQueue.enqueue(created.id);
    return created;
  });

  server.get("/backtests", async (request) => {
    const pagination = parsePaginationQuery(request.query);
    const result = await listBacktestRuns({ supabase: server.supabase, pagination });
    return toPagedResponse({ items: result.items, total: result.total, pagination });
  });

  server.get("/backtests/:runId", async (request) => {
    const params = idParamsSchema.parse(request.params);
    return await getBacktestRunById({ supabase: server.supabase, id: params.runId });
  });

  server.get("/backtests/:runId/trades", async (request) => {
    const params = idParamsSchema.parse(request.params);
    const pagination = parsePaginationQuery(request.query);
    const result = await listTradesByRunId({ supabase: server.supabase, runId: params.runId, pagination });
    return toPagedResponse({ items: result.items, total: result.total, pagination });
  });

  server.post("/backtests/compare", async (request) => {
    const body = compareBodySchema.parse(request.body);
    return await compareBacktestRuns({ supabase: server.supabase, runIds: body.runIds });
  });
};

