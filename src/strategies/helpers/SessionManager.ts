import { DateTime } from "luxon";

import type { Candle } from "../IStrategy";

/**
 * Opening range levels for a single session.
 */
export type OpeningRangeLevels = Readonly<{
  orHigh: number;
  orLow: number;
  orMid: number;
}>;

/**
 * Opening range readiness status.
 */
export type OpeningRangeStatus = "pending" | "ready" | "missing" | "flat";

/**
 * Session state snapshot for the current candle.
 */
export type SessionState = Readonly<{
  active: boolean;
  sessionDateNy: string;
  orComplete: boolean;
  orPhase: "building" | "complete" | "outside";
  orLevels: OpeningRangeLevels | null;
  sessionStartUtcMs: number;
  openingWindowEndUtcMs: number;
}>;

type SessionManagerOptions = Readonly<{
  timezone: string;
  startTime: string;
  openingRangeMinutes: number;
  intervalMinutes?: number;
}>;

/**
 * Validates a candle for session calculations.
 */
function validateCandle(candle: Candle): void {
  if (!Number.isFinite(candle.timestamp)) {
    throw new TypeError(`Candle timestamp must be finite. Received: ${candle.timestamp}`);
  }
  if (
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close)
  ) {
    throw new TypeError("Candle OHLC values must be finite numbers.");
  }
}

/**
 * Converts a UTC timestamp to local time in the specified timezone.
 */
function timeToLocal(timeUtcMs: number, timezone: string): DateTime {
  return DateTime.fromMillis(timeUtcMs, { zone: "utc" }).setZone(timezone);
}

/**
 * Parses a HH:mm string into hour/minute values.
 */
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

/**
 * Determines the NY session date for a UTC timestamp.
 *
 * Inputs:
 * - UTC timestamp, timezone, and session start time.
 *
 * Outputs:
 * - Session date in YYYY-MM-DD format anchored to NY local date.
 */
function sessionDateForUtc(timeUtcMs: number, timezone: string, startTime: string): string {
  const local = timeToLocal(timeUtcMs, timezone);
  const { hours, minutes } = parseHhMm(startTime);
  const sessionStartMinutes = hours * 60 + minutes;
  const localMinutes = local.hour * 60 + local.minute;
  const isBeforeSessionOpen = localMinutes < sessionStartMinutes;
  const sessionLocal = isBeforeSessionOpen ? local.minus({ days: 1 }) : local;
  return sessionLocal.toISODate() ?? sessionLocal.toFormat("yyyy-LL-dd");
}

/**
 * Builds a session start DateTime in the given timezone.
 */
function buildSessionStart(args: Readonly<{ sessionDateNy: string; startTime: string; timezone: string }>): DateTime {
  return DateTime.fromISO(`${args.sessionDateNy}T${args.startTime}:00`, { zone: args.timezone });
}

/**
 * Builds a session end DateTime in the given timezone.
 */
export function buildSessionEnd(args: Readonly<{ sessionDateNy: string; endTime: string; timezone: string }>): DateTime {
  return DateTime.fromISO(`${args.sessionDateNy}T${args.endTime}:00`, { zone: args.timezone });
}

/**
 * Computes opening range levels from the opening window candles.
 */
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

  return {
    orHigh,
    orLow,
    orMid: (orHigh + orLow) / 2
  };
}

/**
 * Infers interval minutes from a sequence of candles.
 */
function inferIntervalMinutes(candles: readonly Candle[]): number | null {
  if (candles.length < 2) {
    return null;
  }

  const deltas: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const next = candles[i];
    if (prev === undefined || next === undefined) {
      continue;
    }
    const deltaMs = next.timestamp - prev.timestamp;
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      deltas.push(deltaMs);
    }
  }

  if (deltas.length === 0) {
    return null;
  }

  deltas.sort((a, b) => a - b);
  const medianMs = deltas[Math.floor(deltas.length / 2)];
  if (!Number.isFinite(medianMs) || medianMs <= 0) {
    return null;
  }
  return Math.max(1, Math.round(medianMs / 60000));
}

/**
 * Manages session tracking, opening range capture, and per-session trade limits.
 */
export class SessionManager {
  private readonly timezone: string;
  private readonly startTime: string;
  private readonly openingRangeMinutes: number;
  private intervalMinutes: number | null;
  private openingCandles: Candle[];
  private openingRangeLevels: OpeningRangeLevels | null;
  private openingRangeStatus: OpeningRangeStatus;
  private sessionEntryAllowed: boolean;
  private tradesThisSession: number;
  private currentSessionDateNy: string | null;
  private lastSessionState: SessionState;
  private lastCandleTimestamp: number | null;

