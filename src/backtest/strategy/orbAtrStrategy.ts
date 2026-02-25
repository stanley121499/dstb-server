import { DateTime } from "luxon";

import type { Candle } from "../../data/yahooFinance.js";
import type { StrategyParams } from "../../domain/strategyParams.js";

import type {
  ExitSignal,
  OpeningRangeLevels,
  SessionState,
  Signal,
  StrategyDirection,
  StrategyPosition
} from "./types.js";

type AtrState = Readonly<{
  atr: number | null;
  prevAtr: number | null;
  trCount: number;
  trSum: number;
  prevClose: number | null;
}>;

type GenerateSignalsArgs = Readonly<{
  currentCandle: Candle;
  previousCandles: readonly Candle[];
  currentIndex?: number;
  sessionState: SessionState;
  atr: number | null;
  params: StrategyParams;
  currentPosition: StrategyPosition | null;
  tradesThisSession: number;
  sessionEntryAllowed: boolean;
}>;

type GenerateSignalsWithPosition = GenerateSignalsArgs & Readonly<{ currentPosition: StrategyPosition }>;
type GenerateSignalsNoPosition = GenerateSignalsArgs & Readonly<{ currentPosition: null }>;

type ExitCheckArgs = Readonly<{
  position: StrategyPosition;
  currentCandle: Candle;
  sessionState: SessionState;
  params: StrategyParams;
  barsSinceEntry: number;
}>;

type StopLossArgs = Readonly<{
  entryPrice: number;
  direction: StrategyDirection;
  atr: number | null;
  params: StrategyParams;
  openingRangeLevels?: OpeningRangeLevels | null;
}>;

type TrailingStopArgs = Readonly<{
  position: StrategyPosition;
  currentPrice: number;
  atr: number | null;
  params: StrategyParams;
}>;

type EntryPrecheckResult = Readonly<{ blockedReason: string | null }>;

type EntryTrigger = "long" | "short" | "ambiguous" | "none";

function holdSignal(args: Readonly<{ reason: string | null; direction?: StrategyDirection | null; quantity?: number | null }>): Signal {
  return {
    type: "HOLD",
    direction: args.direction ?? null,
    price: null,
    quantity: args.quantity ?? null,
    reason: args.reason,
    trailingStopPrice: null
  };
}

function entrySignal(args: Readonly<{ direction: StrategyDirection; price: number; reason: string }>): Signal {
  return {
    type: args.direction === "long" ? "ENTRY_LONG" : "ENTRY_SHORT",
    direction: args.direction,
    price: args.price,
    quantity: null,
    reason: args.reason,
    trailingStopPrice: null
  };
}

function timeToLocal(timeUtcMs: number, timezone: string): DateTime {
  return DateTime.fromMillis(timeUtcMs, { zone: "utc" }).setZone(timezone);
}

function parseHhMm(time: string): Readonly<{ hours: number; minutes: number }> {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) {
    throw new Error(`Invalid HH:mm time string: "${time}"`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) {
    throw new Error(`Invalid HH:mm time value: "${time}"`);
  }
  return { hours, minutes };
}

function sessionDateForUtc(timeUtcMs: number, timezone: string, startTime: string): string {
  const local = timeToLocal(timeUtcMs, timezone);
  const { hours, minutes } = parseHhMm(startTime);
  const sessionStartMinutes = hours * 60 + minutes;
  const localMinutes = local.hour * 60 + local.minute;
  const isBeforeSessionOpen = localMinutes < sessionStartMinutes;
  const sessionLocal = isBeforeSessionOpen ? local.minus({ days: 1 }) : local;
  return sessionLocal.toISODate() ?? sessionLocal.toFormat("yyyy-LL-dd");
}

function buildSessionStart(args: Readonly<{ sessionDateNy: string; startTime: string; timezone: string }>): DateTime {
  return DateTime.fromISO(`${args.sessionDateNy}T${args.startTime}:00`, { zone: args.timezone });
}

function buildSessionEnd(args: Readonly<{ sessionDateNy: string; endTime: string; timezone: string }>): DateTime {
  return DateTime.fromISO(`${args.sessionDateNy}T${args.endTime}:00`, { zone: args.timezone });
}

