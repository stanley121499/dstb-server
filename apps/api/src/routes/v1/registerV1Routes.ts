import type { FastifyPluginAsync } from "fastify";

import { backtestsRoutes } from "./backtestsRoutes.js";
import { parameterSetsRoutes } from "./parameterSetsRoutes.js";

/**
 * Registers `/v1` routes.
 *
 * This file acts as a stable wiring point so `createServer()` stays small.
 */
export const registerV1Routes: FastifyPluginAsync = async (server) => {
  // Phase 1 routes will be registered here.
  server.get("/", async () => ({
    ok: true,
    version: "v1"
  }));

  await server.register(parameterSetsRoutes);
  await server.register(backtestsRoutes);
};





