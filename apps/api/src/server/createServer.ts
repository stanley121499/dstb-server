import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { ApiError, toApiErrorBody, validationError } from "../http/apiError.js";
import { isZodError, zodIssuesToDetails } from "../http/zodError.js";
import { registerV1Routes } from "../routes/v1/registerV1Routes.js";
import { createSupabaseServerClient } from "../supabase/client.js";
import type { Env } from "./env.js";
import { isAllowedCorsOrigin } from "./cors.js";
import { decorateServerContext } from "./context.js";
import { BacktestQueue } from "../jobs/backtestQueue.js";
import { WebSocketConnectionManager } from "../websocket/connectionManager.js";
import { backtestEvents } from "../websocket/backtestEvents.js";
import { registerWebSocketRoutes } from "../websocket/websocketRoutes.js";

export type CreateServerArgs = Readonly<{
  env: Env;
}>;

/**
 * Creates a Fastify server instance with:
 * - CORS allowlist (localhost + Vercel + env overrides)
 * - WebSocket support for real-time backtest updates
 * - Standard error format (docs/15-api-contracts.md)
 *
 * @returns A configured Fastify server (not listening yet).
 */
export async function createServer(args: CreateServerArgs) {
  const server = Fastify({
    logger: true
  });

  const supabase = createSupabaseServerClient(args.env);
  
  // Initialize results file writer for optimization mode
  // Results are written to file instead of DB for 10-50x speedup
  const { ResultsFileWriter } = await import("../jobs/resultsFileWriter.js");
  const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsWriter = new ResultsFileWriter(sessionId);
  console.log(`[Server] Optimization results will be written to: ${resultsWriter.getFilePath()}`);
  
  // Concurrent backtest processing - configurable via env var
  // Default: 10 concurrent (good balance for Supabase free tier)
  // Set BACKTEST_CONCURRENCY=1 for sequential (safer, slower)
  // Set BACKTEST_CONCURRENCY=20 for faster optimizations (watch connection limits!)
  const maxConcurrency = parseInt(args.env.BACKTEST_CONCURRENCY ?? "40", 10);
  const backtestQueue = new BacktestQueue({ supabase, maxConcurrency, resultsWriter });
  const wsManager = new WebSocketConnectionManager();

  // Wire up the event emitter to broadcast to WebSocket clients.
  backtestEvents.onProgress((message) => {
    wsManager.broadcast(message);
  });

  decorateServerContext(server, {
    env: args.env,
    supabase,
    backtestQueue,
    wsManager
  });

  await server.register(cors, {
    origin: (origin, cb) => {
      const allowed = isAllowedCorsOrigin({
        origin,
        extraAllowedOriginsCsv: args.env.CORS_ALLOWED_ORIGINS
      });
      cb(null, allowed);
    },
    credentials: true
  });

  // Register WebSocket plugin.
  await server.register(websocket);

  server.get("/health", async () => ({ ok: true }));

  await server.register(registerV1Routes, { prefix: "/v1" });

  // Register WebSocket routes.
  await registerWebSocketRoutes(server, wsManager);

  // Start background processing after routes are registered.
  // This also recovers any tests stuck in "running" status from previous crashes.
  await backtestQueue.start();

  server.setErrorHandler((err, _request, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.statusCode).send(toApiErrorBody(err));
      return;
    }

    if (isZodError(err)) {
      const apiErr = validationError({
        message: "Validation failed",
        details: zodIssuesToDetails(err.issues)
      });
      reply.status(apiErr.statusCode).send(toApiErrorBody(apiErr));
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    server.log.error({ err, message }, "Unhandled error");

    const apiErr = new ApiError({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error"
    });
    reply.status(apiErr.statusCode).send(toApiErrorBody(apiErr));
  });

  return server;
}





