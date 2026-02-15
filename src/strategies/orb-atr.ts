import { z } from "zod";

import type { Candle, IStrategy, Position, Signal } from "./IStrategy";
import { ATRCalculator } from "./helpers/ATRCalculator";
import type { OpeningRangeLevels, SessionState } from "./helpers/SessionManager";
import { SessionManager, SessionInternals, buildSessionEnd } from "./helpers/SessionManager";

/**
 * ORB-ATR strategy parameter schema.
 */
const orbParamsSchema = z
  .object({
    version: z.literal("1.0"),
    intervalMinutes: z.number().int().min(1).optional(),
    session: z
      .object({
        timezone: z.literal("America/New_York"),
        startTime: z.literal("09:30"),
        openingRangeMinutes: z.number().int().min(1)
      })
      .strict(),
    entry: z
      .object({
        directionMode: z.union([z.literal("long_only"), z.literal("short_only"), z.literal("long_short")]),
        entryMode: z.union([z.literal("stop_breakout"), z.literal("close_confirm")]),
        breakoutBufferBps: z.number().min(0),
        maxTradesPerSession: z.number().int().min(1)
      })
      .strict(),
    atr: z
      .object({
        atrLength: z.number().int().min(1),
        atrFilter: z
          .object({
            enabled: z.boolean(),
            minAtrBps: z.number().int().min(0),
            maxAtrBps: z.number().int().min(0)
          })
          .strict()
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.atrFilter.minAtrBps > value.atrFilter.maxAtrBps) {
          ctx.addIssue({
            code: "custom",
            path: ["atrFilter", "minAtrBps"],
            message: "minAtrBps must be <= maxAtrBps"
          });
        }
      }),
    risk: z
      .object({
        sizingMode: z.union([z.literal("fixed_notional"), z.literal("fixed_risk_pct")]),
        riskPctPerTrade: z.number().min(0).max(100),
        fixedNotional: z.number().min(0).optional().default(0),
        stopMode: z.union([z.literal("or_opposite"), z.literal("or_midpoint"), z.literal("atr_multiple")]),
        atrStopMultiple: z.number().positive(),
        takeProfitMode: z.union([z.literal("disabled"), z.literal("r_multiple")]),
        tpRMultiple: z.number().positive(),
        trailingStopMode: z.union([z.literal("disabled"), z.literal("atr_trailing")]),
        atrTrailMultiple: z.number().positive(),
        timeExitMode: z.union([z.literal("disabled"), z.literal("bars_after_entry"), z.literal("session_end")]),
        barsAfterEntry: z.number().int().min(0),
        sessionEndTime: z.string().trim().regex(/^\d{2}:\d{2}$/, {
          message: "sessionEndTime must be in HH:mm format"
        })
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.sizingMode === "fixed_risk_pct" && (value.riskPctPerTrade <= 0 || value.riskPctPerTrade > 100)) {
          ctx.addIssue({
            code: "custom",
            path: ["riskPctPerTrade"],
            message: "riskPctPerTrade must be > 0 and <= 100 when sizingMode is fixed_risk_pct"
          });
        }
        if (value.sizingMode === "fixed_notional" && value.fixedNotional <= 0) {
          ctx.addIssue({
            code: "custom",
            path: ["fixedNotional"],
            message: "fixedNotional must be > 0 when sizingMode is fixed_notional"
          });
        }
      }),
    execution: z
      .object({
        feeBps: z.number().int().min(0),
        slippageBps: z.number().int().min(0)
      })
      .strict()
      .optional()
  })
  .strict();

type ORBParams = z.infer<typeof orbParamsSchema>;

type StrategyDirection = "long" | "short";

type EntryTrigger = "long" | "short" | "ambiguous" | "none";

type ExitReason = "stop" | "take_profit" | "time_exit" | "session_end";

/**
 * Validates a candle payload.
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
 * Validates a position payload.
 */
