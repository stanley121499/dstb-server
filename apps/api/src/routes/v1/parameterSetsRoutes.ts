import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { parsePaginationQuery, toPagedResponse } from "../../http/pagination.js";
import { strategyParamsSchema } from "../../domain/strategyParams.js";
import { createParameterSet, getParameterSetById, listParameterSets } from "../../supabase/parameterSetsRepo.js";

const createParameterSetBodySchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    params: strategyParamsSchema
  })
  .strict();

const idParamsSchema = z
  .object({
    id: z.string().uuid()
  })
  .strict();

/**
 * Phase 1 ParameterSet routes.
 */
export const parameterSetsRoutes: FastifyPluginAsync = async (server) => {
  server.post("/parameter-sets", async (request) => {
    const body = createParameterSetBodySchema.parse(request.body);

    const created = await createParameterSet({
      supabase: server.supabase,
      name: body.name,
      description: body.description ?? null,
      params: body.params
    });

    return created;
  });

  server.get("/parameter-sets", async (request) => {
    const pagination = parsePaginationQuery(request.query);
    const result = await listParameterSets({ supabase: server.supabase, pagination });
    return toPagedResponse({ items: result.items, total: result.total, pagination });
  });

  server.get("/parameter-sets/:id", async (request) => {
    const params = idParamsSchema.parse(request.params);
    return await getParameterSetById({ supabase: server.supabase, id: params.id });
  });
};





