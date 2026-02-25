import { toBitunixSymbol } from "./bitunixSymbolMapper.js";
import type { BitunixClient } from "./BitunixClient.js";
import { extractNumber, extractOptionalNumber, extractString, extractArray, isRecord, parseBalance } from "./BitunixParsers.js";
import { ExchangeError } from "./ExchangeError.js";
import type { Balance } from "./types.js";
import type { LeverageInfo, MarginMode, PositionMode } from "./bitunixTypes.js";

/**
 * BitunixAccountApi — account management endpoints.
 * Wraps: get balance, get/change leverage, get/change margin mode,
 *        change position mode, adjust position margin.
 */
export class BitunixAccountApi {
  private readonly client: BitunixClient;

  public constructor(client: BitunixClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Balance
  // ---------------------------------------------------------------------------

  /**
   * Retrieves the account balance for the given currency.
   * GET /api/v1/futures/account
   */
  public async getSingleAccount(quoteCurrency: string): Promise<Balance> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/account",
      isPrivate: true
    });
    const { currency, available, locked, total } = parseBalance(response, quoteCurrency);
    return { currency, available, locked, total };
  }

  // ---------------------------------------------------------------------------
  // Leverage & Margin Mode
  // ---------------------------------------------------------------------------

  /**
   * Gets the current leverage and margin mode for a symbol.
   * GET /api/v1/futures/account/get_leverage_margin_mode
   */
  public async getLeverageAndMarginMode(symbol: string): Promise<LeverageInfo> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/futures/account/get_leverage_margin_mode",
      query: { symbol: toBitunixSymbol(symbol) },
      isPrivate: true
    });
    return this.parseLeverageInfo(response, symbol);
  }

  /**
   * Changes the leverage for a symbol.
   * POST /api/v1/futures/account/change_leverage
   */
  public async changeLeverage(args: Readonly<{ symbol: string; leverage: number }>): Promise<LeverageInfo> {
    if (!Number.isFinite(args.leverage) || args.leverage <= 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "Leverage must be a positive number" });
    }
    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/account/change_leverage",
      body: {
        symbol: toBitunixSymbol(args.symbol),
        leverage: args.leverage
      },
      isPrivate: true
    });
    // Re-fetch the updated state as the API may not return the full object
    if (!isRecord(response)) {
      return this.getLeverageAndMarginMode(args.symbol);
    }
    return this.parseLeverageInfo(response, args.symbol);
  }

  /**
   * Changes the margin mode for a symbol.
   * POST /api/v1/futures/account/change_margin_mode
   */
  public async changeMarginMode(args: Readonly<{ symbol: string; mode: MarginMode }>): Promise<void> {
    await this.client.request({
      method: "POST",
      path: "/api/v1/futures/account/change_margin_mode",
      body: {
        symbol: toBitunixSymbol(args.symbol),
        marginMode: args.mode === "cross" ? "CROSSED" : "ISOLATED"
      },
      isPrivate: true
    });
  }

  /**
   * Changes the position mode (one-way or hedge) for the account.
   * POST /api/v1/futures/account/change_position_mode
   */
  public async changePositionMode(mode: PositionMode): Promise<void> {
    await this.client.request({
      method: "POST",
      path: "/api/v1/futures/account/change_position_mode",
      body: { positionMode: mode === "hedge" ? "HEDGE" : "ONE_WAY" },
      isPrivate: true
    });
  }

  /**
   * Adds or removes margin for an isolated position.
   * POST /api/v1/futures/account/adjust_position_margin
   * @param amount - Positive to add margin, negative to remove.
   */
  public async adjustPositionMargin(args: Readonly<{
    symbol: string;
    amount: number;
    positionId?: string;
  }>): Promise<{ newMargin: number }> {
    if (!Number.isFinite(args.amount) || args.amount === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "Amount must be a non-zero finite number" });
    }

    const body: Record<string, unknown> = {
      symbol: toBitunixSymbol(args.symbol),
      amount: Math.abs(args.amount),
      type: args.amount > 0 ? "ADD" : "REDUCE"
    };
    if (args.positionId !== undefined) {
      body.positionId = args.positionId;
    }

    const response = await this.client.request({
      method: "POST",
      path: "/api/v1/futures/account/adjust_position_margin",
      body,
      isPrivate: true
    });

    const newMargin = isRecord(response)
      ? (extractOptionalNumber(response, ["margin", "positionMargin", "newMargin"]) ?? 0)
      : 0;

    return { newMargin };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseLeverageInfo(payload: unknown, fallbackSymbol: string): LeverageInfo {
    if (!isRecord(payload)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid leverage info payload" });
    }

    // Handle nested data arrays
    const data = Array.isArray(payload.data) ? payload.data[0] : payload;
    const src = isRecord(data) ? data : payload;

    const symbol = extractString(src, ["symbol"]) || fallbackSymbol;
    const leverage = extractNumber(src, ["longLeverage", "shortLeverage", "leverage"]);
    const marginModeRaw = extractString(src, ["marginMode", "marginType"]);
    const marginMode: MarginMode = marginModeRaw.toUpperCase() === "CROSSED" || marginModeRaw.toUpperCase() === "CROSS" ? "cross" : "isolated";
    const posModeRaw = extractString(src, ["positionMode", "posMode"]);
    const positionMode: PositionMode = posModeRaw.toUpperCase() === "HEDGE" ? "hedge" : "one_way";

    const rows = extractArray(src);
    if (rows.length > 0 && !isRecord(data)) {
      return this.parseLeverageInfo(rows[0], fallbackSymbol);
    }

    return { symbol, leverage, marginMode, positionMode };
  }
}
