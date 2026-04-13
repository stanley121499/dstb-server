import { z } from "zod";

import type { ParamsValidationResult } from "@/lib/configFormValidation";
import { parseAndValidateParams } from "@/lib/configFormValidation";

/**
 * JSONB shape for `behavior_environments.derived_params`.
 * Maps 1:1 into `configs` + initial `config_versions` (same fields as the config editor form).
 */
export const environmentDerivedParamsSchema = z
  .object({
    name: z.string().trim().min(1),
    strategy: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    interval: z.string().trim().min(1),
    exchange: z.enum(["paper", "bitunix"]),
    initial_balance: z.coerce.number().finite().positive(),
    maxDailyLossPct: z.coerce.number().finite().positive().lt(50),
    maxPositionSizePct: z.coerce.number().finite().positive().max(100),
    params: z.record(z.string(), z.unknown())
  })
  .strict();

export type EnvironmentDerivedParams = z.infer<typeof environmentDerivedParamsSchema>;

/**
 * Parses untrusted JSON (e.g. from DB or API) into a validated derived-params object.
 */
export function parseEnvironmentDerivedParamsFromUnknown(value: unknown): {
  ok: true;
  data: EnvironmentDerivedParams;
} | {
  ok: false;
  message: string;
} {
  const parsed = environmentDerivedParamsSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Validates strategy-specific params inside `derived_params` (Zod map in `paramsValidation`).
 */
export function validateStrategyParamsForDerived(row: EnvironmentDerivedParams): ParamsValidationResult {
  return parseAndValidateParams({
    strategy: row.strategy,
    paramsJson: JSON.stringify(row.params)
  });
}

/**
 * Default JSON for new environments — valid `orb-atr` template (matches `configs/strategies/orb-btc-15m.json` params).
 */
export const defaultDerivedParamsJson = JSON.stringify(
  {
    name: "New environment",
    strategy: "orb-atr",
    symbol: "BTC-USD",
    interval: "15m",
    exchange: "paper",
    initial_balance: 10000,
    maxDailyLossPct: 5,
    maxPositionSizePct: 100,
    params: {
      version: "1.0",
      intervalMinutes: 15,
      session: {
        timezone: "America/New_York",
        startTime: "09:30",
        openingRangeMinutes: 30
      },
      entry: {
        directionMode: "long_short",
        entryMode: "stop_breakout",
        breakoutBufferBps: 0,
        maxTradesPerSession: 1
      },
      atr: {
        atrLength: 14,
        atrFilter: {
          enabled: false,
          minAtrBps: 0,
          maxAtrBps: 1000
        }
      },
      risk: {
        sizingMode: "fixed_risk_pct",
        riskPctPerTrade: 0.5,
        fixedNotional: 0,
        stopMode: "atr_multiple",
        atrStopMultiple: 1.5,
        takeProfitMode: "r_multiple",
        tpRMultiple: 2,
        trailingStopMode: "disabled",
        atrTrailMultiple: 1.5,
        timeExitMode: "disabled",
        barsAfterEntry: 0,
        sessionEndTime: "16:00"
      },
      execution: {
        feeBps: 10,
        slippageBps: 10
      }
    }
  } satisfies EnvironmentDerivedParams,
  null,
  2
);
