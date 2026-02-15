import { z } from "zod";

import { strategyParamsSchema } from "../domain/strategyParams.js";

const intervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);

const bitunixConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1),
    secretKey: z.string().trim().min(1),
    testMode: z.boolean().optional().default(false),
    marketType: z.enum(["spot", "futures"]).optional().default("spot")
  })
  .strict();

/**
 * Zod schema for bot configuration files.
 *
 * Inputs:
 * - Bot config object.
 *
 * Outputs:
 * - Validated config with defaults applied.
 *
 * Edge cases:
 * - Enforces config.symbol/config.interval to match params payload.
 *
 * Error behavior:
 * - Zod validation errors on invalid config.
 */
export const botConfigSchema = z
  .object({
    name: z.string().trim().min(1),
    exchange: z.union([z.literal("paper"), z.literal("bitunix")]),
    symbol: z.string().trim().min(1),
    interval: intervalSchema,
    initialBalance: z
      .union([z.number(), z.string().trim().transform(Number)])
      .refine((v) => Number.isFinite(v) && v > 0, { message: "initialBalance must be a finite number > 0" }),
    riskManagement: z
      .object({
        maxDailyLossPct: z
          .union([z.number(), z.string().trim().transform(Number)])
          .refine((v) => Number.isFinite(v), { message: "maxDailyLossPct must be a finite number" }),
        maxPositionSizePct: z
          .union([z.number(), z.string().trim().transform(Number)])
          .refine((v) => Number.isFinite(v), { message: "maxPositionSizePct must be a finite number" })
      })
      .strict(),
    params: strategyParamsSchema,
    bitunix: bitunixConfigSchema.optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.symbol !== config.params.symbol) {
      ctx.addIssue({
        code: "custom",
        path: ["symbol"],
        message: "symbol must match params.symbol"
      });
    }

    if (config.interval !== config.params.interval) {
      ctx.addIssue({
        code: "custom",
        path: ["interval"],
        message: "interval must match params.interval"
      });
    }

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

    /**
     * Enforce Bitunix spot market to long-only direction mode.
     */
    if (config.exchange === "bitunix" && config.bitunix?.marketType === "spot") {
      if (config.params.entry.directionMode !== "long_only") {
        ctx.addIssue({
          code: "custom",
          path: ["params", "entry", "directionMode"],
          message: "directionMode must be long_only when Bitunix marketType is spot"
        });
      }
    }
  });

export type BotConfig = z.infer<typeof botConfigSchema>;
