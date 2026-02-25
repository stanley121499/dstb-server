import { createHash, randomBytes } from "node:crypto";

import { ExchangeError } from "./ExchangeError.js";

type SignableParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

export type BitunixAuthPayload = Readonly<{
  nonce: string;
  timestamp: number;
  sign: string;
}>;

/**
 * Generates a unique nonce string for Bitunix authentication.
 */
export function createNonce(byteLength = 16): string {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "nonce byteLength must be a positive integer"
    });
  }
  return randomBytes(byteLength).toString("hex");
}

/**
 * Returns the current timestamp in milliseconds.
 */
export function createTimestampMs(): number {
  return Date.now();
}

/**
 * Signs request parameters using SHA256 for Bitunix.
 *
 * Bitunix signature algorithm (from official docs):
 * 1. digest = SHA256(nonce + timestamp + api-key + queryParams + body)
 * 2. sign = SHA256(digest + secretKey)
 *
 * Inputs:
 * - nonce: random string
 * - timestamp: current timestamp in milliseconds
 * - apiKey: API key
 * - queryParams: sorted query parameters string
 * - body: JSON body string (no spaces)
 * - secretKey: API secret
 *
 * Outputs:
 * - Hex-encoded signature string.
 *
 * Error behavior:
 * - Throws ExchangeError on invalid inputs.
 */
export function signRequest(args: Readonly<{
  nonce: string;
  timestamp: number;
  apiKey: string;
  queryParams: string;
  body: string;
  secretKey: string;
}>): string {
  // Step 1: Validate inputs.
  if (typeof args.secretKey !== "string" || args.secretKey.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "secretKey must be a non-empty string"
    });
  }
  if (typeof args.apiKey !== "string" || args.apiKey.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "apiKey must be a non-empty string"
    });
  }

  // Step 2: Build the first payload: nonce + timestamp + api-key + queryParams + body
  const firstPayload = `${args.nonce}${args.timestamp}${args.apiKey}${args.queryParams}${args.body}`;

  // Step 3: First SHA256 hash
  const digest = createHash("sha256").update(firstPayload).digest("hex");

  // Step 4: Second SHA256 hash: digest + secretKey
  const sign = createHash("sha256").update(digest + args.secretKey).digest("hex");

  return sign;
}

/**
 * Builds the auth payload (nonce/timestamp/sign) for Bitunix REST/WS requests.
 *
 * Inputs:
 * - apiKey: API key (needed for signature)
 * - secretKey: API secret
 * - queryParams: query parameters string (sorted)
 * - body: JSON body string (no spaces)
 *
 * Outputs:
 * - BitunixAuthPayload with nonce, timestamp, and sign.
 */
export function createAuthPayload(args: Readonly<{
  apiKey: string;
  secretKey: string;
  queryParams: string;
  body: string;
  nonce?: string;
  timestamp?: number;
}>): BitunixAuthPayload {
  // Step 1: Resolve nonce and timestamp inputs.
  const nonce = args.nonce ?? createNonce();
  const timestamp = args.timestamp ?? createTimestampMs();

  // Step 2: Validate nonce value.
  if (typeof nonce !== "string" || nonce.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "nonce must be a non-empty string"
    });
  }

  // Step 3: Validate timestamp value.
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "timestamp must be a positive number"
    });
  }

  // Step 4: Build the signed payload.
  const sign = signRequest({
    nonce,
    timestamp,
    apiKey: args.apiKey,
    queryParams: args.queryParams,
    body: args.body,
    secretKey: args.secretKey
  });

  return {
    nonce,
    timestamp,
    sign
  };
}

function serializeParams(params: SignableParams): string {
  // Step 1: Validate params input type.
  if (typeof params !== "object" || params === null) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "params must be an object"
    });
  }

  // Step 2: Normalize entries into sorted key=value pairs.
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      // Step 2a: Validate key and format value.
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new ExchangeError({
          code: "INVALID_ORDER",
          message: "params keys must be non-empty strings"
        });
      }
      const formatted = formatParamValue(value);
      return `${key}=${formatted}`;
    })
    .sort((a, b) => a.localeCompare(b));

  // Step 3: Join entries into a query-like string.
  return entries.join("&");
}

function formatParamValue(value: string | number | boolean | null | undefined): string {
  // Step 1: Normalize nullish values.
  if (value === null || value === undefined) {
    return "";
  }
  // Step 2: Pass through strings as-is.
  if (typeof value === "string") {
    return value;
  }
  // Step 3: Validate numeric values.
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ExchangeError({
        code: "INVALID_ORDER",
        message: "params contains non-finite number"
      });
    }
    return String(value);
  }
  // Step 4: Convert booleans to literal strings.
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  // Step 5: Reject unsupported types.
  throw new ExchangeError({
    code: "INVALID_ORDER",
    message: "params contains unsupported value type"
  });
}

/**
 * Splits auth fields (nonce/timestamp) from signable params.
 */
function splitAuthParams(params: SignableParams): Readonly<{
  nonce: string;
  timestamp: number;
  stripped: SignableParams;
}> {
  // Step 1: Validate params input.
  if (typeof params !== "object" || params === null) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "params must be an object"
    });
  }

  // Step 2: Extract nonce and timestamp fields.
  const nonceValue = params.nonce;
  const timestampValue = params.timestamp;
  const nonce = typeof nonceValue === "string" ? nonceValue : null;
  const timestamp = typeof timestampValue === "number" ? timestampValue : null;

  if (nonce === null || nonce.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "nonce is required for signature"
    });
  }

  if (timestamp === null || !Number.isFinite(timestamp) || timestamp <= 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "timestamp is required for signature"
    });
  }

  // Step 3: Remove auth fields from params before serialization.
  const stripped: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "nonce" || key === "timestamp") {
      continue;
    }
    stripped[key] = value;
  }

  // Step 4: Return normalized auth fields and stripped params.
  return {
    nonce,
    timestamp,
    stripped
  };
}
