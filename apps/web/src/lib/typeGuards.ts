/**
 * Shared runtime type guards.
 *
 * These are intentionally small and dependency-free.
 */

/**
 * Checks if a value is a non-null object (including arrays).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Checks if a value is a string.
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Checks if a value is a finite number (not NaN/Infinity).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Checks if a value is a boolean.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Checks if a value is an array.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Validates a UTC ISO-8601 string by round-tripping through Date.
 */
export function isIsoUtcString(value: unknown): value is string {
  if (!isString(value)) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  // Require the string to be in ISO-ish format and UTC (`Z`).
  return value.includes("T") && value.endsWith("Z");
}

/**
 * Safe property access for unknown JSON records.
 */
export function getRecordProp(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}




