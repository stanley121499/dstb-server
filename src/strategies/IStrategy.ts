/**
 * Candle data shape used by strategy plugins.
 *
 * Inputs:
 * - Timestamp in milliseconds (UTC).
 * - OHLCV values as finite numbers.
 *
 * Outputs:
 * - Plain object usable for indicator calculations.
 */
export type Candle = Readonly<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

/**
 * Signal emitted by a strategy on each candle.
 *
 * Inputs:
 * - Signal type and relevant metadata.
 *
 * Outputs:
 * - ENTRY includes side/price and optional stops/TP.
 * - EXIT includes price and reason.
 * - HOLD includes price and reason for logging.
 */
export type Signal = Readonly<{
  type: "ENTRY" | "EXIT" | "HOLD";
  side?: "long" | "short";
  price: number;
  quantity?: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string;
}>;

/**
 * Position snapshot supplied by the bot to the strategy.
 *
 * Inputs:
 * - Entry details and active risk controls.
 *
 * Outputs:
 * - Used for exit and trailing logic.
 */
export type Position = Readonly<{
  id: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit?: number;
  entryTime: number;
}>;

/**
 * Strategy interface - implement this to create a new strategy plugin.
 */
export interface IStrategy {
  /** Strategy name for logs and monitoring. */
  name: string;

  /** Minimum candles needed before strategy can start trading. */
  warmupPeriod: number;

  /**
   * Initialize strategy with historical candles.
   *
   * Inputs:
   * - Historical candles ordered by time ascending.
   *
   * Outputs:
   * - Warms up indicators and session state.
   */
  initialize(candles: Candle[]): void;

  /**
   * Called on every new candle.
   *
   * Inputs:
   * - Current candle and optional open position.
   *
   * Outputs:
   * - ENTRY, EXIT, or HOLD signal.
   */
  onCandle(candle: Candle, position: Position | null): Signal;

  /**
   * Called when an order fills.
   *
   * Inputs:
   * - The newly created or updated position.
   *
   * Outputs:
   * - Allows strategy to update internal state.
   */
  onFill(position: Position): void;

  /**
   * Returns current strategy state for logs/monitoring.
   */
  getState(): Record<string, unknown>;
}
