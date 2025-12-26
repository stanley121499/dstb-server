import { z } from "zod";

/**
 * Offset/limit pagination contract (authoritative) from `docs/15-api-contracts.md`.
 */
export type Pagination = Readonly<{
  offset: number;
  limit: number;
}>;

export type PagedResponse<TItem> = Readonly<{
  items: readonly TItem[];
  total: number;
  offset: number;
  limit: number;
}>;

const paginationQuerySchema = z
  .object({
    offset: z
      .string()
      .optional()
      .default("0")
      .transform(Number)
      .refine((v) => Number.isInteger(v) && v >= 0, {
        message: "offset must be an integer >= 0"
      }),
    limit: z
      .string()
      .optional()
      .default("50")
      .transform(Number)
      .refine((v) => Number.isInteger(v) && v >= 1 && v <= 500, {
        message: "limit must be an integer between 1 and 500"
      })
  })
  .strict();

/**
 * Parses pagination query parameters.
 *
 * @param rawQuery - `request.query` from Fastify.
 */
export function parsePaginationQuery(rawQuery: unknown): Pagination {
  const parsed = paginationQuerySchema.parse(rawQuery);
  return { offset: parsed.offset, limit: parsed.limit };
}

/**
 * Creates a paged response in the API contract shape.
 */
export function toPagedResponse<TItem>(args: {
  items: readonly TItem[];
  total: number;
  pagination: Pagination;
}): PagedResponse<TItem> {
  return {
    items: args.items,
    total: args.total,
    offset: args.pagination.offset,
    limit: args.pagination.limit
  };
}