function computeOpeningRangeLevels(openingCandles: readonly Candle[]): OpeningRangeLevels | null {
  if (openingCandles.length === 0) {
    return null;
  }
  const firstCandle = openingCandles[0];
  if (firstCandle === undefined) {
    return null;
  }
  let orHigh = firstCandle.high;
  let orLow = firstCandle.low;
  for (const candle of openingCandles) {
    orHigh = Math.max(orHigh, candle.high);
    orLow = Math.min(orLow, candle.low);
  }
  return { orHigh, orLow, orMid: (orHigh + orLow) / 2 };
}

function createAtrState(): AtrState {
  return {
    atr: null,
    prevAtr: null,
    trCount: 0,
    trSum: 0,
    prevClose: null
  };
}

/**
 * Detects session boundaries for a single candle.
 *
 * Inputs:
 * - Candle timestamp in UTC.
 * - Session timezone/start time.
 * - Opening range duration (minutes).
 *
 * Outputs:
 * - Session date (NY local date anchor), and whether the opening range window has completed.
 *
 * Edge cases:
 * - Bars before session open are assigned to the previous session date.
 * - Uses IANA timezone rules to handle DST transitions correctly.
 */
export function detectSession(args: Readonly<{
  candle: Candle;
  timezone: string;
  startTime: string;
  openingRangeMinutes: number;
}>): SessionState {
  const sessionDateNy = sessionDateForUtc(args.candle.timeUtcMs, args.timezone, args.startTime);
  const sessionStart = buildSessionStart({
    sessionDateNy,
    startTime: args.startTime,
    timezone: args.timezone
  });
  const openingWindowEnd = sessionStart.plus({ minutes: args.openingRangeMinutes });
  const isSessionActive = args.candle.timeUtcMs >= sessionStart.toMillis();
  const openingRangeComplete = args.candle.timeUtcMs >= openingWindowEnd.toMillis();
  return {
    isSessionActive,
    sessionDateNy,
    openingRangeComplete,
    orHigh: null,
    orLow: null,
    orMid: null,
    sessionStartUtcMs: sessionStart.toMillis(),
    openingWindowEndUtcMs: openingWindowEnd.toMillis()
  };
}

/**
 * Calculates ATR (Wilder's smoothing) for a candle sequence.
 *
 * Inputs:
 * - Candle array ordered by time ascending.
 * - ATR lookback length.
 *
 * Outputs:
 * - Latest ATR value, or null when there is insufficient history.
 *
 * Edge cases:
 * - Requires at least `length + 1` candles to compute `length` true ranges.
 * - Returns null when inputs are invalid or insufficient.
 */
export function calculateATR(candles: readonly Candle[], length: number): number | null {
  if (!Number.isFinite(length) || length < 1) {
    throw new Error(`ATR length must be >= 1. Received: ${length}`);
  }
  let state = createAtrState();
  for (const candle of candles) {
    state = updateAtrState(state, candle, length);
  }
  return state.atr;
}

/**
 * Updates ATR state with the next candle using Wilder's smoothing.
 *
 * Inputs:
 * - Previous ATR state (may be uninitialized).
 * - Next candle OHLC.
 * - ATR lookback length.
 *
 * Outputs:
 * - New ATR state after incorporating the candle.
 *
 * Edge cases:
 * - The first candle only initializes prevClose; ATR stays null.
 * - ATR is null until `length` true ranges are observed.
 */
export function updateAtrState(state: AtrState, candle: Candle, length: number): AtrState {
  if (state.prevClose === null) {
    return {
      atr: null,
      prevAtr: null,
      trCount: 0,
      trSum: 0,
      prevClose: candle.close
    };
  }

  const tr = Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - state.prevClose),
    Math.abs(candle.low - state.prevClose)
  );
  const trCount = state.trCount + 1;

  if (state.atr === null) {
    const trSum = state.trSum + tr;
    if (trCount < length) {
      return {
        atr: null,
        prevAtr: null,
        trCount,
        trSum,
        prevClose: candle.close
      };
    }

    const initialAtr = trSum / length;
    return {
      atr: initialAtr,
      prevAtr: initialAtr,
      trCount,
      trSum,
      prevClose: candle.close
    };
  }

  const nextAtr = (state.atr * (length - 1) + tr) / length;
  return {
    atr: nextAtr,
    prevAtr: nextAtr,
    trCount,
    trSum: state.trSum,
    prevClose: candle.close
  };
}

