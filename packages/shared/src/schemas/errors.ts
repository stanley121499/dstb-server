/**
 * @file Standard API error response schema.
 *
 * Authoritative shape from `docs/15-api-contracts.md`.
 */

import { z } from "zod";

/**
 * A single validation error detail.
 */
export const ErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string()
});

/**
 * Standard error response payload.
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(ErrorDetailSchema).optional()
  })
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
