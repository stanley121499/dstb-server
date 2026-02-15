import { randomUUID } from "node:crypto";

import type { StrategyParams } from "../domain/strategyParams.js";
import type { Candle } from "../data/yahooFinance.js";
import { intervalToMinutes } from "../utils/interval.js";
import type { TradeInsert } from "../supabase/backtestTradesRepo.js";
import {
  calculateStopLoss,
  calculateTakeProfit,
  generateSignals
} from "../strategy/orbAtrStrategy.js";
import { StrategyStateManager } from "../strategy/StrategyStateManager.js";
import type { OpeningRangeLevels, Signal, StrategyPosition } from "../strategy/types.js";

export type BacktestMetrics = Readonly<{
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  tradeCount: number;
}>;

export type EquityPoint = Readonly<{
  timeUtc: string;
  equity: number;
}>;

export type BacktestResult = Readonly<{
  trades: readonly TradeInsert[];
  metrics: BacktestMetrics;
  equityPoints: readonly EquityPoint[];
  warnings: readonly Readonly<{ code: string; message: string; context: Record<string, unknown> }>[];
}>;

type Position = Readonly<
  StrategyPosition & {
    feeEntry: number;
  }
>;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function applySlippage(args: Readonly<{ side: "buy" | "sell"; rawPrice: number; slippageBps: number }>): number {
  const slip = args.slippageBps / 10_000;
  return args.side === "buy" ? args.rawPrice * (1 + slip) : args.rawPrice * (1 - slip);
}

function feeForNotional(args: Readonly<{ notional: number; feeBps: number }>): number {
  return args.notional * (args.feeBps / 10_000);
}

function toExitReason(reason: string): TradeInsert["exit_reason"] {
  switch (reason) {
    case "stop":
    case "take_profit":
    case "time_exit":
    case "session_end":
      return reason;
    default:
      throw new Error(`Unsupported exit reason: "${reason}"`);
  }
}


/**
 * Runs a deterministic backtest simulation over candles.
 *
 * Implements the core rules from:
 * - `docs/12-strategy-orb-atr.md`
 * - `docs/14-backtest-engine.md`
 * - `docs/13-data-yfinance-and-intervals.md` (missing opening range policy)
 */
