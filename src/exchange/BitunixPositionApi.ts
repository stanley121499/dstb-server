import { toBitunixSymbol, fromBitunixSymbol } from "./bitunixSymbolMapper.js";
import type { BitunixClient } from "./BitunixClient.js";
import { extractNumber, extractString, extractOptionalNumber, extractArray, isRecord, parsePositionRow, parseHistoryPosition } from "./BitunixParsers.js";
import { ExchangeError } from "./ExchangeError.js";
import type { Position } from "./types.js";
import type { HistoryPosition, PositionTier, PaginationArgs } from "./bitunixTypes.js";

/**
 * BitunixPositionApi — futures position endpoints.
 * Wraps: get pending positions, get history positions, get position tiers.
 */
export class BitunixPositionApi {
  private readonly client: BitunixClient;

  public constructor(client: BitunixClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Pending positions
  // ---------------------------------------------------------------------------

  /**
   * Gets all open (pending) positions for a symbol.
   * GET /api/v1/futures/position/get_pending_positions
   * Returns null when no position is found.
   */
  public async getPendingPosition(symbol: string): Promise<Position | null> {
    const bitunixSymbol = toBitunixSymbol(symbol);
    try {
      const response = await this.client.request({
        method: "GET",
        path: "/api/v1/futures/position/get_pending_positions",
        query: { symbol: bitunixSymbol },
        isPrivate: true
      });

      const rows = extractArray(response);
      if (rows.length === 0) return null;

      // Fetch current price for PnL calculation
      const currentPrice = await this.fetchLastPrice(bitunixSymbol);
      const position = parsePositionRow(rows[0], currentPrice, symbol);
      return position;
    } catch (err: unknown) {
      if (err instanceof ExchangeError) {
        const safeIgnore = new Set(["ORDER_NOT_FOUND", "NO_POSITION"]);
        if (safeIgnore.has(err.code)) return null;
        throw err;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // History positions
  // ---------------------------------------------------------------------------

  /**
   * Gets closed (historical) positions for a symbol with optional pagination.
   * GET /api/v1/futures/position/get_history_positions
   */
  public async getHistoryPositions(args: Readonly<{
    symbol?: string;
  } & PaginationArgs>): Promise<readonly HistoryPosition[]> {
    const query: Record<string, string | number | undefined> = {
      pageNum: args.pageNum ?? 1,
      pageSize: args.pageSize ?? 50
    };
    if (args.symbol !== undefined) {
      query.symbol = toBitunixSymbol(args.symbol);
    }
    if (args.startTimeMs !== undefined) query.startTime = args.startTimeMs;
    if (args.endTimeMs !== undefined) query.endTime = args.endTimeMs;

    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/position/get_history_positions",
      query,
      isPrivate: true
    });

    const rows = extractArray(response);
    return rows.map((row) => parseHistoryPosition(row));
  }

  // ---------------------------------------------------------------------------
  // Position tiers
  // ---------------------------------------------------------------------------

  /**
   * Gets position tiers / leverage brackets for a symbol.
   * GET /api/v1/futures/position/get_position_tiers
   */
  public async getPositionTiers(symbol: string): Promise<readonly PositionTier[]> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/position/get_position_tiers",
      query: { symbol: toBitunixSymbol(symbol) }
    });
    const rows = extractArray(response);
    return rows.map((row) => this.parsePositionTier(row, symbol));
  }

  private parsePositionTier(payload: unknown, fallbackSymbol: string): PositionTier {
    if (!isRecord(payload)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid position tier payload" });
    }
    const tier = extractOptionalNumber(payload, ["tier", "level", "bracketNum"]) ?? 1;
    const symbol = extractString(payload, ["symbol"]) || fallbackSymbol;
    const minNotional = extractOptionalNumber(payload, ["minNotional", "minPositionValue", "minLeverage"]) ?? 0;
    const maxNotional = extractOptionalNumber(payload, ["maxNotional", "maxPositionValue", "notionalCap"]) ?? 0;
    const maxLeverage = extractOptionalNumber(payload, ["maxLeverage", "leverage"]) ?? 1;
    const maintenanceMarginRate = extractOptionalNumber(payload, ["maintenanceMarginRate", "mmr", "maintMarginRatio"]) ?? 0;

    return { tier, symbol: fromBitunixSymbol(symbol), minNotional, maxNotional, maxLeverage, maintenanceMarginRate };
  }

  // ---------------------------------------------------------------------------
  // Helper — last price for PnL
  // ---------------------------------------------------------------------------

  private async fetchLastPrice(bitunixSymbol: string): Promise<number> {
    try {
      const response = await this.client.request({
        method: "GET",
        path: "/api/v1/futures/market/tickers",
        query: { symbol: bitunixSymbol }
      });
      const rows = extractArray(response);
      const row = rows[0];
      if (!isRecord(row)) return 0;
      return extractNumber(row, ["lastPrice", "last", "price", "close"]);
    } catch {
      return 0;
    }
  }
}
