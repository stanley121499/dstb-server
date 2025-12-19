/**
 * @file Environment variable parsing helpers.
 *
 * Note: this module intentionally accepts a plain key/value map so it can be
 * used in Node (process.env) and in any other environment that supplies an
 * env-like record.
 */

import { z } from "zod";

/**
 * A minimal environment map type.
 */
export type EnvMap = Record<string, string | undefined>;

/**
 * Parse and validate environment variables using a provided Zod schema.
 *
 * @example
 * const EnvSchema = z.object({
 *   SUPABASE_URL: z.string().url(),
 *   SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)
 * });
 * const env = parseEnv(EnvSchema, process.env);
 */
export function parseEnv<TSchema extends z.ZodType<unknown>>(
  schema: TSchema,
  env: EnvMap
): TSchema["_output"] {
  return schema.parse(env);
}

/**
 * A Zod schema that parses a boolean from common env-var representations.
 *
 * Accepted inputs:
 * - boolean true/false
 * - strings: "true"/"false" (case-insensitive)
 * - strings: "1"/"0"
 */
export const EnvBooleanSchema = z.preprocess((value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return value;
}, z.boolean({ invalid_type_error: "Must be a boolean" }));

/**
 * A Zod schema that parses a number from an env-var string.
 */
export const EnvNumberSchema = z.preprocess((value: unknown) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return value;
    }

    return Number(trimmed);
  }

  return value;
}, z.number({ invalid_type_error: "Must be a number" }));
