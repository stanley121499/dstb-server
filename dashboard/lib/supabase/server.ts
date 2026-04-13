import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase server client for Server Components, Route Handlers, and Server Actions.
 */
export async function createSupabaseServerClient(): Promise<ReturnType<typeof createServerClient>> {
  const cookieStore = await cookies();
  type SetOpts = NonNullable<Parameters<typeof cookieStore.set>[2]>;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url.length === 0 || anon === undefined || anon.length === 0) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: ReadonlyArray<{ name: string; value: string; options?: SetOpts }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* ignore when called from a Server Component that cannot set cookies */
        }
      }
    }
  });
}