function validatePosition(position: Position): void {
  if (position.id.trim().length === 0) {
    throw new Error("Position id must be a non-empty string.");
  }
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) {
    throw new Error(`Position entryPrice must be > 0. Received: ${position.entryPrice}`);
  }
  if (!Number.isFinite(position.quantity) || position.quantity <= 0) {
    throw new Error(`Position quantity must be > 0. Received: ${position.quantity}`);
  }
  if (!Number.isFinite(position.stopLoss) || position.stopLoss <= 0) {
    throw new Error(`Position stopLoss must be > 0. Received: ${position.stopLoss}`);
  }
  if (!Number.isFinite(position.entryTime)) {
    throw new Error(`Position entryTime must be finite. Received: ${position.entryTime}`);
  }
}

/**
 * Builds a HOLD signal.
 */
function holdSignal(candle: Candle, reason: string): Signal {
  return {
    type: "HOLD",
    price: candle.close,
    reason
  };
}

/**
 * Builds an ENTRY signal.
 */
function entrySignal(args: Readonly<{ direction: StrategyDirection; price: number; stopLoss: number; takeProfit: number | null; reason: string }>): Signal {
  return {
    type: "ENTRY",
    side: args.direction,
    price: args.price,
    stopLoss: args.stopLoss,
    takeProfit: args.takeProfit ?? undefined,
    reason: args.reason
  };
}

/**
 * Builds an EXIT signal.
 */
function exitSignal(args: Readonly<{ candle: Candle; reason: ExitReason; price: number }>): Signal {
  return {
    type: "EXIT",
    price: args.price,
    reason: args.reason
  };
}

/**
 * Calculates stop loss based on configured stop mode.
 */