export function runBacktest(args: Readonly<{
  runId: string;
  candles: readonly Candle[];
  /**
   * Indicates whether `candles` is already sorted ascending by `timeUtcMs`.
   *
   * Performance note:
   * - Sorting large candle arrays per test is prohibitively expensive for grid search.
   * - Fetchers in this repo already return candles sorted; callers doing bulk runs should set this to true.
   */
  candlesSorted?: boolean;
  params: StrategyParams;
  startTimeUtc: string;
  endTimeUtc: string;
  initialEquity: number;
  optimizationMode?: boolean;
}>): BacktestResult {
  const intervalMinutes = intervalToMinutes(args.params.interval);
  const isOptimization = args.optimizationMode ?? false;

  const warnings: Array<Readonly<{ code: string; message: string; context: Record<string, unknown> }>> = [];
  const equityPoints: EquityPoint[] = [];

  let equity = args.initialEquity;
  let peakEquity = args.initialEquity;
  let maxDrawdownPct = 0;

  let grossProfit = 0;
  let grossLoss = 0;
  let winCount = 0;

  let position: Position | null = null;

  const stateManager = new StrategyStateManager({
    timezone: args.params.session.timezone,
    startTime: args.params.session.startTime,
    openingRangeMinutes: args.params.session.openingRangeMinutes,
    atrLength: args.params.atr.atrLength,
    intervalMinutes
  });
  let lastSessionDateNy: string | null = null;
  let openingRangeWarningEmitted = false;

  const trades: TradeInsert[] = [];

  // Precondition: candles should be sorted ascending by time.
  // For bulk optimization, allow callers to skip per-run sorting/copying for performance.
  const candlesSorted =
    args.candlesSorted === true ? args.candles : [...args.candles].sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  // OPTIMIZATION #5: Record initial equity point only if not optimizing
  if (!isOptimization && candlesSorted.length > 0 && candlesSorted[0] !== undefined) {
    equityPoints.push({
      timeUtc: new Date(candlesSorted[0].timeUtcMs).toISOString(),
      equity: roundTo(equity, 10)
    });
  }

  for (let i = 0; i < candlesSorted.length; i += 1) {
    const candle = candlesSorted[i];
    if (candle === undefined) {
      // Defensive guard required by `noUncheckedIndexedAccess`.
      continue;
    }

    const previousState = stateManager.getState();
    const shouldUpdateAtr = !isOptimization || previousState.atr === null || i % 5 === 0;
    stateManager.update(candle, { shouldUpdateAtr });
    const state = stateManager.getState();
    const sessionDateNy = state.sessionState.sessionDateNy;

    if (sessionDateNy !== lastSessionDateNy) {
      lastSessionDateNy = sessionDateNy;
      openingRangeWarningEmitted = false;
    }

    if (!openingRangeWarningEmitted && state.openingRangeStatus === "missing") {
      openingRangeWarningEmitted = true;
      if (!isOptimization) {
        const expectedCount = Math.max(1, Math.ceil(args.params.session.openingRangeMinutes / intervalMinutes));
        warnings.push({
          code: "DATA_QUALITY_MISSING_OPENING_RANGE",
          message: "Missing candles in opening range; skipping this session for entries.",
          context: {
            sessionDateNy,
            expectedCount,
            actualCount: state.openingRangeCandleCount,
            interval: args.params.interval
          }
        });
      }
    } else if (!openingRangeWarningEmitted && state.openingRangeStatus === "flat") {
      openingRangeWarningEmitted = true;
      if (!isOptimization) {
        warnings.push({
          code: "DATA_QUALITY_FLAT_OPENING_RANGE",
          message: "Opening range is flat (orHigh == orLow); skipping this session for entries.",
          context: { sessionDateNy }
        });
      }
    }

    const signal: Signal = generateSignals({
      currentCandle: candle,
      previousCandles: candlesSorted,
      currentIndex: i,
      sessionState: state.sessionState,
      atr: state.atr,
      params: args.params,
      currentPosition: position,
      tradesThisSession: state.tradesThisSession,
      sessionEntryAllowed: state.sessionEntryAllowed
    });
    stateManager.recordSignal(signal);

    if (signal.type === "HOLD" && signal.reason === "ENTRY_AMBIGUOUS_BOTH_DIRECTIONS" && !isOptimization) {
      warnings.push({
        code: "ENTRY_AMBIGUOUS_BOTH_DIRECTIONS",
        message: "Both long and short triggers occurred on the same bar; skipping entry conservatively.",
        context: { sessionDateNy, timeUtc: new Date(candle.timeUtcMs).toISOString() }
      });
    }

    if (signal.type === "EXIT" && position !== null) {
      if (signal.price === null || signal.reason === null) {
        throw new Error("EXIT signal missing price or reason.");
      }
      const exitReason = toExitReason(signal.reason);
      const exitRawPrice = signal.price;
      const openPosition: Position = position;
      const exitSide = openPosition.direction === "long" ? "sell" : "buy";
      const exitPrice = applySlippage({
        side: exitSide,
        rawPrice: exitRawPrice,
        slippageBps: args.params.execution.slippageBps
      });
      const exitNotional = openPosition.quantity * exitPrice;
      const feeExit = feeForNotional({ notional: exitNotional, feeBps: args.params.execution.feeBps });

      const pnlBeforeFees =
        openPosition.direction === "long"
          ? (exitPrice - openPosition.entryPrice) * openPosition.quantity
          : (openPosition.entryPrice - exitPrice) * openPosition.quantity;

      const totalFees = openPosition.feeEntry + feeExit;
      const pnl = pnlBeforeFees - totalFees;

      equity += pnl;
      peakEquity = Math.max(peakEquity, equity);
      const drawdownPct = peakEquity === 0 ? 0 : ((equity - peakEquity) / peakEquity) * 100;
      maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);

      // OPTIMIZATION #5: Record equity point only if not optimizing
      if (!isOptimization) {
        equityPoints.push({
          timeUtc: new Date(candle.timeUtcMs).toISOString(),
          equity: roundTo(equity, 10)
        });
      }

      if (pnl >= 0) {
        winCount += 1;
        grossProfit += pnl;
      } else {
        grossLoss += pnl;
      }

      const riskDollars = openPosition.initialRiskPerUnit * openPosition.quantity;
      const rMultiple = riskDollars > 0 ? pnl / riskDollars : null;
      let rMultipleValue: number | null = null;
      if (rMultiple !== null) {
        rMultipleValue = isOptimization ? rMultiple : roundTo(rMultiple, 10);
      }

      // OPTIMIZATION #6 & #7: Skip UUID generation and reduce rounding in optimization mode
      trades.push({
        id: isOptimization ? "" : randomUUID(),
        run_id: args.runId,
        session_date_ny: openPosition.sessionDateNy,
        direction: openPosition.direction,
        entry_time_utc: new Date(openPosition.entryTimeUtcMs).toISOString(),
        entry_price: isOptimization ? openPosition.entryPrice : roundTo(openPosition.entryPrice, 10),
        exit_time_utc: new Date(candle.timeUtcMs).toISOString(),
        exit_price: isOptimization ? exitPrice : roundTo(exitPrice, 10),
        quantity: isOptimization ? openPosition.quantity : roundTo(openPosition.quantity, 12),
        fee_total: isOptimization ? totalFees : roundTo(totalFees, 10),
        pnl: isOptimization ? pnl : roundTo(pnl, 10),
        r_multiple: rMultipleValue,
        exit_reason: exitReason
      });

      position = null;
      continue;
    }

    if (signal.type === "UPDATE_STOPS" && position !== null && signal.trailingStopPrice !== null) {
      position = Object.assign({}, position, {
        trailingStopPrice: signal.trailingStopPrice
      });
    }

    if ((signal.type === "ENTRY_LONG" || signal.type === "ENTRY_SHORT") && position === null) {
      if (signal.price === null || signal.direction === null) {
        throw new Error("ENTRY signal missing price or direction.");
      }
      const entrySide = signal.direction === "long" ? "buy" : "sell";
      const entryPrice = applySlippage({
        side: entrySide,
        rawPrice: signal.price,
        slippageBps: args.params.execution.slippageBps
      });

      const openingRangeLevels: OpeningRangeLevels | null = state.openingRangeLevels;
      const stopPrice = calculateStopLoss({
        entryPrice,
        direction: signal.direction,
        atr: state.atr,
        params: args.params,
        openingRangeLevels
      });

      if (stopPrice === null) {
        if (!isOptimization) {
          warnings.push({
            code: "TRADE_SKIPPED_INVALID_STOP_DISTANCE",
            message: "Stop price was unavailable; skipping entry.",
            context: { sessionDateNy, entryPrice }
          });
        }
        continue;
      }

      const stopDistance = Math.abs(entryPrice - stopPrice);
      if (stopDistance <= 0) {
        // OPTIMIZATION #8: Skip warnings in optimization mode
        if (!isOptimization) {
          warnings.push({
            code: "TRADE_SKIPPED_INVALID_STOP_DISTANCE",
            message: "Stop distance is 0/invalid; skipping entry.",
            context: { sessionDateNy, entryPrice, stopPrice }
          });
        }
        continue;
      }

      // Sizing.
      let quantity: number;
      if (args.params.risk.sizingMode === "fixed_risk_pct") {
        const riskDollars = equity * (args.params.risk.riskPctPerTrade / 100);
        quantity = riskDollars / stopDistance;
      } else {
        // fixed_notional:
        // Docs/12 defines `fixed_notional` sizing but doesn't name the field.
        // Phase 1 uses `risk.fixedNotional` for the notional-per-trade amount.
        const notionalDollars = args.params.risk.fixedNotional;
        quantity = notionalDollars / entryPrice;
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        // OPTIMIZATION #8: Skip warnings in optimization mode
        if (!isOptimization) {
          warnings.push({
            code: "TRADE_SKIPPED_INVALID_QUANTITY",
            message: "Computed quantity is invalid; skipping entry.",
            context: { sessionDateNy, quantity }
          });
        }
        continue;
      }

      const entryNotional = quantity * entryPrice;
      const feeEntry = feeForNotional({ notional: entryNotional, feeBps: args.params.execution.feeBps });

      const takeProfitPrice = calculateTakeProfit(entryPrice, stopPrice, signal.direction, args.params);

      position = {
        direction: signal.direction,
        entryIndex: i,
        entryTimeUtcMs: candle.timeUtcMs,
        entryPrice,
        quantity,
        stopPrice,
        takeProfitPrice,
        trailingStopPrice: null,
        initialRiskPerUnit: stopDistance,
        feeEntry,
        sessionDateNy
      };

      stateManager.recordTrade();

      // If we enter intrabar (stop_breakout), it is possible that SL/TP was also
      // touched in the same bar. We do NOT attempt to model that here beyond the
      // conservative exit ordering defined in docs/14.
      // We evaluate exits starting on subsequent iterations.
    }

  }

  // If a position is still open at the end of data, close it at last close.
  if (position !== null) {
    const last = candlesSorted.at(-1);
    if (last !== undefined) {
      const exitSide = position.direction === "long" ? "sell" : "buy";
      const exitPrice = applySlippage({
        side: exitSide,
        rawPrice: last.close,
        slippageBps: args.params.execution.slippageBps
      });
      const exitNotional = position.quantity * exitPrice;
      const feeExit = feeForNotional({ notional: exitNotional, feeBps: args.params.execution.feeBps });

      const pnlBeforeFees =
        position.direction === "long"
          ? (exitPrice - position.entryPrice) * position.quantity
          : (position.entryPrice - exitPrice) * position.quantity;

      const totalFees = position.feeEntry + feeExit;
      const pnl = pnlBeforeFees - totalFees;

      equity += pnl;
      peakEquity = Math.max(peakEquity, equity);
      const drawdownPct = peakEquity === 0 ? 0 : ((equity - peakEquity) / peakEquity) * 100;
      maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);

      // OPTIMIZATION #5: Record final equity point only if not optimizing
      if (!isOptimization) {
        equityPoints.push({
          timeUtc: new Date(last.timeUtcMs).toISOString(),
          equity: roundTo(equity, 10)
        });
      }

      if (pnl >= 0) {
        winCount += 1;
        grossProfit += pnl;
      } else {
        grossLoss += pnl;
      }

      const riskDollars = position.initialRiskPerUnit * position.quantity;
      const rMultiple = riskDollars > 0 ? pnl / riskDollars : null;
      let rMultipleValue: number | null = null;
      if (rMultiple !== null) {
        rMultipleValue = isOptimization ? rMultiple : roundTo(rMultiple, 10);
      }

      // OPTIMIZATION #6 & #7: Skip UUID generation and reduce rounding in optimization mode
      trades.push({
        id: isOptimization ? "" : randomUUID(),
        run_id: args.runId,
        session_date_ny: position.sessionDateNy,
        direction: position.direction,
        entry_time_utc: new Date(position.entryTimeUtcMs).toISOString(),
        entry_price: isOptimization ? position.entryPrice : roundTo(position.entryPrice, 10),
        exit_time_utc: new Date(last.timeUtcMs).toISOString(),
        exit_price: isOptimization ? exitPrice : roundTo(exitPrice, 10),
        quantity: isOptimization ? position.quantity : roundTo(position.quantity, 12),
        fee_total: isOptimization ? totalFees : roundTo(totalFees, 10),
        pnl: isOptimization ? pnl : roundTo(pnl, 10),
        r_multiple: rMultipleValue,
        exit_reason: "time_exit"
      });

      // OPTIMIZATION #8: Skip warnings in optimization mode
      if (!isOptimization) {
        warnings.push({
          code: "END_OF_DATA_FORCE_EXIT",
          message: "Position was open at end of data; exited at final close.",
          context: { exitTimeUtc: new Date(last.timeUtcMs).toISOString() }
        });
      }
    }
  }

  const tradeCount = trades.length;
  const totalReturnPct = args.initialEquity === 0 ? 0 : ((equity - args.initialEquity) / args.initialEquity) * 100;
  const winRatePct = tradeCount === 0 ? 0 : (winCount / tradeCount) * 100;

  let profitFactor: number;
  if (grossLoss === 0) {
    profitFactor = grossProfit === 0 ? 0 : Number.POSITIVE_INFINITY;
  } else {
    profitFactor = grossProfit / Math.abs(grossLoss);
  }

  return {
    trades,
    metrics: {
      finalEquity: roundTo(equity, 10),
      totalReturnPct: roundTo(totalReturnPct, 10),
      maxDrawdownPct: roundTo(maxDrawdownPct, 10),
      winRatePct: roundTo(winRatePct, 10),
      profitFactor: Number.isFinite(profitFactor) ? roundTo(profitFactor, 10) : profitFactor,
      tradeCount
    },
    equityPoints,
    warnings
  };
}





