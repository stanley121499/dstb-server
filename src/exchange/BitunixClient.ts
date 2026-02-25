import { createAuthPayload } from "./bitunixAuth.js";
import { ExchangeError } from "./ExchangeError.js";
import type { CircuitBreakerSnapshot, CircuitBreakerState, ExchangeErrorCode, RateLimitStatus } from "./types.js";
import type { RequestMethod, RequestArgs } from "./bitunixTypes.js";
import { isRecord } from "./BitunixParsers.js";

// ---------------------------------------------------------------------------
// BitunixClient — shared HTTP transport for all feature API modules.
// Handles rate limiting, authentication, retry, circuit breaking, and
// Bitunix error envelope unwrapping.
// ---------------------------------------------------------------------------

export type BitunixClientConfig = Readonly<{
  apiKey: string;
  secretKey: string;
  restBaseUrl: string;
}>;

export class BitunixClient {
  public readonly publicLimiter: TokenBucket;
  public readonly privateLimiter: TokenBucket;
  public readonly circuitBreaker: CircuitBreaker;
  private lastRateLimitStatus: RateLimitStatus;

  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly restBaseUrl: string;

  public constructor(cfg: BitunixClientConfig) {
    this.apiKey = cfg.apiKey;
    this.secretKey = cfg.secretKey;
    this.restBaseUrl = cfg.restBaseUrl;

    this.publicLimiter = new TokenBucket({ capacity: 20, refillPerSecond: 20 });
    this.privateLimiter = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    this.circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });

    this.lastRateLimitStatus = {
      limit: 20,
      remaining: 20,
      resetAtUtc: null,
      isThrottled: false
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Executes a Bitunix REST request with full retry/auth/circuit-breaker pipeline. */
  public async request(args: RequestArgs): Promise<unknown> {
    return this.circuitBreaker.execute(
      async () => this.requestInternal(args),
      (error) => this.shouldTripCircuit(error)
    );
  }

  /** Returns the last captured rate limit status. */
  public getRateLimitStatus(): RateLimitStatus {
    return { ...this.lastRateLimitStatus };
  }

  /** Returns the circuit breaker snapshot. */
  public getCircuitBreakerSnapshot(): CircuitBreakerSnapshot {
    return this.circuitBreaker.getSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Internal request machinery
  // ---------------------------------------------------------------------------

  private async requestInternal(args: RequestArgs): Promise<unknown> {
    const limiter = args.isPrivate === true ? this.privateLimiter : this.publicLimiter;
    await limiter.consume(1);
    this.lastRateLimitStatus = limiter.getStatus();

    const base = args.restBaseOverride ?? this.restBaseUrl;
    const url = new URL(`${base}${args.path}`);

    // Build sorted query string for Bitunix signature (no equals signs format)
    const sortedQueryParams: Array<[string, string]> = [];
    if (args.query !== undefined) {
      for (const [key, value] of Object.entries(args.query)) {
        if (value === undefined || value === null) continue;
        sortedQueryParams.push([key, String(value)]);
        url.searchParams.set(key, String(value));
      }
    }
    sortedQueryParams.sort((a, b) => a[0].localeCompare(b[0]));
    const queryParamsString = sortedQueryParams.map(([k, v]) => `${k}${v}`).join("");

    const body = args.body === undefined ? undefined : JSON.stringify(args.body);
    const bodyString = body ?? "";

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (args.isPrivate === true) {
      const auth = createAuthPayload({
        apiKey: this.apiKey,
        secretKey: this.secretKey,
        queryParams: queryParamsString,
        body: bodyString
      });
      headers["api-key"] = this.apiKey;
      headers.nonce = auth.nonce;
      headers.timestamp = String(auth.timestamp);
      headers.sign = auth.sign;
    }

    const response = await this.fetchWithRetry({
      url: url.toString(),
      method: args.method,
      headers,
      ...(body === undefined ? {} : { body }),
      rateLimiter: limiter
    });

    const payload = await this.parseJsonResponse(response);
    return this.unwrapBitunixPayload(payload, response.status);
  }

  private async fetchWithRetry(args: Readonly<{
    url: string;
    method: RequestMethod;
    headers: Readonly<Record<string, string>>;
    body?: string;
    rateLimiter: TokenBucket;
  }>): Promise<Response> {
    const maxRetries = 3;
    const timeoutMs = 30_000;
    let attempt = 0;

    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const init: RequestInit = {
          method: args.method,
          headers: args.headers,
          signal: controller.signal,
          ...(args.body === undefined ? {} : { body: args.body })
        };
        const response = await fetch(args.url, init);
        clearTimeout(timeoutId);

        if (response.status === 429 && attempt <= maxRetries) {
          const retryAfter = this.parseRetryAfterMs(response.headers.get("retry-after"));
          await sleep(retryAfter ?? args.rateLimiter.getResetDelayMs());
          continue;
        }
        if (response.status >= 500 && response.status < 600 && attempt <= maxRetries) {
          await sleep(Math.min(2_000, 250 * Math.pow(2, attempt - 1)));
          continue;
        }
        return response;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) {
          if (attempt <= maxRetries) {
            await sleep(Math.min(2_000, 250 * Math.pow(2, attempt - 1)));
            continue;
          }
          throw new ExchangeError({
            code: "NETWORK_ERROR",
            message: `Bitunix API timeout/network error after ${maxRetries} retries: ${args.url}`
          });
        }
        throw err;
      }
    }
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.trim().length === 0) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ExchangeError({
        code: "INTERNAL_ERROR",
        message: `Invalid JSON response from Bitunix (status ${response.status})`
      });
    }
  }

  private unwrapBitunixPayload(payload: unknown, status: number): unknown {
    if (!isRecord(payload)) {
      if (status >= 400) {
        throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Unexpected Bitunix error response (${status})` });
      }
      return payload;
    }
    const code = payload.code;
    const message = payload.msg;
    if (typeof code === "number" && code !== 0) {
      console.error("[BitunixClient] API error - Code:", code, "Message:", message);
      throw this.mapBitunixError(code, typeof message === "string" ? message : "Bitunix error");
    }
    if (status >= 400) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: `Bitunix error response (${status})` });
    }
    return payload.data ?? payload;
  }

  private mapBitunixError(code: number, message: string): ExchangeError {
    const mappedCode = this.resolveBitunixErrorCode(code);
    return new ExchangeError({
      code: mappedCode ?? "INTERNAL_ERROR",
      message: `Bitunix error ${code}: ${message}`,
      details: { code, message }
    });
  }

  private resolveBitunixErrorCode(code: number): ExchangeErrorCode | null {
    const mapping: Readonly<Record<number, ExchangeErrorCode>> = {
      403: "PERMISSION_DENIED",
      10001: "NETWORK_ERROR",
      10002: "INVALID_ORDER",
      10003: "AUTH_ERROR",
      10004: "AUTH_ERROR",
      10005: "RATE_LIMIT",
      10006: "RATE_LIMIT",
      10007: "AUTH_ERROR",
      10008: "INVALID_ORDER",
      20001: "INVALID_SYMBOL",
      20002: "INVALID_ORDER",
      20003: "INSUFFICIENT_BALANCE",
      20004: "INVALID_ORDER",
      20005: "INVALID_ORDER",
      20006: "INVALID_ORDER",
      20007: "ORDER_NOT_FOUND",
      20008: "INVALID_ORDER",
      20009: "INVALID_ORDER",
      20010: "INVALID_ORDER",
      20011: "PERMISSION_DENIED",
      20012: "UNSUPPORTED",
      20013: "PERMISSION_DENIED",
      20014: "PERMISSION_DENIED",
      20015: "UNSUPPORTED",
      20016: "INVALID_ORDER",
      30001: "INVALID_ORDER",
      30002: "INVALID_ORDER",
      30003: "INVALID_ORDER",
      30004: "INVALID_ORDER",
      30005: "INVALID_ORDER",
      30006: "INVALID_ORDER",
      30007: "INVALID_ORDER",
      30008: "INVALID_ORDER",
      30009: "INVALID_ORDER",
      30010: "INVALID_ORDER",
      30011: "INTERNAL_ERROR",
      30012: "INVALID_ORDER",
      30013: "INVALID_ORDER",
      30014: "INVALID_ORDER",
      30015: "INVALID_ORDER",
      30016: "INVALID_ORDER",
      30017: "INVALID_ORDER",
      30018: "INVALID_ORDER",
      30019: "INVALID_ORDER",
      30020: "INVALID_ORDER",
      30021: "INVALID_ORDER",
      30022: "INVALID_ORDER",
      30023: "INVALID_ORDER",
      30024: "INVALID_ORDER",
      30025: "INVALID_ORDER",
      30026: "INVALID_ORDER",
      30027: "INVALID_ORDER",
      30028: "INVALID_ORDER",
      30029: "INVALID_ORDER",
      30030: "INVALID_ORDER",
      30031: "INVALID_ORDER",
      30032: "INVALID_ORDER",
      30033: "INVALID_ORDER",
      30034: "INVALID_ORDER",
      30035: "INVALID_ORDER",
      30036: "INVALID_ORDER",
      30037: "INVALID_ORDER",
      30038: "INVALID_ORDER",
      30039: "INVALID_ORDER",
      30040: "PERMISSION_DENIED",
      30041: "INVALID_ORDER",
      30042: "INVALID_ORDER",
      40001: "PERMISSION_DENIED",
      40002: "INVALID_ORDER",
      40003: "INVALID_ORDER",
      40004: "INVALID_ORDER",
      40005: "PERMISSION_DENIED",
      40006: "INVALID_ORDER",
      40007: "SERVICE_UNAVAILABLE",
      40008: "INVALID_ORDER"
    };
    return mapping[code] ?? null;
  }

  private shouldTripCircuit(error: unknown): boolean {
    if (error instanceof ExchangeError) {
      const nonFatal: readonly ExchangeErrorCode[] = [
        "RATE_LIMIT",
        "INVALID_ORDER",
        "INVALID_SYMBOL",
        "INSUFFICIENT_BALANCE",
        "ORDER_NOT_FOUND",
        "AUTH_ERROR",
        "PERMISSION_DENIED",
        "UNSUPPORTED",
        "INVALID_PARAMETER",
        "NO_POSITION"
      ];
      if (nonFatal.includes(error.code)) return false;
    }
    return true;
  }

  private parseRetryAfterMs(value: string | null): number | null {
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed * 1_000;
  }
}

// ---------------------------------------------------------------------------
// TokenBucket — per-second rate limiter
// ---------------------------------------------------------------------------

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private tokens: number;
  private lastRefillMs: number;

  public constructor(args: Readonly<{ capacity: number; refillPerSecond: number }>) {
    if (!Number.isFinite(args.capacity) || args.capacity <= 0) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Token bucket capacity must be positive" });
    }
    if (!Number.isFinite(args.refillPerSecond) || args.refillPerSecond <= 0) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Token bucket refill rate must be positive" });
    }
    this.capacity = args.capacity;
    this.refillPerSecond = args.refillPerSecond;
    this.tokens = args.capacity;
    this.lastRefillMs = Date.now();
  }

  public async consume(count: number): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      await sleep(this.getResetDelayMs());
    }
  }

  public getStatus(): RateLimitStatus {
    this.refill();
    return {
      limit: this.capacity,
      remaining: Math.max(0, Math.floor(this.tokens)),
      resetAtUtc: new Date(Date.now() + this.getResetDelayMs()).toISOString(),
      isThrottled: this.tokens < 1
    };
  }

  public getResetDelayMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const missing = Math.max(0, 1 - this.tokens);
    const perMs = this.refillPerSecond / 1_000;
    return Math.ceil(missing / perMs);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1_000) * this.refillPerSecond);
    this.lastRefillMs = now;
  }
}

// ---------------------------------------------------------------------------
// CircuitBreaker — protects against repeated exchange failures
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private failureCount: number;
  private lastFailureMs: number;
  private openedAtMs: number | null;
  private state: CircuitBreakerState;

  public constructor(args: Readonly<{ failureThreshold: number; resetTimeoutMs: number }>) {
    this.failureThreshold = args.failureThreshold;
    this.resetTimeoutMs = args.resetTimeoutMs;
    this.failureCount = 0;
    this.lastFailureMs = 0;
    this.openedAtMs = null;
    this.state = "closed";
  }

  public async execute<T>(fn: () => Promise<T>, shouldTrip?: (error: unknown) => boolean): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureMs >= this.resetTimeoutMs) {
        this.state = "half-open";
      } else {
        throw new ExchangeError({ code: "CIRCUIT_OPEN", message: "Circuit breaker open" });
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const shouldCount = shouldTrip === undefined ? true : shouldTrip(error);
      if (shouldCount) this.onFailure();
      throw error;
    }
  }

  public getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureAtUtc: this.lastFailureMs > 0 ? new Date(this.lastFailureMs).toISOString() : null,
      openedAtUtc: this.openedAtMs !== null ? new Date(this.openedAtMs).toISOString() : null
    };
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = "closed";
    this.openedAtMs = null;
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.lastFailureMs = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      if (this.state !== "open") this.openedAtMs = this.lastFailureMs;
      this.state = "open";
      console.error("[BitunixClient] Circuit breaker opened due to repeated failures");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
