import type { Position as ExchangePosition } from "../../apps/api/src/exchange/types.js";

import { Logger } from "./Logger";
import { StateManager } from "./StateManager";
import type { Position, PositionSide } from "./types";

/**
 * Result of reconciling database positions with the exchange.
 */
export type PositionReconcileResult = Readonly<{
  dbPosition: Position | null;
  exchangePosition: ExchangePosition | null;
  action: "none" | "created" | "updated" | "closed" | "warning";
  reason: string;
}>;

/**
 * PositionManager keeps DB state aligned with exchange positions.
 */
export class PositionManager {
  private readonly stateManager: StateManager;
  private readonly logger: Logger;

  /**
   * Creates a new PositionManager.
   *
   * Inputs:
   * - stateManager: SQLite state manager instance.
   * - logger: Structured logger for events.
   *
   * Outputs:
   * - PositionManager instance.
   *
   * Error behavior:
   * - Throws if inputs are invalid.
   */
  constructor(stateManager: StateManager, logger: Logger) {
    // Step 1: Validate constructor inputs.
    if (!(stateManager instanceof StateManager)) {
      throw new Error("PositionManager requires a valid StateManager instance.");
    }
    if (!(logger instanceof Logger)) {
      throw new Error("PositionManager requires a valid Logger instance.");
    }

    // Step 2: Store dependencies.
    this.stateManager = stateManager;
    this.logger = logger;
  }

  /**
   * Returns the single open position for a bot (or null).
   *
   * Inputs:
   * - botId: Bot identifier.
   *
   * Outputs:
   * - Position or null if none exist.
   *
   * Error behavior:
   * - Logs and returns null on validation failures.
   */
  async getOpenPosition(botId: string): Promise<Position | null> {
    // Step 1: Validate inputs.
    if (!this.isNonEmptyString(botId)) {
      this.logger.warn("Position lookup failed: invalid botId", {
        event: "position_lookup_invalid_bot",
        botId
      });
      return null;
    }

    // Step 2: Fetch open positions from SQLite.
    const positions = await this.stateManager.getOpenPositions(botId);
    if (positions.length === 0) {
      return null;
    }

    // Step 3: Warn if multiple positions exist and choose the latest.
    if (positions.length > 1) {
      this.logger.warn("Multiple open positions detected for bot", {
        event: "position_multiple_open",
        botId,
        count: positions.length
      });
    }

    const sorted = [...positions].sort((a, b) => b.entryTime - a.entryTime);
    return sorted[0] ?? null;
  }

