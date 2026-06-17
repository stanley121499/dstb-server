import { z } from "zod";
import { Sha256 } from "../utils/hash.js";
import type { Candle, YahooInterval, CandleFetchResult } from "./yahooFinance.js";

/**
 * Bybit V5 public market data source.
 *
 * Advantages over Binance for CI/CD runners:
 * - No geo-restrictions (accessible from GitHub Actions US-based runners)
 * - No API key required for public market data
 * - Full historical data (years of history, not limited like Yahoo Finance 15m)
 * - Native 4h interval support (no resampling needed)
 * - Max 200 candles per request; handles pagination internally
 */

/** Maps our interval format to Bybit V5 interval strings. */
function toBybitInterval(interval: YahooInterval): string {
  const map: Record<YahooInterval, string> = {
    "1m":  "1",
    "2m":  "3",   // Bybit has no 2m; nearest is 3m
    "5m":  "5",
    "15m": "15",
    "30m": "30",
    "60m": "60",
    "90m": "60",  // Bybit has no 90m; nearest is 60m
    "1h":  "60",
    "4h":  "240",
    "1d":  "D",
  };
  return map[interval] ?? "60";
}

/** Converts our symbol format (BTC-USD, ETH-USD) to Bybit spot format (BTCUSDT, ETHUSDT). */
function toBybitSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().replace("-", "");
  if (normalized === "BTCUSD") return "BTCUSDT";
  if (normalized === "ETHUSD") return "ETHUSDT";
  return normalized.endsWith("USD") ? `${normalized}T` : normalized;
}

/**
 * Bybit V5 kline response schema.
 * list items: [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
 * Data is returned newest-first; we reverse after collecting.
 */
const bybitKlineItemSchema = z.tuple([
  z.string(), // 0: startTime (ms as string)
  z.string(), // 1: open
  z.string(), // 2: high
  z.string(), // 3: low
  z.string(), // 4: close
  z.string(), // 5: volume
  z.string(), // 6: turnover
]);

const bybitResponseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({
    list: z.array(bybitKlineItemSchema),
  }),
});

/**
 * Fetches historical candles from the Bybit V5 public API.
 * Uses the spot category so price levels align with standard BTC/USD references.
 * Paginates automatically when the range exceeds Bybit's 200-candle-per-request limit.
 */
export async function fetchBybitCandles(args: Readonly<{
  symbol: string;
  interval: YahooInterval;
  startTimeUtc: string;
  endTimeUtc: string;
}>): Promise<CandleFetchResult> {
  const warnings: string[] = [];
  const bybitSymbol = toBybitSymbol(args.symbol);
  const bybitInterval = toBybitInterval(args.interval);

  const startMs = new Date(args.startTimeUtc).getTime();
  const endMs = new Date(args.endTimeUtc).getTime();

  const allCandles: Candle[] = [];
  let cursorEnd = endMs;
  const maxPerPage = 200;

  // Bybit paginates by moving the `end` cursor backward through the range.
  while (cursorEnd > startMs) {
    const url = new URL("https://api.bybit.com/v5/market/kline");
    url.searchParams.set("category", "spot");
    url.searchParams.set("symbol", bybitSymbol);
    url.searchParams.set("interval", bybitInterval);
    url.searchParams.set("start", startMs.toString());
    url.searchParams.set("end", cursorEnd.toString());
    url.searchParams.set("limit", maxPerPage.toString());

    let data: z.infer<typeof bybitResponseSchema>;
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bybit API HTTP error (${response.status}): ${errorText}`);
      }

      const raw: unknown = await response.json();
      data = bybitResponseSchema.parse(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch Bybit data: ${msg}`);
    }

    if (data.retCode !== 0) {
      throw new Error(`Bybit API error (retCode=${data.retCode}): ${data.retMsg}`);
    }

    const items = data.result.list;
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const timeUtcMs = Number(item[0]);
      const open  = parseFloat(item[1]);
      const high  = parseFloat(item[2]);
      const low   = parseFloat(item[3]);
      const close = parseFloat(item[4]);
      const volume = parseFloat(item[5]);

      if (
        !Number.isFinite(timeUtcMs) ||
        !Number.isFinite(open) || !Number.isFinite(high) ||
        !Number.isFinite(low)  || !Number.isFinite(close)
      ) {
        warnings.push(`Skipped non-finite candle at index timeUtcMs=${timeUtcMs}`);
        continue;
      }

      if (timeUtcMs < startMs || timeUtcMs > endMs) {
        continue;
      }

      allCandles.push({ timeUtcMs, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
    }

    // Items are newest-first; oldest item in this page tells us the next cursor.
    const oldestInPage = items[items.length - 1];
    const oldestMs = oldestInPage !== undefined ? Number(oldestInPage[0]) : startMs;

    if (items.length < maxPerPage || oldestMs <= startMs) {
      break;
    }

    // Move cursor back by 1ms so we don't re-fetch the oldest candle of this page.
    cursorEnd = oldestMs - 1;
  }

  // Sort ascending (Bybit returns newest-first within each page).
  allCandles.sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  // Deduplicate by timestamp (keep last).
  const deduped: Candle[] = [];
  for (const c of allCandles) {
    const prev = deduped[deduped.length - 1];
    if (prev !== undefined && prev.timeUtcMs === c.timeUtcMs) {
      deduped[deduped.length - 1] = c;
    } else {
      deduped.push(c);
    }
  }

  if (deduped.length === 0) {
    throw new Error(
      `Bybit returned 0 valid candles. symbol=${args.symbol} interval=${args.interval} ` +
      `startTimeUtc=${args.startTimeUtc} endTimeUtc=${args.endTimeUtc}`
    );
  }

  const hasher = new Sha256();
  for (const c of deduped) {
    hasher.update(`${c.timeUtcMs}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume}\n`);
  }

  const first = deduped[0];
  const last  = deduped[deduped.length - 1];

  return {
    candles: deduped,
    fingerprint: {
      source: "yahoo",  // kept as "yahoo" for schema compatibility
      symbol: args.symbol,
      interval: args.interval,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      fetchedAtUtc: new Date().toISOString(),
      rowCount: deduped.length,
      firstTimeUtc: first !== undefined ? new Date(first.timeUtcMs).toISOString() : null,
      lastTimeUtc:  last  !== undefined ? new Date(last.timeUtcMs).toISOString()  : null,
      sha256: hasher.digestHex(),
    },
    warnings,
  };
}
