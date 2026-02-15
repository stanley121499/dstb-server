import { botConfigSchema } from "./botConfigSchema.js";
import type { BotConfig } from "./botConfigSchema.js";
import { getBotByName } from "./botRepo.js";
import type { SupabaseClient } from "../supabase/client.js";

const allowedSymbols = ["BTC-USD", "ETH-USD", "ZEC-USD"] as const;

type ValidationResult = Readonly<{
  valid: boolean;
  errors: readonly string[];
  parsed?: BotConfig;
}>;

function formatZodIssues(issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>): string[] {
  return issues.map((issue) => {
    const pathStr = issue.path.length > 0 ? issue.path.map((p) => String(p)).join(".") : "config";
    return `${pathStr}: ${issue.message}`;
  });
}

function isKnownSymbol(symbol: string): boolean {
  return allowedSymbols.includes(symbol as (typeof allowedSymbols)[number]);
}

/**
 * Validates a bot configuration payload.
 *
 * Inputs:
 * - Raw config payload and Supabase client.
 *
 * Outputs:
 * - ValidationResult with parsed config when valid.
 *
 * Edge cases:
 * - Duplicate bot names are reported as validation errors.
 *
 * Error behavior:
 * - Throws only on unexpected Supabase errors.
 */
export async function validateBotConfig(args: Readonly<{ config: unknown; supabase: SupabaseClient }>): Promise<ValidationResult> {
  const parseResult = botConfigSchema.safeParse(args.config);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: formatZodIssues(parseResult.error.issues)
    };
  }

  const config = parseResult.data;
  const errors: string[] = [];

  const existing = await getBotByName({ supabase: args.supabase, name: config.name });
  if (existing !== null) {
    errors.push(`name: bot "${config.name}" already exists`);
  }

  if (!isKnownSymbol(config.symbol)) {
    errors.push(`symbol: unsupported symbol "${config.symbol}"`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], parsed: config };
}
