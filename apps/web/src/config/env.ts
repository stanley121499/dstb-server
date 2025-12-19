export type RequiredEnv = Readonly<{
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
}>;

/**
 * Ensures the provided string is non-empty.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates that a string is a valid URL.
 */
function isValidUrl(value: string): boolean {
  try {
    // URL constructor throws for invalid URLs.
    // We also require an origin (protocol + host).
    const url = new URL(value);
    return url.origin.length > 0;
  } catch {
    return false;
  }
}

let cachedEnv: RequiredEnv | null = null;

/**
 * Reads and validates all required frontend environment variables.
 *
 * Expected env vars (Vite):
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_ANON_KEY
 * - VITE_API_BASE_URL
 *
 * @throws Error when missing or invalid.
 */
export function getRequiredEnv(): RequiredEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const supabaseUrlRaw: unknown = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKeyRaw: unknown = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const apiBaseUrlRaw: unknown = import.meta.env.VITE_API_BASE_URL;

  if (!isNonEmptyString(supabaseUrlRaw)) {
    throw new Error("Missing required env var: VITE_SUPABASE_URL");
  }

  if (!isNonEmptyString(supabaseAnonKeyRaw)) {
    throw new Error("Missing required env var: VITE_SUPABASE_ANON_KEY");
  }

  if (!isNonEmptyString(apiBaseUrlRaw)) {
    throw new Error("Missing required env var: VITE_API_BASE_URL");
  }

  if (!isValidUrl(supabaseUrlRaw)) {
    throw new Error("Invalid URL in env var VITE_SUPABASE_URL");
  }

  if (!isValidUrl(apiBaseUrlRaw)) {
    throw new Error("Invalid URL in env var VITE_API_BASE_URL");
  }

  cachedEnv = {
    supabaseUrl: supabaseUrlRaw,
    supabaseAnonKey: supabaseAnonKeyRaw,
    apiBaseUrl: apiBaseUrlRaw
  };

  return cachedEnv;
}
