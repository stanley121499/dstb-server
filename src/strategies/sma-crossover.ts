import { z } from "zod";

import type { Candle, IStrategy, Position, Signal } from "./IStrategy";

/**
 * SMA crossover parameters schema.
 */
const smaParamsSchema = z
  .object({
    fastPeriod: z.number().int().min(1),
    slowPeriod: z.number().int().min(2)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fastPeriod >= value.slowPeriod) {
      ctx.addIssue({
        code: "custom",
        path: ["fastPeriod"],
        message: "fastPeriod must be less than slowPeriod"
      });
    }
  });

type SMAParams = z.infer<typeof smaParamsSchema>;

/**
 * Validates a candle payload.
 */
function validateCandle(candle: Candle): void {
  if (!Number.isFinite(candle.timestamp)) {
    throw new TypeError(`Candle timestamp must be finite. Received: ${candle.timestamp}`);
  }
  if (!Number.isFinite(candle.close)) {
    throw new TypeError("Candle close must be a finite number.");
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
 * SMA crossover strategy implementation.
 */
export class SMAcrossoverStrategy implements IStrategy {
  public name = "SMA Crossover";
  public warmupPeriod: number;

  private readonly config: SMAParams;
  private candles: Candle[];

  /**
   * Creates a new SMA crossover strategy.
   *
   * Inputs:
   * - Strategy parameters.
   *
   * Error behavior:
   * - Throws if parameters are invalid.
   */
  public constructor(params: Record<string, unknown>) {
    const parsed = smaParamsSchema.parse(params);
    this.config = parsed;
    // Need slowPeriod + 1 to detect crossovers (compare current vs previous SMAs)
    this.warmupPeriod = parsed.slowPeriod + 1;
    this.candles = [];
  }

  /**
   * Initializes the strategy with historical candles.
   */
  public initialize(candles: Candle[]): void {
    // Validate incoming candles.
    for (const candle of candles) {
      validateCandle(candle);
    }

    // Keep only the most recent warmup candles.
    this.candles = candles.slice(-this.warmupPeriod);
  }

  /**
   * Processes a new candle and generates a signal.
   */
  public onCandle(candle: Candle, position: Position | null): Signal {
    validateCandle(candle);

    // Update candle buffer.
    this.candles.push(candle);
    if (this.candles.length > this.warmupPeriod) {
      this.candles.shift();
    }

    if (this.candles.length < this.warmupPeriod) {
      return holdSignal(candle, "Waiting for SMA warmup");
    }

    // Compute current and previous SMAs.
    const fastSMA = this.calculateSMA(this.config.fastPeriod);
    const slowSMA = this.calculateSMA(this.config.slowPeriod);
    const prevFastSMA = this.calculateSMA(this.config.fastPeriod, 1);
    const prevSlowSMA = this.calculateSMA(this.config.slowPeriod, 1);

    if (!Number.isFinite(fastSMA) || !Number.isFinite(slowSMA)) {
      return holdSignal(candle, "Invalid SMA calculation");
    }

    if (position === null) {
      // Long entry on bullish crossover.
      if (prevFastSMA <= prevSlowSMA && fastSMA > slowSMA) {
        return {
          type: "ENTRY",
          side: "long",
          price: candle.close,
          stopLoss: slowSMA * 0.98,
          takeProfit: candle.close * 1.04,
          reason: `Bullish crossover (Fast ${fastSMA.toFixed(2)} > Slow ${slowSMA.toFixed(2)})`
        };
      }

      // Short entry on bearish crossover.
      if (prevFastSMA >= prevSlowSMA && fastSMA < slowSMA) {
        return {
          type: "ENTRY",
          side: "short",
          price: candle.close,
          stopLoss: slowSMA * 1.02,
          takeProfit: candle.close * 0.96,
          reason: `Bearish crossover (Fast ${fastSMA.toFixed(2)} < Slow ${slowSMA.toFixed(2)})`
        };
      }

      return holdSignal(candle, "Waiting for crossover");
    }

    // Exit signals based on opposite crossover.
    if (position.side === "long" && fastSMA < slowSMA) {
      return {
        type: "EXIT",
        price: candle.close,
        reason: "Bearish crossover (exit long)"
      };
    }

    if (position.side === "short" && fastSMA > slowSMA) {
      return {
        type: "EXIT",
        price: candle.close,
        reason: "Bullish crossover (exit short)"
      };
    }

    return holdSignal(candle, "In position, no exit signal");
  }

  /**
   * Handles fill events (no-op for SMA crossover).
   */
  public onFill(_position: Position): void {
    // SMA strategy does not track fills.
  }

  /**
   * Returns the current strategy state.
   */
  public getState(): Record<string, unknown> {
    const fastSMA = this.calculateSMA(this.config.fastPeriod);
    const slowSMA = this.calculateSMA(this.config.slowPeriod);

    return {
      fastSMA,
      slowSMA,
      trend: fastSMA > slowSMA ? "bullish" : "bearish",
      candlesLoaded: this.candles.length
    };
  }

  /**
   * Calculates a simple moving average for the current candle buffer.
   */
  private calculateSMA(period: number, offset: number = 0): number {
    const end = this.candles.length - offset;
    const start = end - period;
    if (start < 0) {
      return Number.NaN;
    }
    const slice = this.candles.slice(start, end);
    const sum = slice.reduce((acc, current) => acc + current.close, 0);
    return sum / period;
  }
}
