/**
 * Reads Supabase connection settings from the environment.
 * The bot server uses the service role key for full database access (RLS bypass).
 */
export type SupabaseEnv = Readonly<{
  url: string;
  serviceRoleKey: string;
}>;

/**
 * Load Supabase URL and service role key, throwing when missing or invalid.
 */
export function loadSupabaseEnv(): SupabaseEnv {
  const url = process.env["SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("Missing or empty SUPABASE_URL.");
  }

  if (typeof serviceRoleKey !== "string" || serviceRoleKey.trim().length === 0) {
    throw new Error("Missing or empty SUPABASE_SERVICE_ROLE_KEY.");
  }

  return {
    url: url.trim(),
    serviceRoleKey: serviceRoleKey.trim()
  };
}
