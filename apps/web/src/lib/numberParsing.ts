/**
 * Safe number parsing for form inputs.
 */

export type ParsedNumber = Readonly<{
  value: number | null;
  error: string | null;
}>;

/**
 * Parses a number input string, returning a number or a human-friendly error.
 */
export function parseNumber(input: string, opts: Readonly<{ min?: number; max?: number; allowEmpty?: boolean }>): ParsedNumber {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return {
      value: opts.allowEmpty ? null : null,
      error: opts.allowEmpty ? null : "Required"
    };
  }

  const value = Number(trimmed);

  if (!Number.isFinite(value)) {
    return { value: null, error: "Must be a valid number" };
  }

  if (opts.min !== undefined && value < opts.min) {
    return { value: null, error: `Must be >= ${opts.min}` };
  }

  if (opts.max !== undefined && value > opts.max) {
    return { value: null, error: `Must be <= ${opts.max}` };
  }

  return { value, error: null };
}




