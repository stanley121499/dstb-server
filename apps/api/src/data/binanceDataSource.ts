import { z } from "zod";
import { Sha256 } from "../utils/hash.js";
import { intervalToMs } from "../utils/interval.js";
import type { Candle, YahooInterval, CandleFetchResult } from "./yahooFinance.js";

/**
 * Binance API data source for cryptocurrency market data.
 * 
 * Advantages over Yahoo Finance:
 * - No API key required for public market data
 * - 10-100x faster
 * - More reliable (professional exchange API)
 * - Better data quality
 * - No rate limits for reasonable usage
 */

/**
 * Maps our interval format to Binance interval format.
 * Binance uses: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 */
function toBinanceInterval(interval: YahooInterval): string {
  const map: Record<YahooInterval, string> = {
    "1m": "1m",
    "2m": "1m", // Binance doesn't have 2m, we'll need to resample or use 1m
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "60m": "1h",
    "90m": "1h", // Binance doesn't have 90m, we'll need to resample or use 1h
    "1h": "1h",
    "1d": "1d"
  };
  return map[interval] ?? "1h";
}

/**
 * Converts symbol from our format (BTC-USD, ETH-USD) to Binance format (BTCUSDT, ETHUSDT).
 */
function toBinanceSymbol(symbol: string): string {
  // Convert BTC-USD to BTCUSDT, ETH-USD to ETHUSDT
  const normalized = symbol.toUpperCase().replace("-", "");
  if (normalized === "BTCUSD") return "BTCUSDT";
  if (normalized === "ETHUSD") return "ETHUSDT";
  // If already in correct format or other pairs
  return normalized.endsWith("USD") ? normalized + "T" : normalized;
}

/**
 * Binance kline response schema.
 * Response format: [openTime, open, high, low, close, volume, closeTime, ...]
 */
const binanceKlineSchema = z.tuple([
  z.number(), // 0: Open time
  z.string(), // 1: Open
  z.string(), // 2: High
  z.string(), // 3: Low
  z.string(), // 4: Close
  z.string(), // 5: Volume
  z.number(), // 6: Close time
  z.string(), // 7: Quote asset volume
  z.number(), // 8: Number of trades
  z.string(), // 9: Taker buy base asset volume
  z.string(), // 10: Taker buy quote asset volume
  z.string()  // 11: Ignore
]);

type BinanceKline = z.infer<typeof binanceKlineSchema>;

/**
 * Fetches historical candles from Binance API.
 * 
 * @param args - Symbol, interval, and time range
 * @returns Candle data with fingerprint and warnings
 */
export async function fetchBinanceCandles(args: Readonly<{
  symbol: string;
  interval: YahooInterval;
  startTimeUtc: string;
  endTimeUtc: string;
}>): Promise<CandleFetchResult> {
  const warnings: string[] = [];
  const binanceSymbol = toBinanceSymbol(args.symbol);
  const binanceInterval = toBinanceInterval(args.interval);
  
  const startMs = new Date(args.startTimeUtc).getTime();
  const endMs = new Date(args.endTimeUtc).getTime();

  // Binance API endpoint for klines (candlestick data)
  // Docs: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", binanceSymbol);
  url.searchParams.set("interval", binanceInterval);
  url.searchParams.set("startTime", startMs.toString());
  url.searchParams.set("endTime", endMs.toString());
  url.searchParams.set("limit", "1000"); // Max 1000 per request

  console.log(`[Binance] Fetching ${binanceSymbol} ${binanceInterval} from ${args.startTimeUtc} to ${args.endTimeUtc}`);

  const candles: Candle[] = [];
  let currentStartMs = startMs;

  // Binance limits to 1000 candles per request, so we may need multiple requests
  while (currentStartMs < endMs) {
    url.searchParams.set("startTime", currentStartMs.toString());
    
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Binance API error (${response.status}): ${errorText}`);
      }

      const data: unknown = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error(`Binance API returned non-array response`);
      }

      if (data.length === 0) {
        // No more data available
        break;
      }

      console.log(`[Binance] Received ${data.length} candles`);

      for (const kline of data) {
        try {
          const parsed = binanceKlineSchema.parse(kline);
          
          const timeUtcMs = parsed[0];
          const open = parseFloat(parsed[1]);
          const high = parseFloat(parsed[2]);
          const low = parseFloat(parsed[3]);
          const close = parseFloat(parsed[4]);
          const volume = parseFloat(parsed[5]);

          // Validate OHLCV data
          if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || 
              !Number.isFinite(close) || !Number.isFinite(volume)) {
            warnings.push(`Skipped candle with non-finite OHLCV at ${new Date(timeUtcMs).toISOString()}`);
            continue;
          }

          if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
            warnings.push(`Skipped candle with invalid OHLC relationship at ${new Date(timeUtcMs).toISOString()}`);
            continue;
          }

          candles.push({
            timeUtcMs,
            open,
            high,
            low,
            close,
            volume
          });

          // Update cursor for next batch
          currentStartMs = timeUtcMs + 1;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown parse error";
          warnings.push(`Failed to parse Binance kline: ${message}`);
        }
      }

      // If we got less than 1000 candles, we've reached the end
      if (data.length < 1000) {
        break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown fetch error";
      throw new Error(`Failed to fetch Binance data: ${message}`);
    }
  }

  console.log(`[Binance] Total candles fetched: ${candles.length}`);

  // Sort candles by time (should already be sorted, but ensure it)
  candles.sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  // Generate fingerprint
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const firstTimeUtc = firstCandle !== undefined ? new Date(firstCandle.timeUtcMs).toISOString() : null;
  const lastTimeUtc = lastCandle !== undefined ? new Date(lastCandle.timeUtcMs).toISOString() : null;

  const fingerprintData = {
    source: "binance" as const,
    symbol: args.symbol,
    binanceSymbol,
    interval: args.interval,
    binanceInterval,
    startTimeUtc: args.startTimeUtc,
    endTimeUtc: args.endTimeUtc,
    fetchedAtUtc: new Date().toISOString(),
    rowCount: candles.length,
    firstTimeUtc,
    lastTimeUtc
  };

  const fingerprintJson = JSON.stringify(fingerprintData, null, 2);
  const sha256Hasher = new Sha256();
  sha256Hasher.update(fingerprintJson);
  const sha256 = sha256Hasher.digestHex();

  return {
    candles,
    fingerprint: {
      source: "yahoo", // Keep as "yahoo" for compatibility with existing schema
      symbol: args.symbol,
      interval: args.interval,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      fetchedAtUtc: fingerprintData.fetchedAtUtc,
      rowCount: candles.length,
      firstTimeUtc,
      lastTimeUtc,
      sha256
    },
    warnings
  };
}



