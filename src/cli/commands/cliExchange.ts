import { z } from "zod";

import type { BotConfig } from "../../core/types";
import { createExchangeAdapter } from "../../exchange/createAdapter.js";
import type { BitunixAdapterConfig, ExchangeAdapterConfig } from "../../exchange/createAdapter.js";
import type { YahooInterval } from "../../data/yahooFinance.js";
import type { IExchangeAdapter } from "../../exchange/IExchangeAdapter.js";

const intervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);

const executionSchema = z
  .object({
    feeBps: z.number().int().min(0),
    slippageBps: z.number().int().min(0)
  })
  .strict();

/**
 * Parse a CLI interval into a Yahoo-compatible interval.
 */
export function parseYahooInterval(interval: string): YahooInterval {
  // Step 1: Validate interval against supported values.
  return intervalSchema.parse(interval) as YahooInterval;
}

/**
 * Resolve execution parameters from the strategy config.
 */
export function resolveExecutionConfig(
  params: Record<string, unknown>
): Readonly<{ feeBps: number; slippageBps: number }> {
  // Step 1: Parse execution settings when provided.
  const execution = params["execution"];
  const parsed = executionSchema.safeParse(execution);
  if (parsed.success) {
    return parsed.data;
  }
  // Step 2: Fall back to zero fees/slippage defaults.
  return {
    feeBps: 0,
    slippageBps: 0
  };
}

/**
 * Build the exchange adapter for a given bot config.
 */
export function buildExchangeAdapter(config: BotConfig): IExchangeAdapter {
  const interval = parseYahooInterval(config.interval);
  const execution = resolveExecutionConfig(config.params);

  if (config.exchange === "paper") {
    const adapterConfig: ExchangeAdapterConfig = {
      type: "paper",
      symbol: config.symbol,
      interval,
      initialBalance: config.initialBalance,
      feesBps: execution.feeBps,
      slippageBps: execution.slippageBps,
      currency: "USD"
    };
    return createExchangeAdapter(adapterConfig);
  }

  const bx = config.bitunix;
  const bitunixCfg: BitunixAdapterConfig = {
    type: "bitunix",
    symbol: config.symbol,
    interval,
    ...(bx?.apiKey !== undefined ? { apiKey: bx.apiKey } : {}),
    ...(bx?.secretKey !== undefined ? { apiSecret: bx.secretKey } : {}),
    ...(bx?.testMode !== undefined ? { testMode: bx.testMode } : {}),
    ...(bx?.marketType !== undefined ? { marketType: bx.marketType } : {})
  };

  return createExchangeAdapter(bitunixCfg);
}
