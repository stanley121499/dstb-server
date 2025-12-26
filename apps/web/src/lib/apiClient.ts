import { getRequiredEnv } from "../config/env";
import { getRecordProp, isRecord, isString } from "./typeGuards";

export type ApiErrorDetail = Readonly<{
  path: string;
  message: string;
}>;

export type ApiErrorPayload = Readonly<{
  code: string;
  message: string;
  details: ApiErrorDetail[];
}>;

export class ApiError extends Error {
  public readonly status: number;
  public readonly payload: ApiErrorPayload | null;

  public constructor(message: string, status: number, payload: ApiErrorPayload | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export type OffsetLimitPage<T> = Readonly<{
  items: T[];
  total: number;
  offset: number;
  limit: number;
}>;

/**
 * Builds an absolute API URL from `VITE_API_BASE_URL` and a path.
 */
function buildApiUrl(path: string, query?: Readonly<Record<string, string>>): string {
  const { apiBaseUrl } = getRequiredEnv();
  const url = new URL(path, apiBaseUrl);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  return url.toString();
}

function parseApiErrorPayload(value: unknown): ApiErrorPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const errorVal = getRecordProp(value, "error");

  if (!isRecord(errorVal)) {
    return null;
  }

  const codeVal = getRecordProp(errorVal, "code");
  const messageVal = getRecordProp(errorVal, "message");
  const detailsVal = getRecordProp(errorVal, "details");

  if (!isString(codeVal) || !isString(messageVal) || !Array.isArray(detailsVal)) {
    return null;
  }

  const details: ApiErrorDetail[] = detailsVal
    .filter((d): d is unknown => d !== null)
    .map((d): ApiErrorDetail | null => {
      if (!isRecord(d)) {
        return null;
      }

      const pathV = getRecordProp(d, "path");
      const msgV = getRecordProp(d, "message");

      if (!isString(pathV) || !isString(msgV)) {
        return null;
      }

      return {
        path: pathV,
        message: msgV
      };
    })
    .filter((d): d is ApiErrorDetail => d !== null);

  return {
    code: codeVal,
    message: messageVal,
    details
  };
}

export type FetchJsonOptions = Readonly<{
  method: "GET" | "POST";
  path: string;
  query?: Readonly<Record<string, string>>;
  body?: unknown;
  timeoutMs?: number;
}>;

/**
 * Fetch helper for the DSTB API.
 *
 * - Uses JSON request/response.
 * - Implements a timeout.
 * - Parses standard error payloads from `docs/15-api-contracts.md`.
 */
export async function fetchJson(options: FetchJsonOptions): Promise<unknown> {
  // Increased timeout for large dataset queries (10K+ runs)
  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = {
      method: options.method,
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal
    };

    // With `exactOptionalPropertyTypes`, we must omit `body` entirely when not provided.
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const res = await fetch(buildApiUrl(options.path, options.query), init);

    const text = await res.text();

    const json: unknown =
      text.length > 0
        ? (() => {
            try {
              const parsed: unknown = JSON.parse(text);
              return parsed;
            } catch {
              return null;
            }
          })()
        : null;

    if (!res.ok) {
      const payload = parseApiErrorPayload(json);
      const message = payload ? payload.message : `Request failed with status ${res.status}`;
      throw new ApiError(message, res.status, payload);
    }

    return json;
  } finally {
    window.clearTimeout(timeout);
  }
}