/**
 * Calculates the initial stop-loss price for an entry.
 *
 * Inputs:
 * - Entry price, direction, ATR, and strategy parameters.
 * - Opening range levels are required when stopMode is OR-based.
 *
 * Outputs:
 * - Stop-loss price, or null when inputs are insufficient.
 *
 * Edge cases:
 * - Returns null if ATR is required but unavailable.
 * - Returns null if OR levels are required but missing.
 */
export function calculateStopLoss(args: StopLossArgs): number | null {
  const { entryPrice, direction, atr, params, openingRangeLevels } = args;
  if (params.risk.stopMode === "or_opposite") {
    if (openingRangeLevels === undefined || openingRangeLevels === null) {
      return null;
    }
    return direction === "long" ? openingRangeLevels.orLow : openingRangeLevels.orHigh;
  }
  if (params.risk.stopMode === "or_midpoint") {
    if (openingRangeLevels === undefined || openingRangeLevels === null) {
      return null;
    }
    return openingRangeLevels.orMid;
  }
  if (atr === null) {
    return null;
  }
  const stopOffset = params.risk.atrStopMultiple * atr;
  return direction === "long" ? entryPrice - stopOffset : entryPrice + stopOffset;
}

/**
 * Calculates take-profit price from entry and stop-loss.
 *
 * Inputs:
 * - Entry price, stop-loss price, direction, and strategy parameters.
 *
 * Outputs:
 * - Take-profit price, or null when take-profit is disabled.
 *
 * Edge cases:
 * - Returns null if takeProfitMode is "disabled".
 */
export function calculateTakeProfit(
  entryPrice: number,
  stopLoss: number,
  direction: StrategyDirection,
  params: StrategyParams
): number | null {
  if (params.risk.takeProfitMode !== "r_multiple") {
    return null;
  }
  const initialRiskPerUnit = Math.abs(entryPrice - stopLoss);
  const tpOffset = params.risk.tpRMultiple * initialRiskPerUnit;
  return direction === "long" ? entryPrice + tpOffset : entryPrice - tpOffset;
}

/**
 * Calculates the trailing stop price for a position on the current bar.
 *
 * Inputs:
 * - Current position, last price (close), ATR, and strategy parameters.
 *
 * Outputs:
 * - Updated trailing stop price, or null if trailing stop is disabled/unavailable.
 *
 * Edge cases:
 * - Returns null when ATR is unavailable.
 */
export function calculateTrailingStop(args: TrailingStopArgs): number | null {
  if (args.params.risk.trailingStopMode !== "atr_trailing") {
    return null;
  }
  if (args.atr === null) {
    return null;
  }
  const trailOffset = args.params.risk.atrTrailMultiple * args.atr;
  if (args.position.direction === "long") {
    const candidate = args.currentPrice - trailOffset;
    if (args.position.trailingStopPrice === null) {
      return candidate;
    }
    return Math.max(args.position.trailingStopPrice, candidate);
  }
  const candidate = args.currentPrice + trailOffset;
  if (args.position.trailingStopPrice === null) {
    return candidate;
  }
  return Math.min(args.position.trailingStopPrice, candidate);
}

/**
 * Checks for exit conditions given a position and the current candle.
 *
 * Inputs:
 * - Position state and current candle.
 * - Session state and strategy parameters (for time/session exits).
 * - Bars since entry (for bars-after-entry exits).
 *
 * Outputs:
 * - Exit signal with reason and raw price, or null if no exit is triggered.
 *
 * Edge cases:
 * - If SL and TP are touched in the same bar, SL is assumed first (conservative).
 */
