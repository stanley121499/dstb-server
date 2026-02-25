import type { BitunixClient } from "./BitunixClient.js";
import { extractArray, extractOptionalNumber, extractOptionalString, isRecord } from "./BitunixParsers.js";
import { ExchangeError } from "./ExchangeError.js";
import type { TransferResult, AssetBalance } from "./bitunixTypes.js";

/**
 * BitunixAssetApi — sub-account asset management endpoints.
 * Wraps: query assets, transfer to sub-account, transfer to main account.
 */
export class BitunixAssetApi {
  private readonly client: BitunixClient;

  public constructor(client: BitunixClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Asset query
  // ---------------------------------------------------------------------------

  /**
   * Queries the asset balances for the sub-account or current account.
   * GET /api/v1/cp/asset/query
   */
  public async queryAssets(): Promise<readonly AssetBalance[]> {
    const response = await this.client.request({
      method: "GET",
      path: "/api/v1/cp/asset/query",
      isPrivate: true
    });
    const rows = extractArray(response);
    return rows.map((row) => this.parseAssetBalance(row));
  }

  // ---------------------------------------------------------------------------
  // Transfers
  // ---------------------------------------------------------------------------

  /**
   * Transfers assets from the main account to a sub-account.
   * POST /api/v1/cp/asset/transfer-to-sub-account
   */
  public async transferToSubAccount(args: Readonly<{
    amount: string | number;
    coin: string;
    assetType: "FUTURES" | "SPOT";
    subAccountId?: string;
  }>): Promise<TransferResult> {
    const numericAmount = Number(args.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "amount must be a positive number" });
    }
    if (!args.coin || args.coin.trim().length === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "coin must be a non-empty string" });
    }

    const body: Record<string, unknown> = {
      amount: String(args.amount),
      coin: args.coin.toUpperCase(),
      assetType: args.assetType
    };
    if (args.subAccountId !== undefined) body.subAccountId = args.subAccountId;

    await this.client.request({
      method: "POST",
      path: "/api/v1/cp/asset/transfer-to-sub-account",
      body,
      isPrivate: true
    });

    return { success: true };
  }

  /**
   * Transfers assets from a sub-account back to the main account.
   * POST /api/v1/cp/asset/transfer-to-main-account
   */
  public async transferToMainAccount(args: Readonly<{
    amount: string | number;
    coin: string;
    assetType: "FUTURES" | "SPOT";
    subAccountId?: string;
  }>): Promise<TransferResult> {
    const numericAmount = Number(args.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "amount must be a positive number" });
    }
    if (!args.coin || args.coin.trim().length === 0) {
      throw new ExchangeError({ code: "INVALID_PARAMETER", message: "coin must be a non-empty string" });
    }

    const body: Record<string, unknown> = {
      amount: String(args.amount),
      coin: args.coin.toUpperCase(),
      assetType: args.assetType
    };
    if (args.subAccountId !== undefined) body.subAccountId = args.subAccountId;

    await this.client.request({
      method: "POST",
      path: "/api/v1/cp/asset/transfer-to-main-account",
      body,
      isPrivate: true
    });

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseAssetBalance(payload: unknown): AssetBalance {
    if (!isRecord(payload)) {
      throw new ExchangeError({ code: "INTERNAL_ERROR", message: "Invalid asset balance payload" });
    }
    const coin = extractOptionalString(payload, ["coin", "currency", "asset"]) ?? "UNKNOWN";
    const available = extractOptionalNumber(payload, ["available", "free", "availableBalance"]) ?? 0;
    const locked = extractOptionalNumber(payload, ["locked", "frozen"]) ?? 0;
    const total = extractOptionalNumber(payload, ["total", "balance"]) ?? available + locked;
    return { coin, available, locked, total };
  }
}
