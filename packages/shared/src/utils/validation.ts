/**
 * @file Validation helpers for turning Zod parse failures into the standard API error shape.
 */

import { z } from "zod";

import type { ErrorDetail, ErrorResponse } from "../schemas/errors";

/**
 * Convert a Zod path array into a stable string path.
 *
 * Examples:
 * - ["params", "session", "openingRangeMinutes"] -> "params.session.openingRangeMinutes"
 * - ["rows", 0, "metrics", "tradeCount"] -> "rows[0].metrics.tradeCount"
 */
export function formatZodPath(path: ReadonlyArray<string | number>): string {
  return path.reduce((acc, part) => {
    if (typeof part === "number") {
      return `${acc}[${part}]`;
    }

    if (acc.length === 0) {
      return part;
    }

    return `${acc}.${part}`;
  }, "");
}

/**
 * Convert Zod issues into the standard error `details` array.
 */
export function formatZodIssuesAsErrorDetails(
  issues: ReadonlyArray<z.ZodIssue>
): ErrorDetail[] {
  return issues.map((issue) => ({
    path: formatZodPath(issue.path),
    message: issue.message
  }));
}

/**
 * Create an API error response payload for validation errors.
 */
export function makeValidationErrorResponse(
  message: string,
  issues: ReadonlyArray<z.ZodIssue>
): ErrorResponse {
  const details = formatZodIssuesAsErrorDetails(issues);

  return {
    error: {
      code: "VALIDATION_ERROR",
      message,
      details
    }
  };
}

/**
 * Safely parse `input` with a Zod schema and return either the parsed value or
 * a standard validation error response.
 */
export function safeParseOrErrorResponse<TSchema extends z.ZodType<unknown>>(
  schema: TSchema,
  input: unknown,
  message: string
):
  | { ok: true; data: TSchema["_output"] }
  | { ok: false; error: ErrorResponse } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: makeValidationErrorResponse(message, result.error.issues)
  };
}

/**
 * Parse `input` with a Zod schema or throw an Error containing a validation summary.
 *
 * Intended for internal tooling/tests where throwing is acceptable.
 */
export function parseOrThrow<TSchema extends z.ZodType<unknown>>(
  schema: TSchema,
  input: unknown,
  message: string
): TSchema["_output"] {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const details = formatZodIssuesAsErrorDetails(result.error.issues)
    .map((d) => `${d.path}: ${d.message}`)
    .join("; ");

  throw new Error(`${message}: ${details}`);
}
