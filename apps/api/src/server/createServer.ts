import cors from "@fastify/cors";
import Fastify from "fastify";

import { ApiError, toApiErrorBody, validationError } from "../http/apiError.js";
import { isZodError, zodIssuesToDetails } from "../http/zodError.js";
import { registerV1Routes } from "../routes/v1/registerV1Routes.js";
import { createSupabaseServerClient } from "../supabase/client.js";
import type { Env } from "./env.js";
import { isAllowedCorsOrigin } from "./cors.js";
import { decorateServerContext } from "./context.js";
import { BacktestQueue } from "../jobs/backtestQueue.js";

export type CreateServerArgs = Readonly<{
  env: Env;
}>;

/**
 * Creates a Fastify server instance with:
 * - CORS allowlist (localhost + Vercel + env overrides)
 * - Standard error format (docs/15-api-contracts.md)
 *
 * @returns A configured Fastify server (not listening yet).
 */
export async function createServer(args: CreateServerArgs) {
  const server = Fastify({
    logger: true
  });

  const supabase = createSupabaseServerClient(args.env);
  const backtestQueue = new BacktestQueue({ supabase });

  decorateServerContext(server, {
    env: args.env,
    supabase,
    backtestQueue
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

  server.get("/health", async () => ({ ok: true }));

  await server.register(registerV1Routes, { prefix: "/v1" });

  // Start background processing after routes are registered.
  backtestQueue.start();

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

