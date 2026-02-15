/**
 * Simple in-memory LRU cache for candle data.
 * 
 * Why:
 * - During grid search, we fetch the same candle data hundreds of times
 * - Caching prevents redundant API calls to Binance/Yahoo
 * - Dramatically speeds up optimization runs
 * 
 * Key format: `${source}:${symbol}:${interval}:${startTime}:${endTime}`
 */

import type { CandleFetchResult } from "./yahooFinance.js";

type CacheEntry<T> = {
  value: T;
  timestamp: number;
};

export class CandleCache<T> {
  private readonly cache: Map<string, CacheEntry<T>> = new Map();
  private readonly pendingFetches: Map<string, Promise<T>> = new Map(); // Track in-flight requests
  private readonly maxSize: number;
  private readonly ttlMs: number;

  /**
   * Creates a new candle cache.
   * 
   * @param maxSize - Maximum number of entries (default: 100)
   * @param ttlMs - Time-to-live in milliseconds (default: 1 hour)
   */
  public constructor(args?: Readonly<{ maxSize?: number; ttlMs?: number }>) {
    this.maxSize = args?.maxSize ?? 100;
    this.ttlMs = args?.ttlMs ?? 60 * 60 * 1000; // 1 hour default
  }

  /**
   * Builds a cache key from parameters.
   */
  public buildKey(args: Readonly<{
    source: string;
    symbol: string;
    interval: string;
    startTime: string;
    endTime: string;
  }>): string {
    return `${args.source}:${args.symbol}:${args.interval}:${args.startTime}:${args.endTime}`;
  }

  /**
   * Gets a value from the cache.
   * Returns undefined if not found or expired.
   */
  public get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    // Check if expired
    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Sets a value in the cache.
   * Evicts oldest entry if cache is full (LRU).
   */
  public set(key: string, value: T): void {
    // If cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * Gets a value, or computes it if not found.
   * 
   * Request deduplication: If multiple concurrent requests need the same data,
   * only the first one fetches from the API, and the rest wait for it.
   * This prevents rate limiting when 100+ tests start at once.
   */
  public async getOrCompute(
    key: string,
    compute: () => Promise<T>
  ): Promise<T> {
    // Check cache first
    const cached = this.get(key);
    
    if (cached !== undefined) {
      // Cache hit (logging disabled for performance)
      return cached;
    }

    // Check if there's already a pending fetch for this key
    const pending = this.pendingFetches.get(key);
    if (pending !== undefined) {
      // Waiting for in-flight fetch (logging disabled for performance)
      return await pending;
    }

    // Start new fetch and track it (logging disabled for performance)
    const fetchPromise = compute();
    this.pendingFetches.set(key, fetchPromise);

    try {
      const value = await fetchPromise;
      this.set(key, value);
      return value;
    } finally {
      // Remove from pending fetches once complete
      this.pendingFetches.delete(key);
    }
  }

  /**
   * Clears all cache entries and pending fetches.
   */
  public clear(): void {
    this.cache.clear();
    this.pendingFetches.clear();
  }

  /**
   * Gets cache statistics.
   */
  public stats(): Readonly<{
    size: number;
    maxSize: number;
    ttlMs: number;
    pendingFetches: number;
  }> {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      pendingFetches: this.pendingFetches.size
    };
  }
}

/**
 * Global candle cache instance.
 * Shared across all backtest runs.
 */
export const candleCache = new CandleCache<CandleFetchResult>({
  maxSize: 200, // Store up to 200 different symbol/interval/date combinations
  ttlMs: 2 * 60 * 60 * 1000 // 2 hours
});


