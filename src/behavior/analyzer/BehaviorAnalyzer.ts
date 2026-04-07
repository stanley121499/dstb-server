import { DailyCycleInput, BehaviorRow, HtfEdge } from "../types";
import { analyzeInteract } from "./interactAnalyzer";
import { analyzeDecision } from "./decisionAnalyzer";
import { analyzeOutcome } from "./outcomeAnalyzer";
import { analyzeHtfContext } from "./htfContextAnalyzer";
import { toDateString, toDayString, toMonthString } from "../utils";

// ============================================================================
// Verbose label maps — converts internal enum codes to Darren's sheet format
// ============================================================================

/**
 * Maps raw AsiaRange code to the verbose label written in the Google Sheet.
 * Format: "{CODE} — {description}"
 */
const ASIA_RANGE_VERBOSE: Readonly<Record<string, string>> = {
  "AR_NONE":     "AR_NONE — No AR High or Low touched",
  "AR_SINGLE_H": "AR_SINGLE_H — AR High touched only",
  "AR_SINGLE_L": "AR_SINGLE_L — AR Low touched only",
  "AR_BOTH_HL":  "AR_BOTH_HL — AR High then Low touched",
  "AR_BOTH_LH":  "AR_BOTH_LH — AR Low then High touched",
};

/**
 * Maps raw MarketSession code to the verbose label written in the Google Sheet.
 * Format: "{CODE} — {description} {startTime} – {endTime}"
 * Times are in UTC+8 (MYT). Uses en-dash (–) between time range.
 */
const SESSION_VERBOSE: Readonly<Record<string, string>> = {
  "ASIA_PRE":   "ASIA_PRE — Pre Asia Warm-up 08:00:00 – 08:59:59",
  "ASIA_H1":    "ASIA_H1 — 1st Half 09:00:00 – 10:59:59",
  "ASIA_TP_H1": "ASIA_TP_H1 — TP Zone 1st Half 11:00:00 – 12:29:59",
  "ASIA_H2":    "ASIA_H2 — 2nd Half 12:30:00 – 14:59:59",
  "ASIA_TP_H2": "ASIA_TP_H2 — TP Zone 2nd Half 15:00:00 – 15:59:59",
  "UK_PRE":     "UK_PRE — Pre UK Warm-up 16:00:00 – 16:59:59",
  "UK_H1":      "UK_H1 — 1st Half 17:00:00 – 18:59:59",
  "UK_TP_H1":   "UK_TP_H1 — TP Zone 1st Half 19:00:00 – 20:59:59",
  "UK_H2":      "UK_H2 — 2nd Half 21:00:00 – 22:59:59",
  "UK_TP_H2":   "UK_TP_H2 — TP Zone 2nd Half 23:00:00 – 23:59:59",
  "US_PRE":     "US_PRE — Pre US Warm-up 21:30:00 – 22:29:59",
  "US_H1":      "US_H1 — 1st Half 22:30:00 – 00:59:59",
  "US_TP_H1":   "US_TP_H1 — TP Zone 1st Half 01:00:00 – 02:29:59",
  "US_H2":      "US_H2 — 2nd Half 02:30:00 – 03:59:59",
  "US_TP_H2":   "US_TP_H2 — TP Zone 2nd Half 04:00:00 – 04:59:59",
  "MKT_CLOSED": "MKT_CLOSED — Market Closed 05:00:00 – 06:29:59",
  "MKT_RESET":  "MKT_RESET — Market Reset 06:30:00 – 07:59:59",
  "N/A":        "N/A — No PDH/PDL interaction",
};

/**
 * Maps raw MoveScore code to the verbose label written in the Google Sheet.
 * Format: "{CODE} ({range})" — spaces around –, space after < and ≥, 2dp lower bounds.
 * "N/A" is returned as-is (not in map; falls through via ?? operator).
 */
