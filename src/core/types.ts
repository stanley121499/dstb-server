import { z } from "zod";

/**
 * Allowed bot lifecycle states.
 */
export const botStatusSchema = z.enum(["running", "stopped", "paused", "error", "starting"]);

/**
 * Allowed position sides.
 */
export const positionSideSchema = z.enum(["LONG", "SHORT"]);

/**
 * Allowed order statuses.
 */
export const orderStatusSchema = z.enum([
  "NEW",
  "PLACED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED"
]);

/**
 * Allowed log levels for structured logging.
 */
export const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"]);

/**
 * Allowed exchange identifiers.
 */
export const exchangeSchema = z.enum(["paper", "bitunix"]);

/**
 * Allowed market types for Bitunix.
 */
export const marketTypeSchema = z.enum(["spot", "futures"]);

/**
 * Allowed strategy config schema.
 */
export const strategyConfigSchema = z
  .object({
    name: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    params: z.record(z.unknown())
  })
  .strict();

/**
 * Shared number coercion with validation.
 */
const positiveNumberSchema = z.preprocess((value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return Number(trimmed);
    }
  }

  return value;
}, z.number().finite().positive());

/**
 * Zod schema for bot configuration files.
 */
export const botConfigSchema = z
  .object({
    name: z.string().trim().min(1),
    strategy: z.string().trim().min(1),
    exchange: exchangeSchema,
    symbol: z.string().trim().min(1),
    interval: z.string().trim().min(1),
    initialBalance: positiveNumberSchema,
    riskManagement: z
      .object({
        maxDailyLossPct: positiveNumberSchema,
        maxPositionSizePct: positiveNumberSchema
      })
      .strict(),
    params: z.record(z.unknown()),
    bitunix: z
      .object({
        apiKey: z.string().trim().min(1),
        secretKey: z.string().trim().min(1),
        testMode: z.boolean().optional().default(false),
        marketType: marketTypeSchema.optional().default("spot")
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.riskManagement.maxDailyLossPct <= 0 || config.riskManagement.maxDailyLossPct >= 50) {
      ctx.addIssue({
        code: "custom",
        path: ["riskManagement", "maxDailyLossPct"],
        message: "maxDailyLossPct must be > 0 and < 50"
      });
    }

    if (config.riskManagement.maxPositionSizePct <= 0 || config.riskManagement.maxPositionSizePct > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["riskManagement", "maxPositionSizePct"],
        message: "maxPositionSizePct must be > 0 and <= 100"
      });
    }

    if (config.exchange === "bitunix" && config.bitunix === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["bitunix"],
        message: "bitunix credentials are required when exchange is bitunix"
      });
    }
  });

export type BotStatus = z.infer<typeof botStatusSchema>;
export type PositionSide = z.infer<typeof positionSideSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type ExchangeId = z.infer<typeof exchangeSchema>;
export type MarketType = z.infer<typeof marketTypeSchema>;
export type BotConfig = z.infer<typeof botConfigSchema>;
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

/**
 * Bot row persisted in Supabase (`bots` + `configs`).
 */
export type Bot = {
  id: string;
  /** `configs.id` — control plane and config versioning. */
  configId: string;
  name: string;
  strategy: string;
  initialBalance: number;
  currentEquity: number;
  status: BotStatus;
  config: BotConfig;
  createdAt: number;
  lastHeartbeat?: number;
};

/**
 * Optional OHLCV bundles written to `trade_candles` when a position closes.
 */
export type TradeCandleBundle = Readonly<{
  timeframe: string;
  candles: ReadonlyArray<Record<string, unknown>>;
  rangeStartMs: number;
  rangeEndMs: number;
}>;

/**
 * Position row stored in SQLite.
 */
export type Position = {
  id: string;
  botId: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  entryTime: number;
};

/**
 * Trade row stored in SQLite.
 */
export type Trade = {
  id: string;
  botId: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  rMultiple?: number;
  entryTime: number;
  exitTime: number;
  exitReason?: string;
};

/**
 * Order row stored in SQLite.
 */
export type Order = {
  id: string;
  botId: string;
  clientOrderId: string;
  exchangeOrderId?: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  price?: number;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
};