  /**
   * Creates a new session manager.
   *
   * Inputs:
   * - Timezone, session start time, and opening range duration.
   *
   * Error behavior:
   * - Throws if configuration values are invalid.
   */
  public constructor(options: SessionManagerOptions) {
    if (options.timezone.trim().length === 0) {
      throw new Error("timezone must be a non-empty string.");
    }
    if (!/^\d{2}:\d{2}$/.test(options.startTime)) {
      throw new Error(`startTime must be HH:mm. Received: "${options.startTime}"`);
    }
    if (!Number.isFinite(options.openingRangeMinutes) || options.openingRangeMinutes < 1) {
      throw new Error(`openingRangeMinutes must be >= 1. Received: ${options.openingRangeMinutes}`);
    }
    if (options.intervalMinutes !== undefined && (!Number.isFinite(options.intervalMinutes) || options.intervalMinutes <= 0)) {
      throw new Error(`intervalMinutes must be > 0. Received: ${options.intervalMinutes}`);
    }

    this.timezone = options.timezone;
    this.startTime = options.startTime;
    this.openingRangeMinutes = options.openingRangeMinutes;
    this.intervalMinutes = options.intervalMinutes ?? null;
    this.openingCandles = [];
    this.openingRangeLevels = null;
    this.openingRangeStatus = "pending";
    this.sessionEntryAllowed = true;
    this.tradesThisSession = 0;
    this.currentSessionDateNy = null;
    this.lastCandleTimestamp = null;
    this.lastSessionState = {
      active: false,
      sessionDateNy: "",
      orComplete: false,
      orPhase: "outside",
      orLevels: null,
      sessionStartUtcMs: 0,
      openingWindowEndUtcMs: 0
    };
  }

  /**
   * Resets per-session state when a new session starts.
   */
  private resetForSession(sessionDateNy: string): void {
    this.currentSessionDateNy = sessionDateNy;
    this.tradesThisSession = 0;
    this.openingCandles = [];
    this.openingRangeLevels = null;
    this.openingRangeStatus = "pending";
    this.sessionEntryAllowed = true;
  }

