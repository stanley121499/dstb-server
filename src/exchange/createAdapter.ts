import type { YahooInterval } from "../data/yahooFinance.js";
import { ExchangeError } from "./ExchangeError.js";
import type { IExchangeAdapter } from "./IExchangeAdapter.js";
import { BitunixAdapter } from "./BitunixAdapter.js";
import { PaperTradingAdapter } from "./PaperTradingAdapter.js";
import type { ExchangeType } from "./types.js";

/**
 * Configuration for the paper trading adapter.
 */
export type PaperAdapterConfig = Readonly<{
  type: "paper";
  symbol: string;
  interval: YahooInterval;
  initialBalance: number;
  feesBps: number;
  slippageBps: number;
  currency?: string;
}>;

/**
 * Configuration for the Bitunix adapter (placeholder).
 */
export type BitunixAdapterConfig = Readonly<{
  type: "bitunix";
  symbol: string;
  interval: YahooInterval;
  apiKey?: string;
  apiSecret?: string;
  testMode?: boolean;
  marketType?: "spot" | "futures";
}>;

/**
 * Union of all exchange adapter configs.
 */
export type ExchangeAdapterConfig = PaperAdapterConfig | BitunixAdapterConfig;

/**
 * Creates an exchange adapter based on configuration.
 */
export function createExchangeAdapter(config: ExchangeAdapterConfig): IExchangeAdapter {
  // Step 1: Validate the config type.
  if (!isExchangeType(config.type)) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "Invalid exchange adapter type"
    });
  }

  // Step 2: Route to adapter implementations.
  if (config.type === "paper") {
    validatePaperConfig(config);
    const paperConfig: {
      symbol: string;
      interval: YahooInterval;
      initialBalance: number;
      feesBps: number;
      slippageBps: number;
      currency?: string;
    } = {
      symbol: config.symbol,
      interval: config.interval,
      initialBalance: config.initialBalance,
      feesBps: config.feesBps,
      slippageBps: config.slippageBps
    };
    if (config.currency !== undefined) {
      paperConfig.currency = config.currency;
    }
    return new PaperTradingAdapter(paperConfig);
  }

  // Step 3: Validate Bitunix config and return implementation.
  validateBitunixConfig(config);

  const apiKey = resolveBitunixCredential(config.apiKey, "BITUNIX_API_KEY");
  const apiSecret = resolveBitunixCredential(config.apiSecret, "BITUNIX_SECRET_KEY");

  return new BitunixAdapter({
    symbol: config.symbol,
    interval: config.interval,
    apiKey,
    secretKey: apiSecret,
    marketType: config.marketType ?? "spot"
  });
}

/**
 * Validates exchange type values.
 */
function isExchangeType(value: string): value is ExchangeType {
  return value === "paper" || value === "bitunix";
}

/**
 * Validates paper adapter configuration.
 */
function validatePaperConfig(config: PaperAdapterConfig): void {
  // Step 1: Validate required string fields.
  assertNonEmptyString(config.symbol, "symbol");

  // Step 2: Validate required numeric fields.
  assertPositiveNumber(config.initialBalance, "initialBalance");
  assertNonNegativeNumber(config.feesBps, "feesBps");
  assertNonNegativeNumber(config.slippageBps, "slippageBps");
}

/**
 * Validates Bitunix adapter configuration.
 */
function validateBitunixConfig(config: BitunixAdapterConfig): void {
  // Step 1: Validate required string fields.
  assertNonEmptyString(config.symbol, "symbol");
  if (config.marketType !== undefined && config.marketType !== "spot" && config.marketType !== "futures") {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: "marketType must be spot or futures"
    });
  }
}

/**
 * Validates a non-empty string.
 */
function assertNonEmptyString(value: string, fieldName: string): void {
  // Step 1: Validate input type.
  if (typeof value !== "string") {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `${fieldName} must be a string`
    });
  }

  // Step 2: Validate input value.
  if (value.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `${fieldName} must be non-empty`
    });
  }
}

/**
 * Resolves Bitunix credentials from config or environment.
 */
function resolveBitunixCredential(value: string | undefined, envKey: string): string {
  // Step 1: Check if value is a template string like "${ENV_VAR}"
  if (typeof value === "string" && value.startsWith("${") && value.endsWith("}")) {
    // Extract the environment variable name from the template
    const templateEnvKey = value.slice(2, -1);
    const envValue = process.env[templateEnvKey];
    if (typeof envValue === "string" && envValue.trim().length > 0) {
      return envValue;
    }
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `Missing Bitunix credential for ${templateEnvKey} (referenced in config)`
    });
  }

  // Step 2: Use the value directly if it's a non-empty string
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  // Step 3: Fall back to the default environment variable
  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    return envValue;
  }
  throw new ExchangeError({
    code: "INVALID_ORDER",
    message: `Missing Bitunix credential for ${envKey}`
  });
}

/**
 * Validates a positive number.
 */
function assertPositiveNumber(value: number, fieldName: string): void {
  // Step 1: Validate numeric type.
  if (!Number.isFinite(value)) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `${fieldName} must be a finite number`
    });
  }

  // Step 2: Validate numeric value.
  if (value <= 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `${fieldName} must be > 0`
    });
  }
}

/**
 * Validates a non-negative number.
 */
function assertNonNegativeNumber(value: number, fieldName: string): void {
  // Step 1: Validate numeric type.
  if (!Number.isFinite(value)) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `${fieldName} must be a finite number`
    });
  }

  // Step 2: Validate numeric value.
  if (value < 0) {
    throw new ExchangeError({
      code: "INVALID_ORDER",
      message: `${fieldName} must be >= 0`
    });
  }
}
