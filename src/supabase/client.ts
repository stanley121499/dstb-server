import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseEnv } from "./env.js";

/**
 * Build a Supabase client using the service role (server-side only).
 */
export function createServiceRoleClient(env: SupabaseEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