export function checkExitConditions(args: ExitCheckArgs): ExitSignal | null {
  const effectiveStop = args.position.trailingStopPrice ?? args.position.stopPrice;
  const stopTouched =
    args.position.direction === "long"
      ? args.currentCandle.low <= effectiveStop
      : args.currentCandle.high >= effectiveStop;

  let tpTouched = false;
  if (args.position.takeProfitPrice !== null) {
    tpTouched =
      args.position.direction === "long"
        ? args.currentCandle.high >= args.position.takeProfitPrice
        : args.currentCandle.low <= args.position.takeProfitPrice;
  }

  const timeExitTouched =
    args.params.risk.timeExitMode === "bars_after_entry" &&
    args.params.risk.barsAfterEntry > 0 &&
    args.barsSinceEntry >= args.params.risk.barsAfterEntry;

  const sessionEndTouched =
    args.params.risk.timeExitMode === "session_end" &&
    args.currentCandle.timeUtcMs >=
      buildSessionEnd({
        sessionDateNy: args.sessionState.sessionDateNy,
        endTime: args.params.risk.sessionEndTime,
        timezone: args.params.session.timezone
      }).toMillis();

  if (stopTouched) {
    return { reason: "stop", exitRawPrice: effectiveStop };
  }
  if (tpTouched && args.position.takeProfitPrice !== null) {
    return { reason: "take_profit", exitRawPrice: args.position.takeProfitPrice };
  }
  if (sessionEndTouched) {
    return { reason: "session_end", exitRawPrice: args.currentCandle.close };
  }
  if (timeExitTouched) {
    return { reason: "time_exit", exitRawPrice: args.currentCandle.close };
  }
  return null;
}

/**
 * Generates entry/exit/stop-update signals for the current candle.
 *
 * Inputs:
 * - Current candle, previous candles (or full list + currentIndex).
 * - Session state, ATR, and strategy params.
 * - Current position state and per-session trade count.
 *
 * Outputs:
 * - Signal indicating an entry, exit, stop update, or hold.
 *
 * Edge cases:
 * - If both long and short triggers occur in the same bar, returns HOLD with a reason.
 * - If ATR or opening range is unavailable, returns HOLD.
 */
function signalForOpenPosition(args: GenerateSignalsWithPosition): Signal {
  const currentIndex = args.currentIndex ?? args.previousCandles.length;
  const trailingStopPrice = calculateTrailingStop({
    position: args.currentPosition,
    currentPrice: args.currentCandle.close,
    atr: args.atr,
    params: args.params
  });

  const updatedPosition: StrategyPosition = {
    ...args.currentPosition,
    trailingStopPrice: trailingStopPrice ?? args.currentPosition.trailingStopPrice
  };

  const barsSinceEntry = Math.max(0, currentIndex - updatedPosition.entryIndex);
  const exitSignal = checkExitConditions({
    position: updatedPosition,
    currentCandle: args.currentCandle,
    sessionState: args.sessionState,
    params: args.params,
    barsSinceEntry
  });

  if (exitSignal !== null) {
    return {
      type: "EXIT",
      direction: updatedPosition.direction,
      price: exitSignal.exitRawPrice,
      quantity: updatedPosition.quantity,
      reason: exitSignal.reason,
      trailingStopPrice: updatedPosition.trailingStopPrice
    };
  }

  if (trailingStopPrice !== null && trailingStopPrice !== args.currentPosition.trailingStopPrice) {
    return {
      type: "UPDATE_STOPS",
      direction: updatedPosition.direction,
      price: trailingStopPrice,
      quantity: updatedPosition.quantity,
      reason: "trailing_stop_update",
      trailingStopPrice
    };
  }

  return holdSignal({
    reason: null,
    direction: updatedPosition.direction,
    quantity: updatedPosition.quantity
  });
}

