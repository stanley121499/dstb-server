import type { Candle } from "../../data/yahooFinance.js";

import {
  detectSession,
  OrbAtrInternals,
  updateAtrState
} from "./orbAtrStrategy.js";
import type {
  OpeningRangeLevels,
  OpeningRangeStatus,
  SessionState,
  Signal,
  StrategyState
} from "./types.js";

type StrategyStateManagerOptions = Readonly<{
  timezone: string;
  startTime: string;
  openingRangeMinutes: number;
  atrLength: number;
  intervalMinutes: number;
}>;

type UpdateOptions = Readonly<{
  shouldUpdateAtr?: boolean;
}>;

/**
 * Manages stateful strategy context across candles (sessions, OR levels, ATR buffer).
 */
export class StrategyStateManager {
  private readonly timezone: string;
  private readonly startTime: string;
  private readonly openingRangeMinutes: number;
  private readonly atrLength: number;
  private readonly intervalMinutes: number;

  private sessionState: SessionState;
  private openingRangeStatus: OpeningRangeStatus;
  private openingRangeLevels: OpeningRangeLevels | null;
  private openingCandles: Candle[];
  private tradesThisSession: number;
  private atrState: ReturnType<typeof OrbAtrInternals.createAtrState>;
  private atrBuffer: Candle[];
  private sessionEntryAllowed: boolean;
  private lastSignal: Signal | null;
  private currentSessionDateNy: string | null;

  /**
   * Creates a new state manager for the ORB + ATR strategy.
   *
   * Inputs:
   * - Session timezone/start time and opening range duration.
   * - ATR length and interval minutes for opening range validation.
   *
   * Error behavior:
   * - Throws if supplied parameters are invalid.
   */
  public constructor(options: StrategyStateManagerOptions) {
    if (!Number.isFinite(options.openingRangeMinutes) || options.openingRangeMinutes < 1) {
      throw new Error(`openingRangeMinutes must be >= 1. Received: ${options.openingRangeMinutes}`);
    }
    if (!Number.isFinite(options.atrLength) || options.atrLength < 1) {
      throw new Error(`atrLength must be >= 1. Received: ${options.atrLength}`);
    }
    if (!Number.isFinite(options.intervalMinutes) || options.intervalMinutes <= 0) {
      throw new Error(`intervalMinutes must be > 0. Received: ${options.intervalMinutes}`);
    }
    if (options.timezone.trim().length === 0) {
      throw new Error("timezone must be a non-empty string.");
    }
    if (!/^\d{2}:\d{2}$/.test(options.startTime)) {
      throw new Error(`startTime must be HH:mm. Received: "${options.startTime}"`);
    }

    this.timezone = options.timezone;
    this.startTime = options.startTime;
    this.openingRangeMinutes = options.openingRangeMinutes;
    this.atrLength = options.atrLength;
    this.intervalMinutes = options.intervalMinutes;

    this.sessionState = {
      isSessionActive: false,
      sessionDateNy: "",
      openingRangeComplete: false,
      orHigh: null,
      orLow: null,
      orMid: null,
      sessionStartUtcMs: 0,
      openingWindowEndUtcMs: 0
    };
    this.openingRangeStatus = "pending";
    this.openingRangeLevels = null;
    this.openingCandles = [];
    this.tradesThisSession = 0;
    this.atrState = OrbAtrInternals.createAtrState();
    this.atrBuffer = [];
    this.sessionEntryAllowed = true;
    this.lastSignal = null;
    this.currentSessionDateNy = null;
  }

  private resetForSession(sessionDateNy: string): void {
    this.currentSessionDateNy = sessionDateNy;
    this.tradesThisSession = 0;
    this.openingCandles = [];
    this.openingRangeLevels = null;
    this.openingRangeStatus = "pending";
    this.sessionEntryAllowed = true;
  }

