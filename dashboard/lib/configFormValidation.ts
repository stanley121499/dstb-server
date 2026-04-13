import { z } from "zod";

import { formatZodIssues, getParamsValidator } from "./server/paramsValidation";

/**
 * Validates editable config row fields (excluding `credentials_ref`, managed outside the dashboard).
 */
export const dashboardConfigFieldsSchema = z
  .object({
    name: z.string().trim().min(1),
    strategy: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    interval: z.string().trim().min(1),
    exchange: z.enum(["paper", "bitunix"]),
    initial_balance: z.coerce.number().finite().positive(),
    maxDailyLossPct: z.coerce.number().finite().positive().lt(50),
    maxPositionSizePct: z.coerce.number().finite().positive().max(100),
    paramsJson: z.string().min(1),
    changeNote: z.string().optional()
  })
  .strict();

export type DashboardConfigFieldsInput = z.infer<typeof dashboardConfigFieldsSchema>;

export type ParamsValidationResult =
  | { ok: true; params: Record<string, unknown>; warning: string | null }
  | { ok: false; zodError: string };

/**
 * Parse `paramsJson`, optionally validate with a strategy schema, and return result for save/create flows.
 */
export function parseAndValidateParams(args: Readonly<{ strategy: string; paramsJson: string }>): ParamsValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.paramsJson) as unknown;
  } catch {
    return { ok: false, zodError: "Invalid JSON in strategy params." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, zodError: "Strategy params must be a JSON object." };
  }
  const record = parsed as Record<string, unknown>;
  const validator = getParamsValidator(args.strategy);
  if (validator === null) {
    return {
      ok: true,
      params: record,
      warning:
        "No strict validation is registered for this strategy yet. Params were saved as-is. Tell Stanley to add a Zod schema in the strategy map after you align on the shape."
    };
  }
  const result = validator.safeParse(record);
  if (!result.success) {
    return { ok: false, zodError: formatZodIssues(result.error) };
  }
  return { ok: true, params: result.data as Record<string, unknown>, warning: null };
}
