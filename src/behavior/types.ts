import { z } from "zod";

// ============================================================================
// INTERACT Phase Enums
// ============================================================================

/** Which Asia Range levels were touched */
export const AsiaRangeSchema = z.enum(["AR_NONE", "AR_SINGLE_H", "AR_SINGLE_L", "AR_BOTH_HL", "AR_BOTH_LH"]);
/** Type for AsiaRange */
export type AsiaRange = z.infer<typeof AsiaRangeSchema>;

/** Which Previous Day level was touched first */
export const PreviousDayLevelSchema = z.enum(["PDH", "PDL", "PD_NONE"]);
/** Type for PreviousDayLevel */
export type PreviousDayLevel = z.infer<typeof PreviousDayLevelSchema>;

/** Behavior of the first two interacting candles */
export const TwoCandleBehaviorSchema = z.enum(["BREAK_HOLD", "TOUCH_REJECT", "TOUCH_CONSOLIDATE", "NO_INTERACTION"]);
/** Type for TwoCandleBehavior */
export type TwoCandleBehavior = z.infer<typeof TwoCandleBehaviorSchema>;

/** Whether the interaction day belongs to previous or current period */
export const DayOwnerSchema = z.enum(["DAY_PREV", "DAY_CURR"]);
/** Type for DayOwner */
export type DayOwner = z.infer<typeof DayOwnerSchema>;

/** Whether the interaction date belongs to previous or current calendar date */
export const DateOwnerSchema = z.enum(["DATE_PREV", "DATE_CURR"]);
/** Type for DateOwner */
export type DateOwner = z.infer<typeof DateOwnerSchema>;

/** Market session periods based on UTC+8 times */
export const MarketSessionSchema = z.enum([
  "ASIA_PRE",     // 08:00–08:59 UTC+8
  "ASIA_H1",      // 09:00–10:59 UTC+8
  "ASIA_TP_H1",   // 11:00–12:29 UTC+8
  "ASIA_H2",      // 12:30–14:59 UTC+8
  "ASIA_TP_H2",   // 15:00–15:59 UTC+8
  "UK_PRE",       // 16:00–16:59 UTC+8
  "UK_H1",        // 17:00–18:59 UTC+8
  "UK_TP_H1",     // 19:00–20:59 UTC+8
  "UK_H2",        // 21:00–22:59 UTC+8
  "UK_TP_H2",     // 23:00–23:59 UTC+8
  "US_PRE",       // 21:30–22:29 UTC+8
  "US_H1",        // 22:30–00:59 UTC+8
  "US_TP_H1",     // 01:00–02:29 UTC+8
  "US_H2",        // 02:30–03:59 UTC+8
  "US_TP_H2",     // 04:00–04:59 UTC+8
  "MKT_CLOSED",   // 05:00–06:29 UTC+8
  "MKT_RESET",    // 06:30–07:59 UTC+8
  "N/A"
]);
/** Type for MarketSession */
export type MarketSession = z.infer<typeof MarketSessionSchema>;

// ============================================================================
// DECISION Phase Enums
// ============================================================================

/** How the decision phase began */
export const DecisionBeginTypeSchema = z.enum(["ATT_BGN_EARLY", "ATT_BGN_DEFAULT", "ATT_IND"]);
/** Type for DecisionBeginType */
export type DecisionBeginType = z.infer<typeof DecisionBeginTypeSchema>;

/** The outcome of the decision phase */
export const DecisionOutputSchema = z.enum(["ACCEPTANCE", "REJECTION", "INDECISIVE"]);
/** Type for DecisionOutput */
export type DecisionOutput = z.infer<typeof DecisionOutputSchema>;

/** How the initial decision may have failed */
export const FailedStatusSchema = z.enum(["ACP_SUCC", "ACP_FAIL_INV", "REJ_SUCC", "REJ_FAIL_INV", "NONE"]);
/** Type for FailedStatus */
export type FailedStatus = z.infer<typeof FailedStatusSchema>;

/** The final resolved strength of the decision */
export const ResolvedStrengthSchema = z.enum([
  "ACP_SUCC_IMP", "ACP_SUCC_STR", "ACP_SUCC_WEAK",
  "REJ_SUCC_IMP", "REJ_SUCC_STR", "REJ_SUCC_WEAK",
  "IND"
]);
/** Type for ResolvedStrength */
export type ResolvedStrength = z.infer<typeof ResolvedStrengthSchema>;

// ============================================================================
// OUTCOME Phase Enums
// ============================================================================

/** The resulting direction of the outcome phase */
export const OutcomeDirectionSchema = z.enum(["CONTINUATION", "MEAN-REVERSION", "STALL"]);
/** Type for OutcomeDirection */
export type OutcomeDirection = z.infer<typeof OutcomeDirectionSchema>;

