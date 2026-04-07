import {
  Candle,
  AsiaRange,
  PreviousDayLevel,
  TwoCandleBehavior,
  DayOwner,
  DateOwner,
  MarketSession,
  SessionTimeMode
} from "../types";
import {
  toTimeString,
  classifySession,
  classifySessionTimeMode,
  filterAsiaCandles,
  filterCycleCandles,
  toUtc8
} from "../utils";

/**
 * Input for Phase 1: INTERACT
 */
export type InteractInput = Readonly<{
  allCandles15m: readonly Candle[];
  cycleStartUtcMs: number;
  pdh: number;
  pdl: number;
}>;

/**
 * Output for Phase 1: INTERACT
 */
export type InteractResult = Readonly<{
  dayOwner: DayOwner;
  dateOwner: DateOwner;
  date: string;                      // "dd/mm/yyyy"
  day: string;                       // "Mon", "Tue", etc.
  asiaRange: AsiaRange;
  previousDayLevel: PreviousDayLevel;
  twoCandleBehavior: TwoCandleBehavior;
  firstInteractionTime: string;            // "H:mm:ss" or "N/A"
  firstInteractionSession: MarketSession;
  firstInteractionSessionTimeMode: SessionTimeMode; // STD | DST | C/R | N/A
  firstInteractionCandleIndex: number;     // Index in allCandles15m, -1 if no interaction
}>;

/**
 * Analyzes the initial interaction phase of a trading daily cycle.
 */
