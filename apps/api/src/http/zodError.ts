import type { ZodIssue } from "zod";
import { z } from "zod";

import type { ApiErrorDetail } from "./apiError.js";

/**
 * Detects ZodError without using unsafe casts.
 */
export function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}

/**
 * Converts Zod issues into the standard API error detail format.
 *
 * `path` uses dot-notation like: "params.session.openingRangeMinutes"
 */
export function zodIssuesToDetails(issues: readonly ZodIssue[]): readonly ApiErrorDetail[] {
  return issues.map((issue) => ({
    path: issue.path.map((p) => String(p)).join("."),
    message: issue.message
  }));
}