  private updateOpeningRange(candle: Candle, session: SessionState): void {
    const candleUtcMs = candle.timeUtcMs;
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

    const expectedCount = Math.max(1, Math.ceil(this.openingRangeMinutes / this.intervalMinutes));
    if (this.openingCandles.length < expectedCount) {
      this.openingRangeStatus = "missing";
      this.sessionEntryAllowed = false;
      return;
    }

    const levels = OrbAtrInternals.computeOpeningRangeLevels(this.openingCandles);
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

  private updateAtrBuffer(candle: Candle): void {
    this.atrBuffer.push(candle);
    const maxBuffer = Math.max(1, this.atrLength + 1);
    if (this.atrBuffer.length > maxBuffer) {
      this.atrBuffer = this.atrBuffer.slice(this.atrBuffer.length - maxBuffer);
    }
  }

  /**
   * Resets all per-session and per-run state.
   *
   * Edge cases:
   * - Clears ATR state, opening range data, and session tracking.
   */
  public reset(): void {
    this.sessionState = {
      isSessionActive: false,
      sessionDateNy: "",
      openingRangeComplete: false,
      orHigh: null,
      orLow: null,
      orMid: null,
      sessionStartUtcMs: 0,
      openingWindowEndUtcMs: 0
    };
    this.openingRangeStatus = "pending";
    this.openingRangeLevels = null;
    this.openingCandles = [];
    this.tradesThisSession = 0;
    this.atrState = OrbAtrInternals.createAtrState();
    this.atrBuffer = [];
    this.sessionEntryAllowed = true;
    this.lastSignal = null;
    this.currentSessionDateNy = null;
  }

  /**
   * Updates state with the next candle.
   *
   * Inputs:
   * - Candle (UTC OHLC) and optional update flags.
   *
   * Outputs:
   * - Updates internal session, OR, and ATR state; call `getState()` to read.
   *
   * Edge cases:
   * - Session boundary changes reset session-specific counters.
   */
  public update(candle: Candle, options: UpdateOptions = {}): void {
    if (!Number.isFinite(candle.timeUtcMs)) {
      throw new TypeError(`Candle timeUtcMs must be finite. Received: ${candle.timeUtcMs}`);
    }
    if (
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      throw new TypeError("Candle OHLC must be finite numbers.");
    }

    const nextSession = detectSession({
      candle,
      timezone: this.timezone,
      startTime: this.startTime,
      openingRangeMinutes: this.openingRangeMinutes
    });

    if (this.currentSessionDateNy !== nextSession.sessionDateNy) {
      this.resetForSession(nextSession.sessionDateNy);
    }

    this.updateOpeningRange(candle, nextSession);

    if (options.shouldUpdateAtr !== false) {
      this.atrState = updateAtrState(this.atrState, candle, this.atrLength);
    }

    this.updateAtrBuffer(candle);

    const sessionState: SessionState = {
      ...nextSession,
      orHigh: this.openingRangeLevels === null ? null : this.openingRangeLevels.orHigh,
      orLow: this.openingRangeLevels === null ? null : this.openingRangeLevels.orLow,
      orMid: this.openingRangeLevels === null ? null : this.openingRangeLevels.orMid
    };

    this.sessionState = sessionState;
  }

  /**
   * Records that a trade has been opened in the current session.
   */
  public recordTrade(): void {
    this.tradesThisSession += 1;
  }

  /**
   * Stores the most recent signal for debugging/telemetry.
   */
  public recordSignal(signal: Signal): void {
    this.lastSignal = signal;
  }

  /**
   * Returns a snapshot of the current strategy state.
   */
  public getState(): StrategyState {
    return {
      sessionState: this.sessionState,
      openingRangeStatus: this.openingRangeStatus,
      openingRangeLevels: this.openingRangeLevels,
      openingRangeCandleCount: this.openingCandles.length,
      tradesThisSession: this.tradesThisSession,
      atr: this.atrState.atr,
      atrBuffer: [...this.atrBuffer],
      sessionEntryAllowed: this.sessionEntryAllowed,
      lastSignal: this.lastSignal
    };
  }
}
