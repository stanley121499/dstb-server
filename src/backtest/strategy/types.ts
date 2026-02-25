import type { Candle } from "../../data/yahooFinance.js";

/**
 * Trade direction for ORB strategy decisions.
 */
export type StrategyDirection = "long" | "short";

/**
 * Signal types emitted by the strategy evaluation step.
 */
export type SignalType = "ENTRY_LONG" | "ENTRY_SHORT" | "EXIT" | "UPDATE_STOPS" | "HOLD";

/**
 * Reasons an exit can be triggered by the strategy logic.
 */
export type ExitReason = "stop" | "take_profit" | "time_exit" | "session_end" | "end_of_data";

/**
 * Opening range levels for a single session day.
 */
export type OpeningRangeLevels = Readonly<{
  orHigh: number;
  orLow: number;
  orMid: number;
}>;

/**
 * Session state derived from candle timestamps and opening range capture.
 */
export type SessionState = Readonly<{
  isSessionActive: boolean;
  sessionDateNy: string;
  openingRangeComplete: boolean;
  orHigh: number | null;
  orLow: number | null;
  orMid: number | null;
  sessionStartUtcMs: number;
  openingWindowEndUtcMs: number;
}>;

/**
 * Strategy exit signal with reason and raw price.
 */
export type ExitSignal = Readonly<{
  reason: ExitReason;
  exitRawPrice: number;
}>;

/**
 * Strategy signal emitted for entries, exits, and stop updates.
 */
export type Signal = Readonly<{
  type: SignalType;
  direction: StrategyDirection | null;
  price: number | null;
  quantity: number | null;
  reason: string | null;
  trailingStopPrice: number | null;
}>;

/**
 * Position state required by strategy logic.
 */
export type StrategyPosition = Readonly<{
  direction: StrategyDirection;
  entryIndex: number;
  entryTimeUtcMs: number;
  entryPrice: number;
  quantity: number;
  stopPrice: number;
  takeProfitPrice: number | null;
  trailingStopPrice: number | null;
  initialRiskPerUnit: number;
  sessionDateNy: string;
}>;

/**
 * High-level session quality status for opening range handling.
 */
export type OpeningRangeStatus = "pending" | "ready" | "missing" | "flat";

/**
 * Aggregate strategy state for orchestration and logging.
 */
export type StrategyState = Readonly<{
  sessionState: SessionState;
  openingRangeStatus: OpeningRangeStatus;
  openingRangeLevels: OpeningRangeLevels | null;
  openingRangeCandleCount: number;
  tradesThisSession: number;
  atr: number | null;
  atrBuffer: readonly Candle[];
  sessionEntryAllowed: boolean;
  lastSignal: Signal | null;
}>;
