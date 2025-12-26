import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getRequiredEnv } from "../config/env";

/**
 * Creates the browser Supabase client.
 *
 * IMPORTANT:
 * - Uses the anon key (public by design).
 * - Never use the service role key in the frontend.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const env = getRequiredEnv();

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}




