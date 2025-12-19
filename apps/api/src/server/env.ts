import { z } from "zod";

/**
 * Parsed and validated environment variables for the API server.
 *
 * Note: We validate env early to avoid ambiguous runtime failures and to satisfy
 * `docs/18-dev-standards.md` (validate all external inputs).
 *
 * Windows note:
 * - `process.env` contains many extra keys (e.g. `ComSpec`, `PATHEXT`, etc.).
 * - Using Zod `.strict()` on the root env object causes startup crashes with
 *   `ZodError: unrecognized_keys`.
 * - We therefore use `.passthrough()` so we only validate the keys we care about,
 *   while ignoring unrelated OS/environment keys.
 */
export type Env = Readonly<{
  PORT: number;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /**
   * Backtest engine build/version identifier.
   *
   * Phase 1 requirement (docs/10-requirements.md, NFR1): runs must be reproducible with the
   * same engine version. We store this value in `backtest_runs.engine_version`.
   */
  ENGINE_VERSION: string;
  /**
   * Optional extra origins (comma-separated), in addition to localhost and Vercel.
   *
   * Example: "https://mydomain.com,https://staging.mydomain.com"
   */
  CORS_ALLOWED_ORIGINS: string;
}>;

const envSchema = z
  .object({
    PORT: z
      .string()
      .trim()
      .optional()
      .default("3001")
      .transform(Number)
      .refine((v) => Number.isInteger(v) && v > 0 && v < 65536, {
        message: "PORT must be an integer between 1 and 65535"
      }),

    SUPABASE_URL: z.string().trim().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),

    ENGINE_VERSION: z.string().trim().min(1).optional().default("dev"),

    CORS_ALLOWED_ORIGINS: z.string().trim().optional().default("")
  })
  .passthrough();

/**
 * Validates and returns environment variables used by the API.
 *
 * @param rawEnv - Typically `process.env`.
 * @throws If required variables are missing/invalid.
 */
export function readEnv(rawEnv: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        const prefix = path.length > 0 ? `${path}: ` : "";
        return `${prefix}${issue.message}`;
      })
      .join("\n");

    throw new Error(["Invalid API environment configuration.", details].join("\n"));
  }

  const parsed = result.data;
  return {
    PORT: parsed.PORT,
    SUPABASE_URL: parsed.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: parsed.SUPABASE_SERVICE_ROLE_KEY,
    ENGINE_VERSION: parsed.ENGINE_VERSION,
    CORS_ALLOWED_ORIGINS: parsed.CORS_ALLOWED_ORIGINS
  };
}

