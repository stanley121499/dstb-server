/**
 * @file Backtest parameter schema (ORB + ATR).
 *
 * Authoritative source:
 * - docs/12-strategy-orb-atr.md (parameter schema)
 * - docs/13-data-yfinance-and-intervals.md (supported intervals)
 */

import { z } from "zod";

import { BpsSchema, HhMmTimeSchema } from "./primitives";

/**
 * Supported effective intervals for Phase 1.
 */
export const IntervalSchema = z.enum([
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "60m",
  "90m",
  "1h",
  "1d"
]);

/**
 * Supported Phase 1 instruments (per docs).
 */
export const SymbolSchema = z.enum(["BTC-USD", "ETH-USD", "ZEC-USD"]);

export const DirectionModeSchema = z.enum(["long_only", "short_only", "long_short"]);
export const EntryModeSchema = z.enum(["stop_breakout", "close_confirm"]);

export const SizingModeSchema = z.enum(["fixed_notional", "fixed_risk_pct"]);
export const StopModeSchema = z.enum(["or_opposite", "or_midpoint", "atr_multiple"]);
export const TakeProfitModeSchema = z.enum(["disabled", "r_multiple"]);
export const TrailingStopModeSchema = z.enum(["disabled", "atr_trailing"]);
export const TimeExitModeSchema = z.enum(["disabled", "bars_after_entry", "session_end"]);

export const BacktestParamsSchema = z
  .object({
    version: z.enum(["1.0"]),
    symbol: SymbolSchema,
    interval: IntervalSchema,

    session: z.object({
      timezone: z.literal("America/New_York"),
      startTime: z.literal("09:30"),
      openingRangeMinutes: z
        .number({ invalid_type_error: "Must be a number" })
        .int("Must be an integer")
        .min(1, "Must be >= 1")
    }),

    entry: z.object({
      directionMode: DirectionModeSchema,
      entryMode: EntryModeSchema,
      breakoutBufferBps: BpsSchema,
      maxTradesPerSession: z
        .number({ invalid_type_error: "Must be a number" })
        .int("Must be an integer")
        .min(1, "Must be >= 1")
    }),

    atr: z
      .object({
        atrLength: z
          .number({ invalid_type_error: "Must be a number" })
          .int("Must be an integer")
          .min(1, "Must be >= 1"),
        atrFilter: z.object({
          enabled: z.boolean(),
          minAtrBps: BpsSchema,
          maxAtrBps: BpsSchema
        })
      })
      .superRefine((atr, ctx) => {
        if (atr.atrFilter.minAtrBps > atr.atrFilter.maxAtrBps) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["atrFilter", "minAtrBps"],
            message: "Must be <= maxAtrBps"
          });
        }
      }),

    risk: z
      .object({
        sizingMode: SizingModeSchema,

        /**
         * Percent of equity risked per trade.
         *
         * Note: The docs include `fixed_notional` sizing but do not (yet) define
         * a notional field name; the Phase 1 UI uses `risk.fixedNotional`, and
         * the API accepts it for end-to-end compatibility.
         */
        riskPctPerTrade: z
          .number({ invalid_type_error: "Must be a number" })
          .min(0, "Must be >= 0")
          .max(100, "Must be <= 100"),

        /**
         * Fixed notional per trade (used when sizingMode === "fixed_notional").
         */
        fixedNotional: z
          .number({ invalid_type_error: "Must be a number" })
          .min(0, "Must be >= 0")
          .optional()
          .default(0),

        stopMode: StopModeSchema,
        atrStopMultiple: z
          .number({ invalid_type_error: "Must be a number" })
          .positive("Must be > 0"),

        takeProfitMode: TakeProfitModeSchema,
        tpRMultiple: z.number({ invalid_type_error: "Must be a number" }).positive("Must be > 0"),

        trailingStopMode: TrailingStopModeSchema,
        atrTrailMultiple: z
          .number({ invalid_type_error: "Must be a number" })
          .positive("Must be > 0"),

        timeExitMode: TimeExitModeSchema,
        barsAfterEntry: z
          .number({ invalid_type_error: "Must be a number" })
          .int("Must be an integer")
          .min(0, "Must be >= 0"),
        sessionEndTime: HhMmTimeSchema
      })
      .superRefine((risk, ctx) => {
        if (risk.sizingMode === "fixed_notional" && risk.fixedNotional <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fixedNotional"],
            message: "Must be > 0 when sizingMode is fixed_notional"
          });
        }

        if (risk.sizingMode === "fixed_risk_pct" && risk.riskPctPerTrade <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["riskPctPerTrade"],
            message: "Must be > 0 when sizingMode is fixed_risk_pct"
          });
        }

        if (risk.stopMode !== "atr_multiple") {
          // The docs keep `atrStopMultiple` in the payload; we do not require it to be unused,
          // but we ensure it is still a valid positive number.
        }

        if (risk.takeProfitMode === "disabled") {
          // `tpRMultiple` remains present in the payload; we validate it but do not require use.
        }

        if (risk.trailingStopMode === "disabled") {
          // `atrTrailMultiple` remains present in the payload; we validate it but do not require use.
        }

        if (risk.timeExitMode === "bars_after_entry" && risk.barsAfterEntry < 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["barsAfterEntry"],
            message: "Must be >= 1 when timeExitMode is bars_after_entry"
          });
        }

        if (risk.timeExitMode === "session_end") {
          // `sessionEndTime` already validated as HH:MM.
        }
      }),

    execution: z.object({
      feeBps: BpsSchema,
      slippageBps: BpsSchema
    })
  })
  .strict();

export type Interval = z.infer<typeof IntervalSchema>;
export type Symbol = z.infer<typeof SymbolSchema>;

export type BacktestParams = z.infer<typeof BacktestParamsSchema>;
export type DirectionMode = z.infer<typeof DirectionModeSchema>;
export type EntryMode = z.infer<typeof EntryModeSchema>;
export type SizingMode = z.infer<typeof SizingModeSchema>;
export type StopMode = z.infer<typeof StopModeSchema>;
export type TakeProfitMode = z.infer<typeof TakeProfitModeSchema>;
export type TrailingStopMode = z.infer<typeof TrailingStopModeSchema>;
export type TimeExitMode = z.infer<typeof TimeExitModeSchema>;




