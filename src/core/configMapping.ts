import { ConfigLoader } from "./ConfigLoader.js";
import type { BotConfig } from "./types.js";

/**
 * Database row shape for `configs` (subset used by the bot server).
 */
export type ConfigRow = Readonly<{
  id: string;
  name: string;
  strategy: string;
  symbol: string;
  interval: string;
  exchange: string;
  initial_balance: number | string;
  params: Record<string, unknown>;
  risk_mgmt: Record<string, unknown>;
  credentials_ref: Record<string, unknown>;
  enabled: boolean;
  current_version: number;
}>;

/**
 * Build a validated BotConfig from a `configs` row.
 */
export function configRowToBotConfig(row: ConfigRow): BotConfig {
  const maxDailyLossPct = row.risk_mgmt["maxDailyLossPct"];
  const maxPositionSizePct = row.risk_mgmt["maxPositionSizePct"];

  const raw: Record<string, unknown> = {
    name: row.name,
    strategy: row.strategy,
    exchange: row.exchange,
    symbol: row.symbol,
    interval: row.interval,
    initialBalance:
      typeof row.initial_balance === "string" ? Number(row.initial_balance) : row.initial_balance,
    riskManagement: {
      maxDailyLossPct,
      maxPositionSizePct
    },
    params: row.params
  };

  const creds = row.credentials_ref;
  if (Object.keys(creds).length > 0) {
    raw["bitunix"] = creds;
  }

  return ConfigLoader.validateConfig(raw);
}

/**
 * Split a BotConfig into columns for `configs` insert/update.
 */
export function botConfigToColumns(config: BotConfig): Readonly<{
  name: string;
  strategy: string;
  symbol: string;
  interval: string;
  exchange: string;
  initial_balance: number;
  params: Record<string, unknown>;
  risk_mgmt: Record<string, unknown>;
  credentials_ref: Record<string, unknown>;
}> {
  const riskMgmt = config.riskManagement;
  const bitunix = config.bitunix;

  return {
    name: config.name,
    strategy: config.strategy,
    symbol: config.symbol,
    interval: config.interval,
    exchange: config.exchange,
    initial_balance: config.initialBalance,
    params: config.params as Record<string, unknown>,
    risk_mgmt: {
      maxDailyLossPct: riskMgmt.maxDailyLossPct,
      maxPositionSizePct: riskMgmt.maxPositionSizePct
    },
    credentials_ref:
      bitunix !== undefined
        ? {
            apiKey: bitunix.apiKey,
            secretKey: bitunix.secretKey,
            ...(bitunix.testMode !== undefined ? { testMode: bitunix.testMode } : {}),
            ...(bitunix.marketType !== undefined ? { marketType: bitunix.marketType } : {})
          }
        : {}
  };
}
