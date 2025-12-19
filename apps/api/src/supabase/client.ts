import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient as SupabaseJsClient } from "@supabase/supabase-js";

import type { Env } from "../server/env.js";
import type { Database } from "./database.js";

/**
 * Minimal subset of the Supabase client type we rely on.
 *
 * We keep this as the concrete Supabase type to avoid `any` and to keep
 * repository functions strongly typed via generics.
 */
export type SupabaseClient = SupabaseJsClient<Database>;

/**
 * Creates a server-side Supabase client using the service role key.
 *
 * Security:
 * - `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to browsers.
 * - This client is intended for server-only use (API layer).
 */
export function createSupabaseServerClient(env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">) {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // Server-only usage; we don't want cookie/session persistence.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

