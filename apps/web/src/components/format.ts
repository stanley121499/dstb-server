/**
 * Formatting helpers.
 */

/**
 * Formats a nullable percent value.
 *
 * @example
 * - 1.234 -> "1.23%"
 * - null -> "-"
 */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
}

/**
 * Formats a nullable numeric value.
 *
 * @example
 * - 1.234 -> "1.23"
 * - null -> "-"
 */
export function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(2);
}