  /**
   * Reconciles database position state with the exchange.
   *
   * Inputs:
   * - botId: Bot identifier.
   * - symbol: Trading symbol for DB inserts.
   * - exchangePosition: Current exchange position or null.
   * - marketPrice: Optional market price to close stale DB positions.
   *
   * Outputs:
   * - Reconciliation summary.
   *
   * Error behavior:
   * - Logs warnings for missing data and avoids destructive updates.
   */
  async reconcilePosition(args: Readonly<{
    botId: string;
    symbol: string;
    exchangePosition: ExchangePosition | null;
    marketPrice?: number;
  }>): Promise<PositionReconcileResult> {
    // Step 1: Validate inputs.
    if (!this.isNonEmptyString(args.botId) || !this.isNonEmptyString(args.symbol)) {
      return {
        dbPosition: null,
        exchangePosition: args.exchangePosition,
        action: "warning",
        reason: "Invalid reconciliation inputs."
      };
    }

    // Step 2: Load DB position for the bot.
    const dbPosition = await this.getOpenPosition(args.botId);

    // Step 3: No positions anywhere.
    if (dbPosition === null && args.exchangePosition === null) {
      return {
        dbPosition: null,
        exchangePosition: null,
        action: "none",
        reason: "No open positions on exchange or in database."
      };
    }

    // Step 4: Exchange has a position, DB does not -> create DB record.
    if (dbPosition === null && args.exchangePosition !== null) {
      const createdId = await this.stateManager.createPosition(
        this.toCorePosition(args.botId, args.symbol, args.exchangePosition)
      );
      this.logger.warn("Reconciled missing DB position from exchange", {
        event: "position_reconcile_create",
        botId: args.botId,
        exchangeSide: args.exchangePosition.side,
        quantity: args.exchangePosition.quantity,
        positionId: createdId
      });
      const createdPosition = await this.getOpenPosition(args.botId);
      return {
        dbPosition: createdPosition,
        exchangePosition: args.exchangePosition,
        action: "created",
        reason: "DB position created from exchange snapshot."
      };
    }

    // Step 5: DB has a position, exchange does not -> close DB position if price known.
    if (dbPosition !== null && args.exchangePosition === null) {
      if (!this.isPositiveNumber(args.marketPrice)) {
        this.logger.warn("Reconciliation skipped: missing market price", {
          event: "position_reconcile_missing_price",
          botId: args.botId,
          positionId: dbPosition.id
        });
        return {
          dbPosition,
          exchangePosition: null,
          action: "warning",
          reason: "Market price unavailable to close stale DB position."
        };
      }

      await this.stateManager.closePosition(
        dbPosition.id,
        args.marketPrice,
        "reconcile_missing_exchange"
      );
      this.logger.warn("Closed stale DB position missing on exchange", {
        event: "position_reconcile_close",
        botId: args.botId,
        positionId: dbPosition.id
      });
      return {
        dbPosition: null,
        exchangePosition: null,
        action: "closed",
        reason: "DB position closed because exchange is flat."
      };
    }

    // Step 6: Both exist; update DB if mismatched.
    if (dbPosition !== null && args.exchangePosition !== null) {
      const exchangeSide = this.toPositionSide(args.exchangePosition.side);
      const hasMismatch =
        dbPosition.side !== exchangeSide ||
        !this.areNumbersClose(dbPosition.quantity, args.exchangePosition.quantity) ||
        !this.areNumbersClose(dbPosition.entryPrice, args.exchangePosition.entryPrice);

      if (!hasMismatch) {
        return {
          dbPosition,
          exchangePosition: args.exchangePosition,
          action: "none",
          reason: "DB position matches exchange snapshot."
        };
      }

      await this.stateManager.updatePosition(dbPosition.id, {
        side: exchangeSide,
        quantity: args.exchangePosition.quantity,
        entryPrice: args.exchangePosition.entryPrice,
        entryTime: this.parseUtcMs(args.exchangePosition.openedAtUtc)
      });

      this.logger.warn("Updated DB position to match exchange snapshot", {
        event: "position_reconcile_update",
        botId: args.botId,
        positionId: dbPosition.id
      });

      const updated = await this.getOpenPosition(args.botId);
      return {
        dbPosition: updated,
        exchangePosition: args.exchangePosition,
        action: "updated",
        reason: "DB position updated to match exchange snapshot."
      };
    }

    return {
      dbPosition,
      exchangePosition: args.exchangePosition,
      action: "warning",
      reason: "Reconciliation fell through to default."
    };
  }

  /**
   * Convert exchange position into core position shape.
   */
  private toCorePosition(
    botId: string,
    symbol: string,
    exchangePosition: ExchangePosition
  ): Position {
    return {
      id: "pending",
      botId,
      symbol,
      side: this.toPositionSide(exchangePosition.side),
      quantity: exchangePosition.quantity,
      entryPrice: exchangePosition.entryPrice,
      entryTime: this.parseUtcMs(exchangePosition.openedAtUtc)
    };
  }

  /**
   * Map exchange side to core position side.
   */
  private toPositionSide(side: ExchangePosition["side"]): PositionSide {
    return side === "long" ? "LONG" : "SHORT";
  }

  /**
   * Parse a UTC timestamp string into milliseconds.
   */
  private parseUtcMs(value: string): number {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }

  /**
   * Compare numeric values with a small tolerance.
   */
  private areNumbersClose(left: number, right: number): boolean {
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return false;
    }
    const diff = Math.abs(left - right);
    return diff <= 1e-8;
  }

  /**
   * Validates a non-empty string.
   */
  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  /**
   * Validates a positive number.
   */
  private isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}
