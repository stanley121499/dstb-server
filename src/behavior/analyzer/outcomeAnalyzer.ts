import {
  Candle,
  OutcomeDirection,
  MoveScore
} from "../types";
import { InteractResult } from "./interactAnalyzer";
import { DecisionResult } from "./decisionAnalyzer";
import { toTimeString } from "../utils";

export type OutcomeInput = Readonly<{
  allCandles15m: readonly Candle[];
  interactResult: InteractResult;
  decisionResult: DecisionResult;
  pdh: number;
  pdl: number;
}>;

export type OutcomeResult = Readonly<{
  resolvedOutcomeDirection: OutcomeDirection;
  resolvedOutcomeQuality: MoveScore;
  resolvedOutcomeBeginTime: string;   // "HH:MM:SS" or "N/A"
  outcomePeakTime: string;            // "HH:MM:SS" or "N/A"
  moveScore: number;                  // Raw MoveScore value (for logging)
}>;

export function analyzeOutcome(input: OutcomeInput): OutcomeResult {
  const { allCandles15m, interactResult, decisionResult, pdh, pdl } = input;
  const { resolvedDecisionOutput, decisionConfirmCandleIndex, atrAtConfirm } = decisionResult;

  // --- Early exit: no confirmed decision or INDECISIVE ---
  // Per Darren's rule: if Resolved Decision = INDECISIVE → Quality = N/A
  if (decisionConfirmCandleIndex === -1 || resolvedDecisionOutput === "INDECISIVE") {
    return {
      resolvedOutcomeDirection: "STALL",
      resolvedOutcomeQuality: "N/A",
      resolvedOutcomeBeginTime: "N/A",
      outcomePeakTime: "N/A",
      moveScore: 0
    };
  }

  // --- Derive expected direction ---
  // If expectedDirection remains "N/A", MoveScore = 0 (Darren's rule: N/A direction → MOVE = 0)
  let expectedDirection: "UP" | "DOWN" | "N/A" = "N/A";
  let decisionLevelPrice = 0;

  if (interactResult.previousDayLevel === "PDH") {
    decisionLevelPrice = pdh;
    if (resolvedDecisionOutput === "ACCEPTANCE") expectedDirection = "UP";
    else if (resolvedDecisionOutput === "REJECTION") expectedDirection = "DOWN";
  } else if (interactResult.previousDayLevel === "PDL") {
    decisionLevelPrice = pdl;
    if (resolvedDecisionOutput === "ACCEPTANCE") expectedDirection = "DOWN";
    else if (resolvedDecisionOutput === "REJECTION") expectedDirection = "UP";
  }

  if (expectedDirection === "N/A") {
    return {
      resolvedOutcomeDirection: "STALL",
      resolvedOutcomeQuality: "N/A",
      resolvedOutcomeBeginTime: "N/A",
      outcomePeakTime: "N/A",
      moveScore: 0
    };
  }

  // --- Evaluation window: C1–C8 (8 candles after the confirmed C0) ---
  const c0Index = decisionConfirmCandleIndex;
  const c1Index = c0Index + 1;
  const c8Index = c0Index + 8;
  const evalCandles = allCandles15m.slice(c1Index, Math.min(c8Index + 1, allCandles15m.length));

  if (evalCandles.length === 0) {
    return {
      resolvedOutcomeDirection: "STALL",
      resolvedOutcomeQuality: "N/A",
      resolvedOutcomeBeginTime: "N/A",
      outcomePeakTime: "N/A",
      moveScore: 0
    };
  }

  const atr = atrAtConfirm || 0;

  // --- MoveScore: Maximum Favorable Excursion within C1–C8 ---
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let peakCandle: Candle | null = null;

  for (const c of evalCandles) {
    if (c.high > maxHigh) {
      maxHigh = c.high;
      if (expectedDirection === "UP") peakCandle = c;
    }
    if (c.low < minLow) {
      minLow = c.low;
      if (expectedDirection === "DOWN") peakCandle = c;
    }
  }

  let move = 0;
  if (expectedDirection === "UP") {
    move = maxHigh - decisionLevelPrice;
  } else if (expectedDirection === "DOWN") {
    move = decisionLevelPrice - minLow;
  }

  const moveScoreRaw = atr > 0 ? move / atr : 0;

  // --- Resolved Outcome Quality (from MoveScore thresholds) ---
  let resolvedOutcomeQuality: MoveScore;
  if (moveScoreRaw < 0.5) {
    resolvedOutcomeQuality = "MS_NOISE";
  } else if (moveScoreRaw < 1.0) {
    resolvedOutcomeQuality = "MS_WEAK";
  } else if (moveScoreRaw < 2.0) {
    resolvedOutcomeQuality = "MS_HEALTHY";
  } else {
    resolvedOutcomeQuality = "MS_STRONG";
  }

  // --- Resolved Outcome Direction (Darren's Journal spec) ---
  // Outcome label follows the decision; MoveScore gate filters noise.
  // If Resolved Decision = INDECISIVE → STALL (handled above)
  // Else if MoveScore < 0.5 → STALL
  // Else if Resolved Decision = ACCEPTANCE → CONTINUATION
  // Else if Resolved Decision = REJECTION → MEAN-REVERSION
  let resolvedOutcomeDirection: OutcomeDirection;
  if (moveScoreRaw < 0.5) {
    resolvedOutcomeDirection = "STALL";
  } else if (resolvedDecisionOutput === "ACCEPTANCE") {
    resolvedOutcomeDirection = "CONTINUATION";
  } else {
    resolvedOutcomeDirection = "MEAN-REVERSION";
  }

  // --- Outcome Peak Time ---
  const outcomePeakTime =
    peakCandle !== null && moveScoreRaw > 0
      ? toTimeString(peakCandle.timeUtcMs)
      : "N/A";

  // --- Resolved Outcome Begin Time ---
  // NEW CONDITION (Darren query 4): Expansion measured by High/Low.
  // Scan C1–C8; the FIRST candle satisfying ALL 3 conditions is the begin time:
  //   UP:   (1) close > prevClose  (2) close > decisionLevel  (3) high  >= decisionLevel + 0.25 × ATR
  //   DOWN: (1) close < prevClose  (2) close < decisionLevel  (3) low   <= decisionLevel - 0.25 × ATR
  // If no qualifying candle exists → "N/A"
  let resolvedOutcomeBeginTime = "N/A";

  for (let i = c1Index; i <= Math.min(c8Index, allCandles15m.length - 1); i++) {
    const c = allCandles15m[i];
    const prev = allCandles15m[i - 1]; // C0 when i = c1Index, then each prior candle
    if (!c || !prev) continue;

    if (expectedDirection === "UP") {
      const momentum  = c.close > prev.close;                              // Directional momentum
      const levelPos  = c.close > decisionLevelPrice;                      // Closed above level
      const expansion = c.high  >= decisionLevelPrice + 0.25 * atr;       // High expansion gate
      if (momentum && levelPos && expansion) {
        resolvedOutcomeBeginTime = toTimeString(c.timeUtcMs);
        break;
      }
    } else { // DOWN
      const momentum  = c.close < prev.close;                              // Directional momentum
      const levelPos  = c.close < decisionLevelPrice;                      // Closed below level
      const expansion = c.low   <= decisionLevelPrice - 0.25 * atr;       // Low expansion gate
      if (momentum && levelPos && expansion) {
        resolvedOutcomeBeginTime = toTimeString(c.timeUtcMs);
        break;
      }
    }
  }

  return {
    resolvedOutcomeDirection,
    resolvedOutcomeQuality,
    resolvedOutcomeBeginTime,
    outcomePeakTime,
    moveScore: moveScoreRaw
  };
}
