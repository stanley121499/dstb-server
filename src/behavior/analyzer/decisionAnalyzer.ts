import {
  Candle,
  DecisionBeginType,
  DecisionOutput,
  FailedStatus,
  ResolvedStrength
} from "../types";
import { InteractResult } from "./interactAnalyzer";
import { toTimeString, computeAtr } from "../utils";

export type DecisionInput = Readonly<{
  allCandles15m: readonly Candle[];
  interactResult: InteractResult;
  pdh: number;
  pdl: number;
}>;

export type DecisionResult = Readonly<{
  decisionBeginType: DecisionBeginType;
  decisionBeginTime: string;         // "HH:MM:SS" or "N/A"
  decisionOutput: DecisionOutput;
  decisionConfirmTime: string;       // "HH:MM:SS" or "N/A"
  decisionConfirmCandleIndex: number; // Index of C0 (2nd confirming candle), -1 if none
  failedStatus: FailedStatus;
  resolvedDecisionOutput: DecisionOutput;
  resolvedDecisionStrength: ResolvedStrength;
  atrAtConfirm: number | null;       // ATR(15M,14) at confirm candle, used by outcome analyzer
}>;

export function analyzeDecision(input: DecisionInput): DecisionResult {
  const { allCandles15m, interactResult, pdh, pdl } = input;
  const firstIdx = interactResult.firstInteractionCandleIndex;
  const level = interactResult.previousDayLevel;
  const levelPrice = level === "PDH" ? pdh : (level === "PDL" ? pdl : 0);

  // Defaults
  let decisionBeginType: DecisionBeginType = "ATT_IND";
  let decisionBeginTime = "N/A";
  let decisionOutput: DecisionOutput = "INDECISIVE";
  let decisionConfirmTime = "N/A";
  let decisionConfirmCandleIndex = -1;
  let failedStatus: FailedStatus = "NONE";
  let resolvedDecisionOutput: DecisionOutput = "INDECISIVE";
  let resolvedDecisionStrength: ResolvedStrength = "IND";
  let atrAtConfirm: number | null = null;

  if (firstIdx === -1 || level === "PD_NONE") {
    return {
      decisionBeginType,
      decisionBeginTime,
      decisionOutput,
      decisionConfirmTime,
      decisionConfirmCandleIndex,
      failedStatus,
      resolvedDecisionOutput,
      resolvedDecisionStrength,
      atrAtConfirm
    };
  }

  const isBeyond = (c: Candle) => level === "PDH" ? c.close > pdh : c.close < pdl;
  const isInside = (c: Candle) => level === "PDH" ? c.close < pdh : c.close > pdl;

  // Decision Begin Type
  const c1 = allCandles15m[firstIdx];
  const c2 = allCandles15m[firstIdx + 1];

  if (c1 && c2) {
    if ((isBeyond(c1) && isBeyond(c2)) || (isInside(c1) && isInside(c2))) {
      decisionBeginType = "ATT_BGN_EARLY";
      decisionBeginTime = toTimeString(c1.timeUtcMs);
    } else {
      decisionBeginType = "ATT_BGN_DEFAULT";
    }
  } else if (c1) {
    // only one candle available
    decisionBeginType = "ATT_BGN_DEFAULT";
  }

  // Find Decision Confirm (2-consecutive rule)
  // Scan starting from firstIdx
  let pairFound = false;
  for (let i = firstIdx; i < allCandles15m.length - 1; i++) {
    const cur = allCandles15m[i];
    const nxt = allCandles15m[i + 1];

    if (cur && nxt) {
      if (isBeyond(cur) && isBeyond(nxt)) {
        decisionOutput = "ACCEPTANCE";
        decisionConfirmCandleIndex = i + 1;
        pairFound = true;
        break;
      }

      if (isInside(cur) && isInside(nxt)) {
        decisionOutput = "REJECTION";
        decisionConfirmCandleIndex = i + 1;
        pairFound = true;
        break;
      }
    }
  }

  if (pairFound) {
    const c0 = allCandles15m[decisionConfirmCandleIndex];
    if (c0) {
      decisionConfirmTime = toTimeString(c0.timeUtcMs);
    }

    if (decisionBeginType === "ATT_BGN_DEFAULT") {
      // Begin time is time of the first candle of the pair
      const pairStartCandle = allCandles15m[decisionConfirmCandleIndex - 1];
      if (pairStartCandle) decisionBeginTime = toTimeString(pairStartCandle.timeUtcMs);
    }

    atrAtConfirm = computeAtr(allCandles15m, decisionConfirmCandleIndex, 14);

    // Evaluated Window (C3 to C6 relative to firstIdx... wait! Prompt says C3 is decisionConfirmCandleIndex + 1)
    // "C3 = allCandles15m[decisionConfirmIndex + 1] through C6 = allCandles15m[decisionConfirmIndex + 4]"
    // This naming C3..C6 is just to represent the next 4 candles after C0. Let's stick to C1..C4 in array terms.
    // C0 = decisionConfirmCandleIndex
    // Window array = [C0+1, C0+2, C0+3, C0+4]
    const windowStart = decisionConfirmCandleIndex + 1;
    const windowEnd = decisionConfirmCandleIndex + 4;
    const next4 = allCandles15m.slice(windowStart, Math.min(windowEnd + 1, allCandles15m.length));

    // Failed status
    let failedPairFound = false;
    for (let i = 0; i < next4.length - 1; i++) {
      const cur = next4[i];
      const nxt = next4[i + 1];
      if (cur && nxt) {
        if (decisionOutput === "ACCEPTANCE" && isInside(cur) && isInside(nxt)) {
          failedPairFound = true;
          break;
        }
        if (decisionOutput === "REJECTION" && isBeyond(cur) && isBeyond(nxt)) {
          failedPairFound = true;
          break;
        }
      }
    }

    if (decisionOutput === "ACCEPTANCE") {
      failedStatus = failedPairFound ? "ACP_FAIL_INV" : "ACP_SUCC";
      resolvedDecisionOutput = failedPairFound ? "REJECTION" : "ACCEPTANCE";
    } else if (decisionOutput === "REJECTION") {
      failedStatus = failedPairFound ? "REJ_FAIL_INV" : "REJ_SUCC";
      resolvedDecisionOutput = failedPairFound ? "ACCEPTANCE" : "REJECTION";
    }

    // Resolved Decision Strength — calculated for all pairFound cases
    const resOut = resolvedDecisionOutput;
    const atr = atrAtConfirm || 0;

    // Threshold
    let threshold = 0;
    if (resOut === "ACCEPTANCE" && level === "PDH") threshold = pdh + atr;
    else if (resOut === "ACCEPTANCE" && level === "PDL") threshold = pdl - atr;
    else if (resOut === "REJECTION" && level === "PDH") threshold = pdh - atr;
    else if (resOut === "REJECTION" && level === "PDL") threshold = pdl + atr;

    let speed: "FAST" | "MODERATE" | "SLOW" = "SLOW";
    let frictionCount = 0;

    for (let i = 0; i < next4.length; i++) {
      const c = next4[i];
      if (!c) continue;

      // speed check
      if (speed === "SLOW") {
        const crosses = (resOut === "ACCEPTANCE" && level === "PDH" && c.high >= threshold) ||
          (resOut === "ACCEPTANCE" && level === "PDL" && c.low <= threshold) ||
          (resOut === "REJECTION" && level === "PDH" && c.low <= threshold) ||
          (resOut === "REJECTION" && level === "PDL" && c.high >= threshold);

        if (crosses) {
          if (i === 0 || i === 1) speed = "FAST";       // C1 or C2
          else if (i === 2 || i === 3) speed = "MODERATE"; // C3 or C4
        }
      }

      // friction check — close-only: a candle counts as friction only if it closes back through the level
      const isRetest = resOut === "ACCEPTANCE" && (level === "PDH" ? c.close <= pdh : c.close >= pdl);
      const isReclaim = resOut === "REJECTION" && (level === "PDH" ? c.close >= pdh : c.close <= pdl);

      if (isRetest || isReclaim) {
        frictionCount++;
      }
    }

    if (speed === "FAST" && frictionCount === 0) {
      resolvedDecisionStrength = resOut === "ACCEPTANCE" ? "ACP_SUCC_IMP" : "REJ_SUCC_IMP";
    } else if ((speed === "FAST" && frictionCount === 1) || (speed === "MODERATE" && frictionCount <= 1)) {
      resolvedDecisionStrength = resOut === "ACCEPTANCE" ? "ACP_SUCC_STR" : "REJ_SUCC_STR";
    } else {
      resolvedDecisionStrength = resOut === "ACCEPTANCE" ? "ACP_SUCC_WEAK" : "REJ_SUCC_WEAK";
    }
  }

  return {
    decisionBeginType,
    decisionBeginTime,
    decisionOutput,
    decisionConfirmTime,
    decisionConfirmCandleIndex,
    failedStatus,
    resolvedDecisionOutput,
    resolvedDecisionStrength,
    atrAtConfirm
  };
}
