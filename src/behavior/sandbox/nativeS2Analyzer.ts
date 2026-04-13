import { BehaviorAnalyzer } from "../analyzer/BehaviorAnalyzer.js";
import type { BehaviorRow, DailyCycleInput } from "../types.js";

const BEHAVIOR_ROW_KEYS: readonly (keyof BehaviorRow)[] = [
  "entryDate",
  "uid",
  "tradingViewLink",
  "pair",
  "day",
  "dayOwner",
  "date",
  "dateOwner",
  "asiaRange",
  "previousDayLevel",
  "twoCandleBehavior",
  "firstInteractionTime",
  "firstInteractionSession",
  "firstInteractionSessionTimeMode",
  "entryPrice",
  "leverage",
  "marginUsed",
  "positionSize",
  "accountRisk",
  "stopLossPrice",
  "takeProfitPrice",
  "r",
  "fees",
  "exitPrice",
  "exitDateTime",
  "grossPnl",
  "netPnl",
  "decisionBeginType",
  "decisionBeginTime",
  "decisionOutput",
  "decisionConfirmTime",
  "failedStatus",
  "resolvedDecisionOutput",
  "resolvedDecisionStrength",
  "resolvedOutcomeDirection",
  "resolvedOutcomeQuality",
  "moveScoreValue",
  "resolvedOutcomeBeginTime",
  "outcomePeakTime",
  "htf4hEdge",
  "htf4hEdgeLink",
  "lifecycleCrossedDayBoundary",
  "notes",
  "win",
  "loss",
  "winDollar",
  "lossDollar",
  "inUse",
  "month",
  "consecutiveWins",
  "consecutiveLosses",
  "uidLink",
];

/**
 * Flattens a BehaviorRow into string columns for `behavior_results.columns`.
 */
export function behaviorRowToColumns(row: BehaviorRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BEHAVIOR_ROW_KEYS) {
    out[String(key)] = row[key];
  }
  return out;
}

/**
 * Runs the built-in TypeScript BehaviorAnalyzer (native_s2 execution mode).
 */
export function runNativeS2Analyzer(input: DailyCycleInput): Readonly<{
  columns: Record<string, string>;
  details: Record<string, unknown>;
}> {
  const row = new BehaviorAnalyzer().analyze(input);
  return {
    columns: behaviorRowToColumns(row),
    details: { source: "native_s2" },
  };
}
