import { Logger } from "./Logger";
import { StateManager } from "./StateManager";
import type { BotConfig, Position } from "./types";
import type { Signal } from "../strategies/IStrategy";

/**
 * Result of a pre-trade risk check.
 */
export type RiskCheckResult = Readonly<{
  allowed: boolean;
  reason: string;
  details?: Readonly<Record<string, unknown>>;
}>;

/**
 * RiskManager evaluates pre-trade constraints and daily loss limits.
 */
export class RiskManager {
  private readonly stateManager: StateManager;
  private readonly logger: Logger;

  /**
   * Creates a new RiskManager instance.
   *
   * Inputs:
   * - stateManager: SQLite state manager.
   * - logger: Structured logger.
   *
   * Outputs:
   * - RiskManager instance.
   *
   * Error behavior:
   * - Throws on invalid dependencies.
   */
  constructor(stateManager: StateManager, logger: Logger) {
    // Step 1: Validate dependencies.
    if (!(stateManager instanceof StateManager)) {
      throw new Error("RiskManager requires a valid StateManager instance.");
    }
    if (!(logger instanceof Logger)) {
      throw new Error("RiskManager requires a valid Logger instance.");
    }

    // Step 2: Store dependencies.
    this.stateManager = stateManager;
    this.logger = logger;
  }

  /**
   * Checks whether a proposed entry trade is allowed.
   *
   * Inputs:
   * - botId: Bot identifier.
   * - config: Bot configuration.
   * - signal: Strategy entry signal.
   * - marketPrice: Current market price.
   * - quantity: Proposed order size.
   * - currentEquity: Current account equity.
   * - openPosition: Existing DB position if any.
   *
   * Outputs:
   * - RiskCheckResult indicating approval or rejection.
   *
   * Error behavior:
   * - Returns disallowed with reason on validation errors.
   */
  async checkEntry(args: Readonly<{
    botId: string;
    config: BotConfig;
    signal: Signal;
    marketPrice: number;
    quantity: number;
    currentEquity: number;
    openPosition: Position | null;
  }>): Promise<RiskCheckResult> {
    // Step 1: Validate input types and signal semantics.
    if (!this.isNonEmptyString(args.botId)) {
      return this.reject("Invalid botId.");
    }
    if (!this.isEntrySignal(args.signal)) {
      return this.reject("Signal is not a valid ENTRY signal.");
    }
    if (!this.isPositiveNumber(args.marketPrice)) {
      return this.reject("Market price must be a positive number.");
    }
    if (!this.isPositiveNumber(args.quantity)) {
      return this.reject("Order quantity must be a positive number.");
    }
    if (!this.isPositiveNumber(args.currentEquity)) {
      return this.reject("Current equity must be a positive number.");
    }

    // Step 2: Block entries if a position is already open.
    if (args.openPosition !== null) {
      return this.reject("Open position already exists.");
    }

    // Step 3: Enforce maximum daily loss limit.
    const dailyLossCheck = await this.checkDailyLoss(args.botId, args.config);
    if (!dailyLossCheck.allowed) {
      return dailyLossCheck;
    }

    // Step 4: Enforce max position size percent.
    const maxPositionValue =
      (args.currentEquity * args.config.riskManagement.maxPositionSizePct) / 100;
    const proposedValue = args.marketPrice * args.quantity;
    if (proposedValue > maxPositionValue) {
      return this.reject("Position size exceeds maxPositionSizePct.", {
        maxPositionValue,
        proposedValue
      });
    }

    // Step 5: Approve the trade when all checks pass.
    return this.approve("OK", {
      maxPositionValue,
      proposedValue
    });
  }

  /**
   * Checks daily loss limits using trade history.
   */
  private async checkDailyLoss(botId: string, config: BotConfig): Promise<RiskCheckResult> {
    // Step 1: Compute today's date for the PnL query.
    const today = this.formatDate(new Date());

    // Step 2: Read daily PnL from SQLite.
    const dailyPnl = await this.stateManager.getDailyPnL(botId, today);

    // Step 3: Determine max loss threshold.
    const maxLoss =
      (config.initialBalance * config.riskManagement.maxDailyLossPct) / 100;

    if (dailyPnl <= -maxLoss) {
      this.logger.warn("Daily loss limit reached", {
        event: "risk_daily_loss_limit",
        botId,
        dailyPnl,
        maxLoss
      });
      return this.reject("Daily loss limit reached.", {
        dailyPnl,
        maxLoss
      });
    }

    return this.approve("Daily loss OK", {
      dailyPnl,
      maxLoss
    });
  }

  /**
   * Returns an approval result.
   */
  private approve(reason: string, details?: Readonly<Record<string, unknown>>): RiskCheckResult {
    return details === undefined ? { allowed: true, reason } : { allowed: true, reason, details };
  }

  /**
   * Returns a rejection result.
   */
  private reject(reason: string, details?: Readonly<Record<string, unknown>>): RiskCheckResult {
    return details === undefined ? { allowed: false, reason } : { allowed: false, reason, details };
  }

  /**
   * Formats a date into YYYY-MM-DD.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Checks if value is a non-empty string.
   */
  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  /**
   * Checks if value is a positive number.
   */
  private isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  /**
   * Validates an ENTRY signal.
   */
  private isEntrySignal(signal: Signal): boolean {
    return signal.type === "ENTRY" && (signal.side === "long" || signal.side === "short");
  }
}
