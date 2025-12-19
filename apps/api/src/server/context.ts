import type { FastifyInstance } from "fastify";

import type { Env } from "./env.js";
import type { SupabaseClient } from "../supabase/client.js";
import type { BacktestQueue } from "../jobs/backtestQueue.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Validated environment variables. */
    env: Env;
    /** Server-side Supabase client (service role key). */
    supabase: SupabaseClient;
    /** In-process backtest queue (Phase 1). */
    backtestQueue: BacktestQueue;
  }
}

/**
 * Decorates Fastify with shared server context (env, supabase, etc).
 *
 * @param server - The Fastify instance to decorate.
 * @param args - Shared context values.
 */
export function decorateServerContext(
  server: FastifyInstance,
  args: Readonly<{ env: Env; supabase: SupabaseClient; backtestQueue: BacktestQueue }>
): void {
  server.decorate("env", args.env);
  server.decorate("supabase", args.supabase);
  server.decorate("backtestQueue", args.backtestQueue);
}

