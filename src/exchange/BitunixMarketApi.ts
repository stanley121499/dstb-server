import { toBitunixSymbol } from "./bitunixSymbolMapper.js";
import type { BitunixClient } from "./BitunixClient.js";
import { extractNumber, extractString, extractOptionalNumber, extractArray, isRecord } from "./BitunixParsers.js";
import { parseCandles } from "./BitunixParsers.js";
import { ExchangeError } from "./ExchangeError.js";
import type { ExchangeCandle } from "./types.js";
import type { OrderBook, FundingRate, TradingPair } from "./bitunixTypes.js";
import type { YahooInterval } from "../data/yahooFinance.js";

/**
 * BitunixMarketApi — public and private market data endpoints.
 * Wraps: kline, ticker, depth, funding rate, funding rate batch, trading pairs.
 */
export class BitunixMarketApi {
  private readonly client: BitunixClient;

  public constructor(client: BitunixClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Kline / Candles
  // ---------------------------------------------------------------------------

  /**
   * Fetches OHLCV klines for a symbol and interval.
   * GET /api/v1/futures/market/kline
   */
  public async getKline(args: Readonly<{
    symbol: string;
    interval: YahooInterval;
    limit?: number;
  }>): Promise<readonly ExchangeCandle[]> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/market/kline",
      query: {
        symbol: toBitunixSymbol(args.symbol),
        granularity: this.mapInterval(args.interval),
        limit: args.limit ?? 200
      }
    });
    return parseCandles(response);
  }

  // ---------------------------------------------------------------------------
  // Tickers
  // ---------------------------------------------------------------------------

  /**
   * Fetches the latest ticker for a symbol (price, volume, change).
   * GET /api/v1/futures/market/tickers
   */
  public async getTicker(symbol: string): Promise<{ price: number; volume24h: number; changePercent: number }> {
    const bitunixSymbol = toBitunixSymbol(symbol);
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/market/tickers",
      query: { symbol: bitunixSymbol }
    });

    const rows = extractArray(response);
    // Find the ticker row that matches our symbol
    const row = rows.find((r) => isRecord(r) && (r.symbol === bitunixSymbol || r.pair === bitunixSymbol)) ?? rows[0];

    if (!isRecord(row)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "No ticker data returned from Bitunix" });
    }

    const price = extractNumber(row, ["lastPrice", "last", "price", "close"]);
    const volume24h = extractOptionalNumber(row, ["vol24h", "volume24h", "baseVolume", "volume"]) ?? 0;
    const changePercent = extractOptionalNumber(row, ["changePercent24h", "priceChangePercent", "change"]) ?? 0;
    return { price, volume24h, changePercent };
  }

  // ---------------------------------------------------------------------------
  // Depth / Order Book
  // ---------------------------------------------------------------------------

  /**
   * Fetches the order book (bids/asks) for a symbol.
   * GET /api/v1/futures/market/depth
   */
  public async getDepth(args: Readonly<{ symbol: string; limit?: number }>): Promise<OrderBook> {
    const limit = args.limit ?? 20;
    const validLimits = [5, 10, 20, 50, 100] as const;
    if (!validLimits.includes(limit as (typeof validLimits)[number])) {
      throw new ExchangeError({
        code: "INVALID_PARAMETER",
        message: `Depth limit must be one of: ${validLimits.join(", ")}`
      });
    }

    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/market/depth",
      query: { symbol: toBitunixSymbol(args.symbol), limit }
    });

    return this.parseDepth(response);
  }

  private parseDepth(payload: unknown): OrderBook {
    if (!isRecord(payload)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid depth payload" });
    }

    const rawAsks = Array.isArray(payload.asks) ? payload.asks : [];
    const rawBids = Array.isArray(payload.bids) ? payload.bids : [];

    const parseEntry = (entry: unknown): readonly [number, number] => {
      if (Array.isArray(entry) && entry.length >= 2) {
        return [Number(entry[0]), Number(entry[1])];
      }
      if (isRecord(entry)) {
        const price = extractNumber(entry, ["price", "p"]);
        const qty = extractNumber(entry, ["qty", "quantity", "q", "size"]);
        return [price, qty];
      }
      return [0, 0];
    };

    return {
      asks: rawAsks.map((e) => parseEntry(e)),
      bids: rawBids.map((e) => parseEntry(e)),
      timestampUtc: new Date().toISOString()
    };
  }

  // ---------------------------------------------------------------------------
  // Funding Rate
  // ---------------------------------------------------------------------------

  /**
   * Gets the current funding rate for a single symbol.
   * GET /api/v1/futures/market/funding_rate
   */
  public async getFundingRate(symbol: string): Promise<FundingRate> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/market/funding_rate",
      query: { symbol: toBitunixSymbol(symbol) }
    });
    return this.parseFundingRate(response, symbol);
  }

  /**
   * Gets current funding rates for multiple symbols in one call.
   * GET /api/v1/futures/market/funding_rate/batch
   */
  public async getFundingRateBatch(symbols: readonly string[]): Promise<readonly FundingRate[]> {
    if (symbols.length === 0) return [];
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/market/funding_rate/batch",
      query: { symbols: symbols.map((s) => toBitunixSymbol(s)).join(",") }
    });
    const rows = extractArray(response);
    return rows.map((row, i) => this.parseFundingRate(row, symbols[i] ?? "UNKNOWN"));
  }

  private parseFundingRate(payload: unknown, fallbackSymbol: string): FundingRate {
    if (!isRecord(payload)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid funding rate payload" });
    }
    const symbol = extractString(payload, ["symbol"]);
    const fundingRate = extractNumber(payload, ["fundingRate", "rate"]);
    const nextFundingTimeMs = extractOptionalNumber(payload, ["nextFundingTime", "nextFundingTimeMs"]) ?? Date.now();
    const markPrice = extractOptionalNumber(payload, ["markPrice", "indexPrice"]) ?? 0;

    return {
      symbol: symbol || fallbackSymbol,
      fundingRate,
      nextFundingTimeUtc: new Date(nextFundingTimeMs).toISOString(),
      markPrice
    };
  }

  // ---------------------------------------------------------------------------
  // Trading Pairs
  // ---------------------------------------------------------------------------

  /**
   * Gets all available futures trading pairs and their specification.
   * GET /api/v1/futures/market/trading_pairs
   */
  public async getTradingPairs(): Promise<readonly TradingPair[]> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/market/trading_pairs"
    });
    const rows = extractArray(response);
    return rows.map((row) => this.parseTradingPair(row));
  }

  private parseTradingPair(payload: unknown): TradingPair {
    if (!isRecord(payload)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid trading pair payload" });
    }
    const symbol = extractString(payload, ["symbol", "instrumentId"]);
    const baseCurrency = extractString(payload, ["baseCurrency", "baseAsset", "base"]);
    const quoteCurrency = extractString(payload, ["quoteCurrency", "quoteAsset", "quote"]);
    const pricePrecision = extractOptionalNumber(payload, ["pricePrecision", "priceDecimal"]) ?? 2;
    const quantityPrecision = extractOptionalNumber(payload, ["quantityPrecision", "qtyDecimal", "sizeDecimal"]) ?? 4;
    const minOrderQty = extractOptionalNumber(payload, ["minSize", "minOrderQty", "minQty"]) ?? 0;
    const maxOrderQty = extractOptionalNumber(payload, ["maxSize", "maxOrderQty", "maxQty"]) ?? Number.MAX_SAFE_INTEGER;
    const maxLeverage = extractOptionalNumber(payload, ["maxLeverage"]) ?? 100;
    const statusRaw = extractString(payload, ["status", "state"]);
    const isActive = statusRaw.toUpperCase() === "TRADING" || statusRaw.toUpperCase() === "ACTIVE" || statusRaw === "1";

    return { symbol, baseCurrency, quoteCurrency, pricePrecision, quantityPrecision, minOrderQty, maxOrderQty, maxLeverage, isActive };
  }

  // ---------------------------------------------------------------------------
  // Interval mapping
  // ---------------------------------------------------------------------------

  private mapInterval(interval: YahooInterval): string {
    const map: Readonly<Record<string, string>> = {
      "1m": "1",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "1h": "60",
      "4h": "240",
      "1d": "1440"
    };
    return map[interval] ?? "60";
  }
}