/** A score representing the quality/strength of the move. "N/A" used when decision is INDECISIVE. */
export const MoveScoreSchema = z.enum(["MS_NOISE", "MS_WEAK", "MS_HEALTHY", "MS_STRONG", "N/A"]);
/** Type for MoveScore */
export type MoveScore = z.infer<typeof MoveScoreSchema>;

/**
 * Whether the first interaction occurred under Standard Time, Daylight Saving Time,
 * during a Closed/Reset window, or there was no interaction.
 * Rules:
 *   - Asia session  → always STD
 *   - UK session    → check UK DST calendar (last Sun of Mar – last Sun of Oct)
 *   - US session    → check US DST calendar (2nd Sun of Mar – 1st Sun of Nov)
 *   - MKT_CLOSED / MKT_RESET → C/R
 *   - No interaction → N/A
 */
export const SessionTimeModeSchema = z.enum(["STD", "DST", "C/R", "N/A"]);
/** Type for SessionTimeMode */
export type SessionTimeMode = z.infer<typeof SessionTimeModeSchema>;

/** The alignment of higher timeframe edge */
export const HtfEdgeSchema = z.enum(["EDGE_ALIGN", "EDGE_CONFLICT", "MID_ALIGN", "MID_NEUTRAL"]);
/** Type for HtfEdge */
export type HtfEdge = z.infer<typeof HtfEdgeSchema>;

/** Location context for the higher timeframe */
export const HtfLocationSchema = z.enum(["EDGE", "MID"]);
/** Type for HtfLocation */
export type HtfLocation = z.infer<typeof HtfLocationSchema>;

/** Bias direction from the higher timeframe */
export const HtfBiasSchema = z.enum(["BULL", "BEAR", "NEUTRAL"]);
/** Type for HtfBias */
export type HtfBias = z.infer<typeof HtfBiasSchema>;

// ============================================================================
// Common Types
// ============================================================================

/**
 * A single OHLCV 15M or 4H candle. 
 * timeUtcMs is the candle open time in UTC milliseconds.
 */
export type Candle = {
  timeUtcMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * The complete output of one daily cycle analysis (49 fields matching the Google Sheet layout).
 * All fields are string for sheet compatibility. Use empty string "" for trade fields in Phase 1.
 */
export type BehaviorRow = {
  // Meta
  entryDate: string;        // "dd/mm/yyyy" of the calendar date
  uid: string;              // sequential number as string, e.g. "1"
  tradingViewLink: string;  // URL or ""
  pair: string;             // "$BTC"
  day: string;              // "Mon", "Tue", etc.

  // INTERACT
  dayOwner: string;
  date: string;             // "dd/mm/yyyy"
  dateOwner: string;
  asiaRange: string;
  previousDayLevel: string;
  twoCandleBehavior: string;
  firstInteractionTime: string;            // "H:mm:ss" or "N/A"
  firstInteractionSession: string;
  firstInteractionSessionTimeMode: string; // "STD" | "DST" | "C/R" | "N/A"

  // Trade fields (Phase 2) — all empty string in Phase 1
  entryPrice: string;
  leverage: string;
  marginUsed: string;
  positionSize: string;
  accountRisk: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  r: string;
  fees: string;
  exitPrice: string;
  exitDateTime: string;
  grossPnl: string;
  netPnl: string;

  // DECISION
  decisionBeginType: string;
  decisionBeginTime: string;        // "HH:MM:SS" or "N/A"
  decisionOutput: string;
  decisionConfirmTime: string;      // "HH:MM:SS" or "N/A"
  failedStatus: string;
  resolvedDecisionOutput: string;
  resolvedDecisionStrength: string;

  // OUTCOME
  resolvedOutcomeDirection: string;
  resolvedOutcomeQuality: string;
  moveScoreValue: string;           // Actual computed move score, e.g. "1.42"
  resolvedOutcomeBeginTime: string; // "HH:MM:SS" or "N/A"
  outcomePeakTime: string;          // "HH:MM:SS" or "N/A"
  htf4hEdge: string;
  htf4hEdgeLink: string;            // URL or ""
  lifecycleCrossedDayBoundary: string; // "YES" | "NO"
  notes: string;

  // Stats (formula-driven in sheet — written as empty string)
  win: string;
  loss: string;
  winDollar: string;
  lossDollar: string;
  inUse: string;
  month: string;
  consecutiveWins: string;
  consecutiveLosses: string;
  uidLink: string;
};

/**
 * Input payload passed to BehaviorAnalyzer for a single daily cycle analysis.
 */
export type DailyCycleInput = {
  cycleStartUtcMs: number;    // 00:00:00 UTC (= 08:00:00 UTC+8)
  allCandles15m: readonly Candle[];   // All 15M candles within the cycle
  candles4h: readonly Candle[];    // Last 50+ 4H candles (for rolling range + EMA)
  pdh: number;                // Previous Day High (UTC+8 1D candle)
  pdl: number;                // Previous Day Low  (UTC+8 1D candle)
  uid: number;                // Sequential row number
  writeDate: string;          // "dd/mm/yyyy" — date this row is written
};
