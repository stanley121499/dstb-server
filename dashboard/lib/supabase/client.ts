import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase browser client for Client Components (auth, Realtime, mutations).
 */
export function createBrowserSupabaseClient(): ReturnType<typeof createBrowserClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url.length === 0 || anon === undefined || anon.length === 0) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createBrowserClient(url, anon);
}