function signalForEntry(args: GenerateSignalsNoPosition): Signal {
  const precheck = entryPrecheck(args);
  if (precheck.blockedReason !== null) {
    return holdSignal({ reason: precheck.blockedReason });
  }

  const orHigh = args.sessionState.orHigh;
  const orLow = args.sessionState.orLow;
  if (orHigh === null || orLow === null) {
    return holdSignal({ reason: "OPENING_RANGE_UNAVAILABLE" });
  }

  const trigger = evaluateEntryTrigger({
    currentCandle: args.currentCandle,
    entryMode: args.params.entry.entryMode,
    directionMode: args.params.entry.directionMode,
    breakoutBufferBps: args.params.entry.breakoutBufferBps,
    orHigh,
    orLow
  });
  if (trigger === "ambiguous") {
    return holdSignal({ reason: "ENTRY_AMBIGUOUS_BOTH_DIRECTIONS" });
  }
  if (trigger === "long") {
    const entryRawPrice =
      args.params.entry.entryMode === "stop_breakout"
        ? orHigh * (1 + args.params.entry.breakoutBufferBps / 10_000)
        : args.currentCandle.close;
    return entrySignal({ direction: "long", price: entryRawPrice, reason: "LONG_TRIGGER" });
  }
  if (trigger === "short") {
    const entryRawPrice =
      args.params.entry.entryMode === "stop_breakout"
        ? orLow * (1 - args.params.entry.breakoutBufferBps / 10_000)
        : args.currentCandle.close;
    return entrySignal({ direction: "short", price: entryRawPrice, reason: "SHORT_TRIGGER" });
  }

  return holdSignal({ reason: null });
}

export function generateSignals(args: GenerateSignalsArgs): Signal {
  if (args.currentPosition !== null) {
    return signalForOpenPosition({ ...args, currentPosition: args.currentPosition });
  }
  return signalForEntry({ ...args, currentPosition: null });
}

function entryPrecheck(args: GenerateSignalsNoPosition): EntryPrecheckResult {
  if (!args.sessionEntryAllowed || !args.sessionState.openingRangeComplete) {
    return { blockedReason: "SESSION_NOT_READY" };
  }

  if (args.sessionState.orHigh === null || args.sessionState.orLow === null || args.sessionState.orMid === null) {
    return { blockedReason: "OPENING_RANGE_UNAVAILABLE" };
  }

  if (args.atr === null) {
    return { blockedReason: "ATR_UNAVAILABLE" };
  }

  if (args.tradesThisSession >= args.params.entry.maxTradesPerSession) {
    return { blockedReason: "MAX_TRADES_REACHED" };
  }

  if (args.params.atr.atrFilter.enabled) {
    const atrBps = (args.atr / args.currentCandle.close) * 10_000;
    if (atrBps < args.params.atr.atrFilter.minAtrBps || atrBps > args.params.atr.atrFilter.maxAtrBps) {
      return { blockedReason: "ATR_FILTER_BLOCK" };
    }
  }

  return { blockedReason: null };
}

function evaluateEntryTrigger(args: Readonly<{
  currentCandle: Candle;
  entryMode: StrategyParams["entry"]["entryMode"];
  directionMode: StrategyParams["entry"]["directionMode"];
  breakoutBufferBps: number;
  orHigh: number;
  orLow: number;
}>): EntryTrigger {
  const buffer = args.breakoutBufferBps / 10_000;
  const longTrigger = args.orHigh * (1 + buffer);
  const shortTrigger = args.orLow * (1 - buffer);

  const longAllowed = args.directionMode === "long_only" || args.directionMode === "long_short";
  const shortAllowed = args.directionMode === "short_only" || args.directionMode === "long_short";

  const longTriggered =
    longAllowed &&
    (args.entryMode === "stop_breakout"
      ? args.currentCandle.high >= longTrigger
      : args.currentCandle.close >= longTrigger);

  const shortTriggered =
    shortAllowed &&
    (args.entryMode === "stop_breakout"
      ? args.currentCandle.low <= shortTrigger
      : args.currentCandle.close <= shortTrigger);

  if (longTriggered && shortTriggered) {
    return "ambiguous";
  }
  if (longTriggered) {
    return "long";
  }
  if (shortTriggered) {
    return "short";
  }
  return "none";
}

export const OrbAtrInternals = {
  computeOpeningRangeLevels,
  createAtrState,
  sessionDateForUtc
};
