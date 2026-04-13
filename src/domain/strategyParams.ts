import { z } from "zod";

const executionBlockSchema = z
  .object({
    feeBps: z.number().int().min(0),
    slippageBps: z.number().int().min(0)
  })
  .strict();

/**
 * Allowed candle intervals for ORB-ATR (config row + merged backtest payload).
 */
export const strategyIntervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);

/**
 * Allowed symbols for ORB-ATR (merged backtest payload).
 */
export const strategySymbolSchema = z.enum(["BTC-USD", "ETH-USD", "ZEC-USD"]);

/**
 * ORB-ATR `configs.params` JSON only (no symbol/interval — those live on the config row).
 * Matches fields persisted in Supabase and `src/strategies/orb-atr.ts` `orbParamsSchema`.
 */
export const orbAtrParamsBodySchema = z
  .object({
    version: z.literal("1.0"),
    intervalMinutes: z.number().int().min(1).optional(),
    session: z
      .object({
        timezone: z.literal("America/New_York"),
        startTime: z.literal("09:30"),
        openingRangeMinutes: z.number().int().min(1)
      })
      .strict(),
    entry: z
      .object({
        directionMode: z.union([
          z.literal("long_only"),
          z.literal("short_only"),
          z.literal("long_short")
        ]),
        entryMode: z.union([z.literal("stop_breakout"), z.literal("close_confirm")]),
        breakoutBufferBps: z.number().min(0),
        maxTradesPerSession: z.number().int().min(1)
      })
      .strict(),
    atr: z
      .object({
        atrLength: z.number().int().min(1),
        atrFilter: z
          .object({
            enabled: z.boolean(),
            minAtrBps: z.number().int().min(0),
            maxAtrBps: z.number().int().min(0)
          })
          .strict()
      })
      .strict()
      .superRefine((v, ctx) => {
        if (v.atrFilter.minAtrBps > v.atrFilter.maxAtrBps) {
          ctx.addIssue({
            code: "custom",
            path: ["atrFilter", "minAtrBps"],
            message: "minAtrBps must be <= maxAtrBps"
          });
        }
      }),
    risk: z
      .object({
        sizingMode: z.union([z.literal("fixed_notional"), z.literal("fixed_risk_pct")]),
        riskPctPerTrade: z.number().min(0).max(100),
        fixedNotional: z.number().min(0).optional().default(0),
        stopMode: z.union([
          z.literal("or_opposite"),
          z.literal("or_midpoint"),
          z.literal("atr_multiple")
        ]),
        atrStopMultiple: z.number().positive(),
        takeProfitMode: z.union([z.literal("disabled"), z.literal("r_multiple")]),
        tpRMultiple: z.number().positive(),
        trailingStopMode: z.union([z.literal("disabled"), z.literal("atr_trailing")]),
        atrTrailMultiple: z.number().positive(),
        timeExitMode: z.union([
          z.literal("disabled"),
          z.literal("bars_after_entry"),
          z.literal("session_end")
        ]),
        barsAfterEntry: z.number().int().min(0),
        sessionEndTime: z.string().trim().regex(/^\d{2}:\d{2}$/, {
          message: "sessionEndTime must be in HH:mm format"
        })
      })
      .strict()
      .superRefine((v, ctx) => {
        if (v.sizingMode === "fixed_risk_pct" && (v.riskPctPerTrade <= 0 || v.riskPctPerTrade > 100)) {
          ctx.addIssue({
            code: "custom",
            path: ["riskPctPerTrade"],
            message: "riskPctPerTrade must be > 0 and <= 100 when sizingMode is fixed_risk_pct"
          });
        }
        if (v.sizingMode === "fixed_notional" && v.fixedNotional <= 0) {
          ctx.addIssue({
            code: "custom",
            path: ["fixedNotional"],
            message: "fixedNotional must be > 0 when sizingMode is fixed_notional"
          });
        }
      }),
    execution: executionBlockSchema.optional()
  })
  .strict();

const symbolIntervalSchema = z.object({
  symbol: strategySymbolSchema,
  interval: strategyIntervalSchema
});

/**
 * Full ORB-ATR params after merging config.symbol / config.interval (CLI backtests, paper validation).
 * Default execution fees when omitted.
 */
export const strategyParamsSchema = orbAtrParamsBodySchema
  .merge(symbolIntervalSchema)
  .transform((row) => ({
    ...row,
    execution: row.execution ?? { feeBps: 0, slippageBps: 0 }
  }));

export type StrategyParams = z.output<typeof strategyParamsSchema>;

export type OrbAtrParamsBody = z.infer<typeof orbAtrParamsBodySchema>;
