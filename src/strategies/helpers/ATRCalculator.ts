import type { Candle } from "../IStrategy";

/**
 * Internal ATR state tracking for Wilder's smoothing.
 */
export type AtrState = Readonly<{
  atr: number | null;
  prevAtr: number | null;
  trCount: number;
  trSum: number;
  prevClose: number | null;
}>;

/**
 * Builds a fresh ATR state.
 */
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
 * Validates a candle for ATR calculations.
 *
 * Inputs:
 * - Candle with OHLC values.
 *
 * Error behavior:
 * - Throws if any required field is invalid.
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
 * Calculates the next ATR state using Wilder's smoothing.
 *
 * Inputs:
 * - Previous ATR state, next candle, and ATR length.
 *
 * Outputs:
 * - Updated ATR state after incorporating the candle.
 *
 * Edge cases:
 * - First candle only sets prevClose; ATR remains null.
 */
function updateAtrState(state: AtrState, candle: Candle, length: number): AtrState {
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
 * ATR calculator using Wilder's smoothing.
 */
export class ATRCalculator {
  private readonly length: number;
  private state: AtrState;

  /**
   * Creates a new ATR calculator.
   *
   * Inputs:
   * - ATR length (lookback).
   *
   * Error behavior:
   * - Throws if length is invalid.
   */
  public constructor(length: number) {
    if (!Number.isFinite(length) || length < 1) {
      throw new Error(`ATR length must be >= 1. Received: ${length}`);
    }
    this.length = length;
    this.state = createAtrState();
  }

  /**
   * Resets the ATR state to uninitialized.
   */
  public reset(): void {
    this.state = createAtrState();
  }

  /**
   * Warms up ATR state from historical candles.
   *
   * Inputs:
   * - Candles ordered by time ascending.
   */
  public initialize(candles: Candle[]): void {
    // Reset state before warming up.
    this.reset();

    // Feed candles sequentially to build ATR.
    for (const candle of candles) {
      validateCandle(candle);
      this.state = updateAtrState(this.state, candle, this.length);
    }
  }

  /**
   * Updates ATR with the latest candle.
   *
   * Inputs:
   * - Latest candle.
   *
   * Outputs:
   * - Latest ATR value or null if insufficient history.
   */
  public update(candle: Candle): number | null {
    validateCandle(candle);
    this.state = updateAtrState(this.state, candle, this.length);
    return this.state.atr;
  }

  /**
   * Returns the current ATR value.
   */
  public getValue(): number | null {
    return this.state.atr;
  }

  /**
   * Returns a serializable snapshot of ATR state.
   */
  public getState(): AtrState {
    return { ...this.state };
  }
}

export const AtrInternals = {
  createAtrState,
  updateAtrState
};
