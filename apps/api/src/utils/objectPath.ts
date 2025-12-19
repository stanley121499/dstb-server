/**
 * Dot-path setter for plain objects, designed for grid overrides.
 *
 * Security:
 * - Blocks prototype pollution keys.
 * - Only allows simple alphanumeric/underscore segments.
 */
export function setObjectPath(args: Readonly<{
  obj: Record<string, unknown>;
  path: string;
  value: unknown;
}>): Record<string, unknown> {
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const segments = args.path.split(".").map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("Override path must not be empty");
  }

  for (const seg of segments) {
    if (!/^\w+$/.test(seg)) {
      throw new Error(`Invalid override path segment: ${seg}`);
    }
    if (seg === "__proto__" || seg === "prototype" || seg === "constructor") {
      throw new Error(`Unsafe override path segment blocked: ${seg}`);
    }
  }

  const out = structuredClone(args.obj);
  let cursor: Record<string, unknown> = out;

  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i];
    if (key === undefined) {
      // Should not happen because we validate segments length above, but `noUncheckedIndexedAccess`
      // requires us to guard against undefined.
      throw new Error("Override path segment is missing");
    }
    const isLeaf = i === segments.length - 1;
    if (isLeaf) {
      cursor[key] = args.value;
      break;
    }

    const next = cursor[key];
    if (isPlainObject(next)) {
      cursor = next;
      continue;
    }

    // Create missing nested objects as needed.
    const created: Record<string, unknown> = {};
    cursor[key] = created;
    cursor = created;
  }

  return out;
}