const MOVE_SCORE_VERBOSE: Readonly<Record<string, string>> = {
  "MS_NOISE":   "MS_NOISE (< 0.50)",
  "MS_WEAK":    "MS_WEAK (0.50 – <1.0)",
  "MS_HEALTHY": "MS_HEALTHY (1.0 – <2.0)",
  "MS_STRONG":  "MS_STRONG (≥ 2.0)",
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts a time string (e.g. "8:30:00" or "11:00:00") to zero-padded HHMM
 * format for use in the notes field (e.g. "0830", "1100").
 */
function toHHMM(t: string): string {
  const parts = t.split(":");
  const h = parts[0] ?? "0";
  const m = parts[1] ?? "00";
  return h.padStart(2, "0") + m;
}

export class BehaviorAnalyzer {
  public analyze(input: DailyCycleInput): BehaviorRow {
    // 1. Run INTERACT
    const interactResult = analyzeInteract({
      allCandles15m: input.allCandles15m,
      cycleStartUtcMs: input.cycleStartUtcMs,
      pdh: input.pdh,
      pdl: input.pdl
    });

    // 2. Run DECISION
    const decisionResult = analyzeDecision({
      allCandles15m: input.allCandles15m,
      interactResult,
      pdh: input.pdh,
      pdl: input.pdl
    });

    // 3. Derive expectedDirection
    let expectedDirection: "UP" | "DOWN" | "N/A" = "N/A";
    const pdLvl = interactResult.previousDayLevel;
    const decOut = decisionResult.resolvedDecisionOutput;

    if (pdLvl === "PDH" && decOut === "ACCEPTANCE") expectedDirection = "UP";
    else if (pdLvl === "PDH" && decOut === "REJECTION") expectedDirection = "DOWN";
    else if (pdLvl === "PDL" && decOut === "ACCEPTANCE") expectedDirection = "DOWN";
    else if (pdLvl === "PDL" && decOut === "REJECTION") expectedDirection = "UP";

    // 4. Run OUTCOME
    const outcomeResult = analyzeOutcome({
      allCandles15m: input.allCandles15m,
      interactResult,
      decisionResult,
      pdh: input.pdh,
      pdl: input.pdl
    });

    // 5. Run HTF Context
    let htfEdgeStr: HtfEdge = "MID_NEUTRAL";
    if (decisionResult.decisionConfirmCandleIndex !== -1) {
      const confirmCandle = input.allCandles15m[decisionResult.decisionConfirmCandleIndex];
      if (confirmCandle) {
        const decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs;

        const htfResult = analyzeHtfContext({
          candles4h: input.candles4h,
          decisionConfirmTimeUtcMs,
          decisionLevelPrice: pdLvl === "PDH" ? input.pdh : input.pdl,
          expectedDirection
        });
        htfEdgeStr = htfResult.htfEdge;
      }
    }

    // 6. Build verbose HTF Edge label
    // PD_NONE or no decision: "NEUTRAL → automatically NOT_SUPPORT"
    // Otherwise: "{LOCATION} + {SUPPORT/NOT_SUPPORT} → {EDGE_CODE}"
    let htf4hEdgeVerbose: string;
    if (decisionResult.decisionConfirmCandleIndex === -1) {
      htf4hEdgeVerbose = "NEUTRAL → automatically NOT_SUPPORT";
    } else {
      const isSupport = htfEdgeStr === "EDGE_ALIGN" || htfEdgeStr === "MID_ALIGN";
      const locationStr = htfEdgeStr.startsWith("EDGE") ? "EDGE" : "MID";
      htf4hEdgeVerbose = `${locationStr} + ${isSupport ? "SUPPORT" : "NOT_SUPPORT"} → ${htfEdgeStr}`;
    }

    // 7. lifecycleCrossedDayBoundary
    const nextCycleStart = input.cycleStartUtcMs + 24 * 60 * 60 * 1000;
    const confirmIdx = decisionResult.decisionConfirmCandleIndex;
    const usedIndices: number[] = [];
    if (confirmIdx !== -1) {
      for (let i = confirmIdx + 1; i <= confirmIdx + 8; i++) usedIndices.push(i);
    }
    const crossed = usedIndices.some(idx => {
      const c = input.allCandles15m[idx];
      return c !== undefined && c.timeUtcMs >= nextCycleStart;
    });
    const lifecycleCrossedDayBoundary = crossed ? "YES" : "NO";

    // 8. Build notes string
    //    Format: "{SESSION} {HHMM} INTERACT {LEVEL} {BEHAVIOR} -> {HHMM} DECIDE {output} ({strength}) -> OUTCOME {direction} ({quality}) completed by {HHMM}"
    const uidStr = input.uid.toString();
    const cycleDateStr = input.writeDate ?? toDateString(input.cycleStartUtcMs);

    let notes = "N/A";
    if (interactResult.firstInteractionCandleIndex !== -1) {
      // Use raw session code (first token before any space/dash) for compact notes
      const sess = interactResult.firstInteractionSession.split(" ")[0] ?? interactResult.firstInteractionSession;
      const tInteract = interactResult.firstInteractionTime !== "N/A"
        ? toHHMM(interactResult.firstInteractionTime)
        : "N/A";
      const tDecide = decisionResult.decisionConfirmTime !== "N/A"
        ? toHHMM(decisionResult.decisionConfirmTime)
        : "N/A";
      const tOutcomeStr = outcomeResult.outcomePeakTime !== "N/A"
        ? ` completed by ${toHHMM(outcomeResult.outcomePeakTime)}`
        : "";

      notes = `${sess} ${tInteract} INTERACT ${pdLvl} ${interactResult.twoCandleBehavior} -> ` +
        `${tDecide} DECIDE ${decisionResult.resolvedDecisionOutput.toLowerCase()} ` +
        `(${decisionResult.resolvedDecisionStrength}) -> OUTCOME ` +
        `${outcomeResult.resolvedOutcomeDirection.toLowerCase()} ` +
        `(${outcomeResult.resolvedOutcomeQuality.replace("MS_", "").toLowerCase()})${tOutcomeStr}`;
    }

    return {
      entryDate: cycleDateStr,
      uid: uidStr,
      tradingViewLink: "",
      pair: "$BTC",
      day: toDayString(input.cycleStartUtcMs),
      dayOwner: interactResult.dayOwner,
      date: interactResult.date,
      dateOwner: interactResult.dateOwner,
      // Apply verbose labels for sheet output
      asiaRange: ASIA_RANGE_VERBOSE[interactResult.asiaRange] ?? interactResult.asiaRange,
      previousDayLevel: interactResult.previousDayLevel,
      twoCandleBehavior: interactResult.twoCandleBehavior,
      firstInteractionTime: interactResult.firstInteractionTime,
      firstInteractionSession: SESSION_VERBOSE[interactResult.firstInteractionSession] ?? interactResult.firstInteractionSession,
      firstInteractionSessionTimeMode: interactResult.firstInteractionSessionTimeMode,
      entryPrice: "",
      leverage: "",
      marginUsed: "",
      positionSize: "",
      accountRisk: "",
      stopLossPrice: "",
      takeProfitPrice: "",
      r: "",
      fees: "",
      exitPrice: "",
      exitDateTime: "",
      grossPnl: "",
      netPnl: "",
      decisionBeginType: decisionResult.decisionBeginType,
      decisionBeginTime: decisionResult.decisionBeginTime,
      decisionOutput: decisionResult.decisionOutput,
      decisionConfirmTime: decisionResult.decisionConfirmTime,
      failedStatus: decisionResult.failedStatus,
      resolvedDecisionOutput: decisionResult.resolvedDecisionOutput,
      resolvedDecisionStrength: decisionResult.resolvedDecisionStrength,
      resolvedOutcomeDirection: outcomeResult.resolvedOutcomeDirection,
      // Apply verbose MoveScore label for sheet output
      resolvedOutcomeQuality: MOVE_SCORE_VERBOSE[outcomeResult.resolvedOutcomeQuality] ?? outcomeResult.resolvedOutcomeQuality,
      // Non-zero scores get "MS" suffix (e.g. "1.82MS"). Zero = plain "0" (STALL / N/A cases).
      moveScoreValue: outcomeResult.moveScore > 0
        ? `${outcomeResult.moveScore.toFixed(2)}MS`
        : "0",
      resolvedOutcomeBeginTime: outcomeResult.resolvedOutcomeBeginTime,
      outcomePeakTime: outcomeResult.outcomePeakTime,
      // Apply verbose HTF Edge label for sheet output
      htf4hEdge: htf4hEdgeVerbose,
      htf4hEdgeLink: "",
      lifecycleCrossedDayBoundary,
      notes,
      win: "",
      loss: "",
      winDollar: "",
      lossDollar: "",
      inUse: "",
      month: toMonthString(input.cycleStartUtcMs),
      consecutiveWins: "",
      consecutiveLosses: "",
      uidLink: ""
    };
  }
}