  /**
   * Updates interval minutes using the latest candle timestamps.
   */
  private updateIntervalMinutes(candle: Candle): void {
    if (this.intervalMinutes !== null) {
      return;
    }
    if (this.lastCandleTimestamp === null) {
      this.lastCandleTimestamp = candle.timestamp;
      return;
    }
    const deltaMs = candle.timestamp - this.lastCandleTimestamp;
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      this.intervalMinutes = Math.max(1, Math.round(deltaMs / 60000));
    }
    this.lastCandleTimestamp = candle.timestamp;
  }

  /**
   * Updates opening range state based on the latest candle.
   */
  private updateOpeningRange(candle: Candle, session: SessionState): void {
    const candleUtcMs = candle.timestamp;
    const inOpeningWindow = candleUtcMs >= session.sessionStartUtcMs && candleUtcMs < session.openingWindowEndUtcMs;
    if (inOpeningWindow) {
      this.openingCandles.push(candle);
      return;
    }

    if (this.openingRangeLevels !== null) {
      return;
    }

    if (candleUtcMs < session.openingWindowEndUtcMs) {
      return;
    }

    const inferredInterval = this.intervalMinutes ?? inferIntervalMinutes(this.openingCandles);
    const expectedCount =
      inferredInterval === null ? this.openingCandles.length : Math.max(1, Math.ceil(this.openingRangeMinutes / inferredInterval));
    if (this.openingCandles.length < expectedCount) {
      this.openingRangeStatus = "missing";
      this.sessionEntryAllowed = false;
      return;
    }

    const levels = computeOpeningRangeLevels(this.openingCandles);
    if (levels === null) {
      this.openingRangeStatus = "missing";
      this.sessionEntryAllowed = false;
      return;
    }

    if (levels.orHigh === levels.orLow) {
      this.openingRangeStatus = "flat";
      this.sessionEntryAllowed = false;
      this.openingRangeLevels = levels;
      return;
    }

    this.openingRangeStatus = "ready";
    this.openingRangeLevels = levels;
    this.sessionEntryAllowed = true;
  }

  /**
   * Detects session boundaries for a candle.
   */
  private detectSession(candle: Candle): SessionState {
    const sessionDateNy = sessionDateForUtc(candle.timestamp, this.timezone, this.startTime);
    const sessionStart = buildSessionStart({
      sessionDateNy,
      startTime: this.startTime,
      timezone: this.timezone
    });
    const openingWindowEnd = sessionStart.plus({ minutes: this.openingRangeMinutes });
    const isSessionActive = candle.timestamp >= sessionStart.toMillis();
    const openingRangeComplete = candle.timestamp >= openingWindowEnd.toMillis();

    return {
      active: isSessionActive,
      sessionDateNy,
      orComplete: openingRangeComplete,
      orPhase: openingRangeComplete ? "complete" : "building",
      orLevels: null,
      sessionStartUtcMs: sessionStart.toMillis(),
      openingWindowEndUtcMs: openingWindowEnd.toMillis()
    };
  }

  /**
   * Initializes session state from historical candles.
   *
   * Inputs:
   * - Historical candles ordered by time ascending.
   *
   * Outputs:
   * - Latest opening range levels for the most recent session.
   */
  public initialize(candles: Candle[]): OpeningRangeLevels | null {
    // Reset per-run state.
    this.reset();

    // Infer interval minutes from history if needed.
    if (this.intervalMinutes === null) {
      const inferred = inferIntervalMinutes(candles);
      if (inferred !== null) {
        this.intervalMinutes = inferred;
      }
    }

    // Process candles in order to compute the last opening range.
    for (const candle of candles) {
      this.update(candle);
    }

    return this.openingRangeLevels;
  }

  /**
   * Resets all state (used during reinitialization).
   */
  public reset(): void {
    this.openingCandles = [];
    this.openingRangeLevels = null;
    this.openingRangeStatus = "pending";
    this.sessionEntryAllowed = true;
    this.tradesThisSession = 0;
    this.currentSessionDateNy = null;
    this.lastCandleTimestamp = null;
    this.lastSessionState = {
      active: false,
      sessionDateNy: "",
      orComplete: false,
      orPhase: "outside",
      orLevels: null,
      sessionStartUtcMs: 0,
      openingWindowEndUtcMs: 0
    };
  }

  /**
   * Updates session state with the latest candle.
   *
   * Inputs:
   * - Latest candle.
   *
   * Outputs:
   * - Updated session state for the candle.
   */
  public update(candle: Candle): SessionState {
    validateCandle(candle);
    this.updateIntervalMinutes(candle);

    const nextSession = this.detectSession(candle);
    if (this.currentSessionDateNy !== nextSession.sessionDateNy) {
      this.resetForSession(nextSession.sessionDateNy);
    }

    this.updateOpeningRange(candle, nextSession);

    const orLevels = this.openingRangeLevels;
    const sessionState: SessionState = {
      ...nextSession,
      orLevels
    };

    this.lastSessionState = sessionState;
    return sessionState;
  }

  /**
   * Records that a trade opened during the current session.
   */
  public recordTrade(): void {
    this.tradesThisSession += 1;
  }

  /**
   * Returns the current session state snapshot.
   */
  public getSessionState(): SessionState {
    return this.lastSessionState;
  }

  /**
   * Returns the current session metadata for logging.
   */
  public getCurrentSession(): Record<string, unknown> {
    return {
      sessionDateNy: this.currentSessionDateNy,
      openingRangeStatus: this.openingRangeStatus,
      openingRangeLevels: this.openingRangeLevels,
      tradesThisSession: this.tradesThisSession,
      sessionEntryAllowed: this.sessionEntryAllowed,
      intervalMinutes: this.intervalMinutes
    };
  }

  /**
   * Returns the last computed opening range levels.
   */
  public getOpeningRangeLevels(): OpeningRangeLevels | null {
    return this.openingRangeLevels;
  }

  /**
   * Returns the number of trades taken in the current session.
   */
  public getTradesThisSession(): number {
    return this.tradesThisSession;
  }

  /**
   * Returns whether new session entries are allowed.
   */
  public getSessionEntryAllowed(): boolean {
    return this.sessionEntryAllowed;
  }

  /**
   * Returns the interval minutes used for bar-based exits.
   */
  public getIntervalMinutes(): number | null {
    return this.intervalMinutes;
  }
}

export const SessionInternals = {
  parseHhMm,
  sessionDateForUtc,
  computeOpeningRangeLevels,
  inferIntervalMinutes
};