export function analyzeInteract(input: InteractInput): InteractResult {
  const { allCandles15m, cycleStartUtcMs, pdh, pdl } = input;

  // Meta / Dates
  const cycleDate = toUtc8(cycleStartUtcMs); // 08:00 UTC+8
  const dateStr = cycleDate.toFormat("dd/MM/yyyy");
  const dayStr = cycleDate.toFormat("ccc");

  // Filter candles
  const asiaCandles = filterAsiaCandles(allCandles15m, cycleStartUtcMs);
  const cycleCandles = filterCycleCandles(allCandles15m, cycleStartUtcMs);

  // Asia Range Calculation
  let arHigh = -Infinity;
  let arLow = Infinity;
  for (const c of asiaCandles) {
    if (c.high > arHigh) arHigh = c.high;
    if (c.low < arLow) arLow = c.low;
  }

  let touchH_time = Infinity;
  let touchL_time = Infinity;

  // For AR Interaction we scan cycle candles
  if (asiaCandles.length > 0) {
    for (const c of cycleCandles) {
      const touchesHigh = c.close >= arHigh;
      const touchesLow = c.close <= arLow;

      if (touchesHigh && touchH_time === Infinity) touchH_time = c.timeUtcMs;
      if (touchesLow && touchL_time === Infinity) touchL_time = c.timeUtcMs;
    }
  }

  let asiaRange: AsiaRange = "AR_NONE";
  if (touchH_time !== Infinity && touchL_time !== Infinity) {
    if (touchH_time < touchL_time) asiaRange = "AR_BOTH_HL";
    else if (touchL_time < touchH_time) asiaRange = "AR_BOTH_LH";
    else asiaRange = "AR_BOTH_HL"; // Same candle
  } else if (touchH_time !== Infinity) {
    asiaRange = "AR_SINGLE_H";
  } else if (touchL_time !== Infinity) {
    asiaRange = "AR_SINGLE_L";
  }

  // Previous Day Level Interaction (PDH/PDL)
  let pdhTouchTime = Infinity;
  let pdlTouchTime = Infinity;

  for (const c of cycleCandles) {
    const touchesPdh = c.close >= pdh;
    const touchesPdl = c.close <= pdl;

    if (touchesPdh && pdhTouchTime === Infinity) pdhTouchTime = c.timeUtcMs;
    if (touchesPdl && pdlTouchTime === Infinity) pdlTouchTime = c.timeUtcMs;
  }

  let previousDayLevel: PreviousDayLevel = "PD_NONE";
  if (pdhTouchTime !== Infinity && pdlTouchTime !== Infinity) {
    if (pdhTouchTime < pdlTouchTime) previousDayLevel = "PDH";
    else previousDayLevel = "PDL";
  } else if (pdhTouchTime !== Infinity) {
    previousDayLevel = "PDH";
  } else if (pdlTouchTime !== Infinity) {
    previousDayLevel = "PDL";
  }

  const targetTouchTime = previousDayLevel === "PDH" ? pdhTouchTime : (previousDayLevel === "PDL" ? pdlTouchTime : Infinity);

  let firstInteractionCandleIndex = -1;
  let firstInteractionCandle: Candle | null = null;

  if (targetTouchTime !== Infinity) {
    firstInteractionCandleIndex = allCandles15m.findIndex(c => c.timeUtcMs === targetTouchTime);
    if (firstInteractionCandleIndex !== -1) {
      firstInteractionCandle = allCandles15m[firstInteractionCandleIndex] ?? null;
    }
  }

  // Two Candle Behavior
  let twoCandleBehavior: TwoCandleBehavior = "NO_INTERACTION";
  if (firstInteractionCandleIndex !== -1 && firstInteractionCandle) {
    const c1 = firstInteractionCandle;
    const c2 = allCandles15m[firstInteractionCandleIndex + 1]; // Can be undefined if end of array

    if (c1 && c2) {
      if (previousDayLevel === "PDH") {
        if (c1.close > pdh && c2.close > pdh) {
          // Both closed firmly above PDH — strong break
          twoCandleBehavior = "BREAK_HOLD";
        } else if (c1.close >= pdh && c2.close < pdh) {
          // C1 touched/closed at or above PDH, C2 closed back below — rejected
          twoCandleBehavior = "TOUCH_REJECT";
        } else {
          // Mixed / consolidating near the level
          twoCandleBehavior = "TOUCH_CONSOLIDATE";
        }
      } else if (previousDayLevel === "PDL") {
        if (c1.close < pdl && c2.close < pdl) {
          twoCandleBehavior = "BREAK_HOLD";
        } else if (c1.close <= pdl && c2.close > pdl) {
          twoCandleBehavior = "TOUCH_REJECT";
        } else {
          twoCandleBehavior = "TOUCH_CONSOLIDATE";
        }
      }
    } else {
      twoCandleBehavior = "TOUCH_CONSOLIDATE";
    }
  }

  // First Interaction Time, Session, and Time Mode
  const firstInteractionTime = firstInteractionCandle ? toTimeString(firstInteractionCandle.timeUtcMs) : "N/A";
  const firstInteractionSession: MarketSession = firstInteractionCandle
    ? classifySession(firstInteractionCandle.timeUtcMs)
    : "N/A";
  const firstInteractionSessionTimeMode: SessionTimeMode = firstInteractionCandle
    ? classifySessionTimeMode(firstInteractionCandle.timeUtcMs, firstInteractionSession)
    : "N/A";

  // Day Owner / Date Owner
  // Rule: 00:00:00–07:59:59 UTC+8 → DAY_PREV / DATE_PREV
  //       08:00:00–23:59:59 UTC+8 → DAY_CURR / DATE_CURR
  // NOTE: Must use numeric UTC+8 hour comparison — NOT string comparison.
  //       toTimeString() returns "H:mm:ss" (non-zero-padded), so "3:00:00" < "08:00:00"
  //       is FALSE lexicographically ("3" > "0" in ASCII), breaking the logic entirely.
  let dayOwner: DayOwner = "DAY_CURR";
  let dateOwner: DateOwner = "DATE_CURR";

  if (firstInteractionCandle) {
    const interactionHour = toUtc8(firstInteractionCandle.timeUtcMs).hour;
    if (interactionHour < 8) {
      dayOwner = "DAY_PREV";
      dateOwner = "DATE_PREV";
    }
  }

  return {
    dayOwner,
    dateOwner,
    date: dateStr,
    day: dayStr,
    asiaRange,
    previousDayLevel,
    twoCandleBehavior,
    firstInteractionTime,
    firstInteractionSession,
    firstInteractionSessionTimeMode,
    firstInteractionCandleIndex
  };
}
