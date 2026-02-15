import type { IStrategy } from "./IStrategy";
import { ORBATRStrategy } from "./orb-atr";
import { SMAcrossoverStrategy } from "./sma-crossover";

/**
 * Creates a strategy instance by name.
 *
 * Inputs:
 * - Strategy name and parameters object.
 *
 * Outputs:
 * - Concrete strategy instance implementing IStrategy.
 *
 * Error behavior:
 * - Throws when the name is unknown or invalid.
 */
export function createStrategy(name: string, params: Record<string, unknown>): IStrategy {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Strategy name must be a non-empty string.");
  }

  switch (name) {
    case "orb-atr":
      return new ORBATRStrategy(params);
    case "sma-crossover":
      return new SMAcrossoverStrategy(params);
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}
