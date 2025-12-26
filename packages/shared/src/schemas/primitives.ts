/**
 * @file Shared primitive validation schemas.
 *
 * These are used across API DTOs and parameter schemas.
 *
 * Standards enforced:
 * - Strict TypeScript
 * - No unsafe casts
 * - No `any`
 * - Double quotes for strings
 */

import { z } from "zod";

/**
 * Matches canonical UUID v4/v1/etc textual representation.
 */
export const UuidSchema = z
  .string()
  .uuid({ message: "Must be a valid UUID" });

/**
 * ISO-8601 UTC datetime string, required to end with `Z`.
 *
 * Examples:
 * - "2025-01-01T00:00:00Z"
 * - "2025-01-01T00:00:00.000Z"
 */
export const IsoUtcDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    "Must be an ISO-8601 UTC timestamp ending with Z"
  );

/**
 * New York session date as `YYYY-MM-DD`.
 */
export const NyDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date string YYYY-MM-DD");

/**
 * Time-of-day string `HH:MM` (24h).
 */
export const HhMmTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a time string HH:MM");

/**
 * Coerce a query-string-ish value to a number if possible.
 *
 * - Accepts numbers.
 * - Accepts numeric strings ("50").
 * - Rejects arrays/objects.
 */
const QueryNumberSchema = z.preprocess((value: unknown) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return value;
    }

    const parsed = Number(trimmed);
    return parsed;
  }

  return value;
}, z.number({ invalid_type_error: "Must be a number" }));

/**
 * Offset for offset/limit pagination.
 *
 * Authoritative rules from docs:
 * - default 0
 * - min 0
 */
export const OffsetSchema = QueryNumberSchema.int("Must be an integer")
  .min(0, "Must be >= 0")
  .default(0);

/**
 * Limit for offset/limit pagination.
 *
 * Authoritative rules from docs:
 * - default 50
 * - min 1
 * - max 500
 */
export const LimitSchema = QueryNumberSchema.int("Must be an integer")
  .min(1, "Must be >= 1")
  .max(500, "Must be <= 500")
  .default(50);

/**
 * Basis points value (bps). Must be >= 0.
 */
export const BpsSchema = z
  .number({ invalid_type_error: "Must be a number" })
  .min(0, "Must be >= 0");




