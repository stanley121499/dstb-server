/**
 * Date/time helpers.
 */

export type ParsedUtcIso = Readonly<{
  isoUtc: string | null;
  error: string | null;
}>;

/**
 * Parses an `<input type="datetime-local">` value as UTC.
 *
 * Browser gives a timezone-less string like `YYYY-MM-DDTHH:mm`.
 * We interpret it as UTC by appending `:00Z`.
 */
export function parseDatetimeLocalAsUtcIso(value: string): ParsedUtcIso {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { isoUtc: null, error: "Required" };
  }

  const iso = `${trimmed}:00.000Z`;
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return { isoUtc: null, error: "Invalid date/time" };
  }

  return { isoUtc: iso, error: null };
}