function calculateStopLoss(args: Readonly<{
  entryPrice: number;
  direction: StrategyDirection;
  atr: number | null;
  params: ORBParams;
  openingRangeLevels?: OpeningRangeLevels | null;
}>): number | null {
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
 * Calculates take profit based on R-multiple risk.
 */
function calculateTakeProfit(
  entryPrice: number,
  stopLoss: number,
  direction: StrategyDirection,
  params: ORBParams
): number | null {
  if (params.risk.takeProfitMode !== "r_multiple") {
    return null;
  }
  const initialRiskPerUnit = Math.abs(entryPrice - stopLoss);
  const tpOffset = params.risk.tpRMultiple * initialRiskPerUnit;
  return direction === "long" ? entryPrice + tpOffset : entryPrice - tpOffset;
}

/**
 * Calculates the trailing stop for the current bar.
 */
function calculateTrailingStop(args: Readonly<{
  direction: StrategyDirection;
  currentPrice: number;
  atr: number | null;
  params: ORBParams;
  previousTrailingStop: number | null;
}>): number | null {
  if (args.params.risk.trailingStopMode !== "atr_trailing") {
    return null;
  }
  if (args.atr === null) {
    return null;
  }
  const trailOffset = args.params.risk.atrTrailMultiple * args.atr;
  if (args.direction === "long") {
    const candidate = args.currentPrice - trailOffset;
    if (args.previousTrailingStop === null) {
      return candidate;
    }
    return Math.max(args.previousTrailingStop, candidate);
  }
  const candidate = args.currentPrice + trailOffset;
  if (args.previousTrailingStop === null) {
    return candidate;
  }
  return Math.min(args.previousTrailingStop, candidate);
}

/**
 * Evaluates entry trigger against opening range levels.
 */
function evaluateEntryTrigger(args: Readonly<{
  currentCandle: Candle;
  entryMode: ORBParams["entry"]["entryMode"];
  directionMode: ORBParams["entry"]["directionMode"];
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
    (args.entryMode === "stop_breakout" ? args.currentCandle.high >= longTrigger : args.currentCandle.close >= longTrigger);
  const shortTriggered =
    shortAllowed &&
    (args.entryMode === "stop_breakout" ? args.currentCandle.low <= shortTrigger : args.currentCandle.close <= shortTrigger);

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

/**
 * ORB + ATR strategy implementation.
 */
export class ORBATRStrategy implements IStrategy {
  public name = "ORB + ATR";
  public warmupPeriod: number;

  private readonly params: ORBParams;
  private readonly sessionManager: SessionManager;
  private readonly atrCalculator: ATRCalculator;
  private openingRangeLevels: OpeningRangeLevels | null;
  private trailingStops: Map<string, number | null>;
  private lastSignal: Signal | null;
  private lastAtr: number | null;

  /**
   * Creates a new ORB + ATR strategy instance.
   *
   * Inputs:
   * - Strategy parameters.
   *
   * Error behavior:
   * - Throws if parameters are invalid.
   */
  public constructor(params: Record<string, unknown>) {
    const parsed = orbParamsSchema.parse(params);

    this.params = parsed;
    this.warmupPeriod = parsed.atr.atrLength + 1;
    this.sessionManager = new SessionManager({
      timezone: parsed.session.timezone,
      startTime: parsed.session.startTime,
      openingRangeMinutes: parsed.session.openingRangeMinutes,
      intervalMinutes: parsed.intervalMinutes
    });
    this.atrCalculator = new ATRCalculator(parsed.atr.atrLength);
    this.openingRangeLevels = null;
    this.trailingStops = new Map();
    this.lastSignal = null;
    this.lastAtr = null;
  }

  /**
   * Initializes ATR and session state from historical candles.
   */
  public initialize(candles: Candle[]): void {
    // Validate input sequence.
    for (const candle of candles) {
      validateCandle(candle);
    }

    // Warm up ATR with history.
    this.atrCalculator.initialize(candles);

    // Build opening range for the last session.
    this.openingRangeLevels = this.sessionManager.initialize(candles);

    // Reset trailing stop tracking on initialization.
    this.trailingStops = new Map();
  }

  /**
   * Processes a new candle and returns the latest signal.
   */
  public onCandle(candle: Candle, position: Position | null): Signal {
    validateCandle(candle);

    // Update ATR and session state for this candle.
    const atr = this.atrCalculator.update(candle);
    this.lastAtr = atr;
    const sessionState = this.sessionManager.update(candle);

    if (!sessionState.active) {
      const signal = holdSignal(candle, "Outside trading session");
      this.lastSignal = signal;
      return signal;
    }

    if (sessionState.orPhase === "building") {
      const signal = holdSignal(candle, "Building opening range");
      this.lastSignal = signal;
      return signal;
    }

    if (!sessionState.orComplete) {
      const signal = holdSignal(candle, "Opening range not complete");
      this.lastSignal = signal;
      return signal;
    }

    this.openingRangeLevels = sessionState.orLevels;

    if (position === null) {
      const signal = this.checkEntry(candle, atr, sessionState);
      this.lastSignal = signal;
      return signal;
    }

    const signal = this.checkExit(candle, position, atr, sessionState);
    this.lastSignal = signal;
    return signal;
  }

  /**
   * Records fill events to enforce per-session trade limits.
   */
  public onFill(position: Position): void {
    validatePosition(position);
    this.sessionManager.recordTrade();
    this.trailingStops.set(position.id, null);
  }

  /**
   * Returns the current strategy state snapshot.
   */
  public getState(): Record<string, unknown> {
    return {
      atr: this.lastAtr,
      openingRange: this.openingRangeLevels,
      session: this.sessionManager.getCurrentSession(),
      lastSignal: this.lastSignal
    };
  }

  /**
   * Evaluates entry conditions for a flat position.
   */
  private checkEntry(candle: Candle, atr: number | null, sessionState: SessionState): Signal {
    // Block entries outside valid session conditions.
    if (!this.sessionManager.getSessionEntryAllowed() || !sessionState.orComplete) {
      return holdSignal(candle, "SESSION_NOT_READY");
    }

    const orLevels = sessionState.orLevels;
    if (orLevels === null) {
      return holdSignal(candle, "OPENING_RANGE_UNAVAILABLE");
    }

    if (atr === null) {
      return holdSignal(candle, "ATR_UNAVAILABLE");
    }

    if (this.sessionManager.getTradesThisSession() >= this.params.entry.maxTradesPerSession) {
      return holdSignal(candle, "MAX_TRADES_REACHED");
    }

    if (this.params.atr.atrFilter.enabled) {
      const atrBps = (atr / candle.close) * 10_000;
      if (atrBps < this.params.atr.atrFilter.minAtrBps || atrBps > this.params.atr.atrFilter.maxAtrBps) {
        return holdSignal(candle, "ATR_FILTER_BLOCK");
      }
    }

    const trigger = evaluateEntryTrigger({
      currentCandle: candle,
      entryMode: this.params.entry.entryMode,
      directionMode: this.params.entry.directionMode,
      breakoutBufferBps: this.params.entry.breakoutBufferBps,
      orHigh: orLevels.orHigh,
      orLow: orLevels.orLow
    });

    if (trigger === "ambiguous") {
      return holdSignal(candle, "ENTRY_AMBIGUOUS_BOTH_DIRECTIONS");
    }

    if (trigger === "none") {
      return holdSignal(candle, "Waiting for breakout");
    }

    const entryPrice =
      this.params.entry.entryMode === "stop_breakout"
        ? trigger === "long"
          ? orLevels.orHigh * (1 + this.params.entry.breakoutBufferBps / 10_000)
          : orLevels.orLow * (1 - this.params.entry.breakoutBufferBps / 10_000)
        : candle.close;

    const stopLoss = calculateStopLoss({
      entryPrice,
      direction: trigger,
      atr,
      params: this.params,
      openingRangeLevels: orLevels
    });

    if (stopLoss === null) {
      return holdSignal(candle, "STOP_UNAVAILABLE");
    }

    const takeProfit = calculateTakeProfit(entryPrice, stopLoss, trigger, this.params);
    return entrySignal({
      direction: trigger,
      price: entryPrice,
      stopLoss,
      takeProfit,
      reason: trigger === "long" ? "LONG_TRIGGER" : "SHORT_TRIGGER"
    });
  }

  /**
   * Evaluates exit conditions for an open position.
   */
  private checkExit(candle: Candle, position: Position, atr: number | null, sessionState: SessionState): Signal {
    validatePosition(position);

    const previousTrailingStop = this.trailingStops.get(position.id) ?? null;
    const nextTrailingStop = calculateTrailingStop({
      direction: position.side,
      currentPrice: candle.close,
      atr,
      params: this.params,
      previousTrailingStop
    });

    if (nextTrailingStop !== null) {
      this.trailingStops.set(position.id, nextTrailingStop);
    }

    const effectiveStop = nextTrailingStop ?? position.stopLoss;
    const stopTouched =
      position.side === "long" ? candle.low <= effectiveStop : candle.high >= effectiveStop;

    let tpTouched = false;
    if (position.takeProfit !== undefined) {
      tpTouched = position.side === "long" ? candle.high >= position.takeProfit : candle.low <= position.takeProfit;
    }

    const intervalMinutes = this.sessionManager.getIntervalMinutes();
    const barsSinceEntry =
      intervalMinutes === null
        ? 0
        : Math.max(0, Math.floor((candle.timestamp - position.entryTime) / (intervalMinutes * 60000)));

    const timeExitTouched =
      this.params.risk.timeExitMode === "bars_after_entry" &&
      this.params.risk.barsAfterEntry > 0 &&
      barsSinceEntry >= this.params.risk.barsAfterEntry;

    const sessionEndTouched =
      this.params.risk.timeExitMode === "session_end" &&
      candle.timestamp >=
        buildSessionEnd({
          sessionDateNy: sessionState.sessionDateNy,
          endTime: this.params.risk.sessionEndTime,
          timezone: this.params.session.timezone
        }).toMillis();

    if (stopTouched) {
      return exitSignal({ candle, reason: "stop", price: effectiveStop });
    }

    if (tpTouched && position.takeProfit !== undefined) {
      return exitSignal({ candle, reason: "take_profit", price: position.takeProfit });
    }

    if (sessionEndTouched) {
      return exitSignal({ candle, reason: "session_end", price: candle.close });
    }

    if (timeExitTouched) {
      return exitSignal({ candle, reason: "time_exit", price: candle.close });
    }

    return holdSignal(candle, "In position, no exit signal");
  }
}

export const OrbAtrInternals = {
  evaluateEntryTrigger,
  calculateStopLoss,
  calculateTakeProfit,
  calculateTrailingStop,
  sessionDateForUtc: SessionInternals.sessionDateForUtc
};
