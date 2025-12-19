import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";

import type { StrategyParams } from "../domain/strategyParams.js";
import type { Candle } from "../data/yahooFinance.js";
import { intervalToMinutes } from "../utils/interval.js";
import type { TradeInsert } from "../supabase/backtestTradesRepo.js";

export type BacktestMetrics = Readonly<{
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  tradeCount: number;
}>;

export type BacktestResult = Readonly<{
  trades: readonly TradeInsert[];
  metrics: BacktestMetrics;
  warnings: readonly Readonly<{ code: string; message: string; context: Record<string, unknown> }>[];
}>;

type Position = Readonly<{
  direction: "long" | "short";
  entryIndex: number;
  entryTimeUtcMs: number;
  entryPrice: number;
  quantity: number;
  stopPrice: number;
  takeProfitPrice: number | null;
  trailingStopPrice: number | null;
  initialRiskPerUnit: number;
  feeEntry: number;
  sessionDateNy: string;
}>;

type AtrState = Readonly<{
  atr: number | null;
  prevAtr: number | null;
  trCount: number;
  trSum: number;
  prevClose: number | null;
}>;

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

function timeToLocalNy(timeUtcMs: number): DateTime {
  return DateTime.fromMillis(timeUtcMs, { zone: "utc" }).setZone("America/New_York");
}

/**
 * Derives the session date (NY local date) for a UTC timestamp.
 *
 * Session anchor is 09:30 America/New_York (docs/12). Any bar before 09:30 local
 * belongs to the previous session date.
 */
function sessionDateNyForUtc(timeUtcMs: number): string {
  const local = timeToLocalNy(timeUtcMs);
  const minutes = local.hour * 60 + local.minute;
  const isBeforeSessionOpen = minutes < 9 * 60 + 30;
  const sessionLocal = isBeforeSessionOpen ? local.minus({ days: 1 }) : local;
  return sessionLocal.toISODate() ?? sessionLocal.toFormat("yyyy-LL-dd");
}

function isInOpeningWindow(args: Readonly<{ timeUtcMs: number; sessionDateNy: string; openingRangeMinutes: number }>): boolean {
  const local = timeToLocalNy(args.timeUtcMs);
  const sessionStart = DateTime.fromISO(`${args.sessionDateNy}T09:30:00`, { zone: "America/New_York" });
  const windowEnd = sessionStart.plus({ minutes: args.openingRangeMinutes });
  return local >= sessionStart && local < windowEnd;
}

function isAfterOpeningWindow(args: Readonly<{ timeUtcMs: number; sessionDateNy: string; openingRangeMinutes: number }>): boolean {
  const local = timeToLocalNy(args.timeUtcMs);
  const sessionStart = DateTime.fromISO(`${args.sessionDateNy}T09:30:00`, { zone: "America/New_York" });
  const windowEnd = sessionStart.plus({ minutes: args.openingRangeMinutes });
  return local >= windowEnd;
}

function isAfterSessionEnd(args: Readonly<{ timeUtcMs: number; sessionDateNy: string; sessionEndTime: string }>): boolean {
  const local = timeToLocalNy(args.timeUtcMs);
  const endLocal = DateTime.fromISO(`${args.sessionDateNy}T${args.sessionEndTime}:00`, { zone: "America/New_York" });
  return local >= endLocal;
}

function updateAtr(state: AtrState, close: number, high: number, low: number, atrLength: number): AtrState {
  if (state.prevClose === null) {
    return {
      atr: null,
      prevAtr: null,
      trCount: 0,
      trSum: 0,
      prevClose: close
    };
  }

  const tr = Math.max(high - low, Math.abs(high - state.prevClose), Math.abs(low - state.prevClose));
  const trCount = state.trCount + 1;

  if (state.atr === null) {
    const trSum = state.trSum + tr;
    if (trCount < atrLength) {
      return {
        atr: null,
        prevAtr: null,
        trCount,
        trSum,
        prevClose: close
      };
    }

    // Initial ATR uses simple mean over first `atrLength` TR values (docs/12).
    const initialAtr = trSum / atrLength;
    return {
      atr: initialAtr,
      prevAtr: initialAtr,
      trCount,
      trSum,
      prevClose: close
    };
  }

  // Wilder smoothing (docs/12):
  // ATR[t] = (ATR[t-1] * (atrLength - 1) + TR[t]) / atrLength
  const prevAtr = state.atr;
  const nextAtr = (prevAtr * (atrLength - 1) + tr) / atrLength;
  return {
    atr: nextAtr,
    prevAtr: nextAtr,
    trCount,
    trSum: state.trSum,
    prevClose: close
  };
}

function computeOrLevels(openingCandles: readonly Candle[]): Readonly<{ orHigh: number; orLow: number; orMid: number }> | null {
  if (openingCandles.length === 0) {
    return null;
  }
  const first = openingCandles[0];
  if (first === undefined) {
    return null;
  }
  let orHigh = first.high;
  let orLow = first.low;
  for (const c of openingCandles) {
    orHigh = Math.max(orHigh, c.high);
    orLow = Math.min(orLow, c.low);
  }
  return { orHigh, orLow, orMid: (orHigh + orLow) / 2 };
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
  params: StrategyParams;
  startTimeUtc: string;
  endTimeUtc: string;
  initialEquity: number;
}>): BacktestResult {
  const intervalMinutes = intervalToMinutes(args.params.interval);

  const warnings: Array<Readonly<{ code: string; message: string; context: Record<string, unknown> }>> = [];

  let equity = args.initialEquity;
  let peakEquity = args.initialEquity;
  let maxDrawdownPct = 0;

  let grossProfit = 0;
  let grossLoss = 0;
  let winCount = 0;

  let position: Position | null = null;

  // Session state (NY anchored):
  let currentSessionDateNy: string | null = null;
  let tradesThisSession = 0;
  let openingCandles: Candle[] = [];
  let orLevels: Readonly<{ orHigh: number; orLow: number; orMid: number }> | null = null;
  let sessionEntryAllowed = true;

  // ATR state:
  let atrState: AtrState = {
    atr: null,
    prevAtr: null,
    trCount: 0,
    trSum: 0,
    prevClose: null
  };

  const trades: TradeInsert[] = [];

  // Precondition: candles should be sorted; we still enforce a stable order.
  const candlesSorted = [...args.candles].sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  for (let i = 0; i < candlesSorted.length; i += 1) {
    const candle = candlesSorted[i];
    if (candle === undefined) {
      // Defensive guard required by `noUncheckedIndexedAccess`.
      continue;
    }

    // Update session date and reset per-session state when crossing the 09:30 NY boundary.
    const sessionDateNy = sessionDateNyForUtc(candle.timeUtcMs);
    if (currentSessionDateNy !== sessionDateNy) {
      currentSessionDateNy = sessionDateNy;
      tradesThisSession = 0;
      openingCandles = [];
      orLevels = null;
      sessionEntryAllowed = true;
    }

    // ATR update must be done sequentially (no lookahead).
    atrState = updateAtr(atrState, candle.close, candle.high, candle.low, args.params.atr.atrLength);

    // Opening range capture.
    if (isInOpeningWindow({
      timeUtcMs: candle.timeUtcMs,
      sessionDateNy,
      openingRangeMinutes: args.params.session.openingRangeMinutes
    })) {
      openingCandles.push(candle);
    }

    // Opening range levels become available only after opening window ends (no lookahead).
    if (orLevels === null && isAfterOpeningWindow({
      timeUtcMs: candle.timeUtcMs,
      sessionDateNy,
      openingRangeMinutes: args.params.session.openingRangeMinutes
    })) {
      // Missing opening candle policy: strict skip (docs/13 Option A).
      const expectedCount = Math.max(1, Math.ceil(args.params.session.openingRangeMinutes / intervalMinutes));
      if (openingCandles.length < expectedCount) {
        sessionEntryAllowed = false;
        warnings.push({
          code: "DATA_QUALITY_MISSING_OPENING_RANGE",
          message: "Missing candles in opening range; skipping this session for entries.",
          context: {
            sessionDateNy,
            expectedCount,
            actualCount: openingCandles.length,
            interval: args.params.interval
          }
        });
      } else {
        orLevels = computeOrLevels(openingCandles);
        if (orLevels !== null && orLevels.orHigh === orLevels.orLow) {
          sessionEntryAllowed = false;
          warnings.push({
            code: "DATA_QUALITY_FLAT_OPENING_RANGE",
            message: "Opening range is flat (orHigh == orLow); skipping this session for entries.",
            context: { sessionDateNy }
          });
        }
      }
    }

    // Position management (exits).
    if (position !== null) {
      const openPosition: Position = position;
      const atr = atrState.atr;
      const stopPriceBase = openPosition.stopPrice;

      // Trailing stop update (if enabled).
      let trailingStopPrice: number | null = openPosition.trailingStopPrice;
      if (args.params.risk.trailingStopMode === "atr_trailing" && atr !== null) {
        const trailOffset = args.params.risk.atrTrailMultiple * atr;
        if (openPosition.direction === "long") {
          const candidate = candle.close - trailOffset;
          trailingStopPrice = trailingStopPrice === null ? candidate : Math.max(trailingStopPrice, candidate);
        } else {
          const candidate = candle.close + trailOffset;
          trailingStopPrice = trailingStopPrice === null ? candidate : Math.min(trailingStopPrice, candidate);
        }
      }

      const effectiveStop = trailingStopPrice ?? stopPriceBase;

      const stopTouched =
        openPosition.direction === "long" ? candle.low <= effectiveStop : candle.high >= effectiveStop;

      let tpTouched = false;
      if (openPosition.takeProfitPrice !== null) {
        tpTouched = openPosition.direction === "long"
          ? candle.high >= openPosition.takeProfitPrice
          : candle.low <= openPosition.takeProfitPrice;
      }

      const barsSinceEntry = i - openPosition.entryIndex;
      const timeExitTouched =
        args.params.risk.timeExitMode === "bars_after_entry" &&
        args.params.risk.barsAfterEntry > 0 &&
        barsSinceEntry >= args.params.risk.barsAfterEntry;

      const sessionEndTouched =
        args.params.risk.timeExitMode === "session_end" &&
        isAfterSessionEnd({
          timeUtcMs: candle.timeUtcMs,
          sessionDateNy: openPosition.sessionDateNy,
          sessionEndTime: args.params.risk.sessionEndTime
        });

      // Determine exit ordering on the current bar.
      let exitReason: TradeInsert["exit_reason"] | null = null;
      let exitRawPrice: number | null = null;

      if (stopTouched) {
        // Conservative rule (docs/14): if SL and TP are both touched, assume SL is hit first.
        exitReason = "stop";
        exitRawPrice = effectiveStop;
      } else if (tpTouched && openPosition.takeProfitPrice !== null) {
        exitReason = "take_profit";
        exitRawPrice = openPosition.takeProfitPrice;
      } else if (sessionEndTouched) {
        exitReason = "session_end";
        exitRawPrice = candle.close;
      } else if (timeExitTouched) {
        exitReason = "time_exit";
        exitRawPrice = candle.close;
      }

      if (exitReason !== null && exitRawPrice !== null) {
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

        if (pnl >= 0) {
          winCount += 1;
          grossProfit += pnl;
        } else {
          grossLoss += pnl;
        }

        const riskDollars = openPosition.initialRiskPerUnit * openPosition.quantity;
        const rMultiple = riskDollars > 0 ? pnl / riskDollars : null;

        trades.push({
          id: randomUUID(),
          run_id: args.runId,
          session_date_ny: openPosition.sessionDateNy,
          direction: openPosition.direction,
          entry_time_utc: new Date(openPosition.entryTimeUtcMs).toISOString(),
          entry_price: roundTo(openPosition.entryPrice, 10),
          exit_time_utc: new Date(candle.timeUtcMs).toISOString(),
          exit_price: roundTo(exitPrice, 10),
          quantity: roundTo(openPosition.quantity, 12),
          fee_total: roundTo(totalFees, 10),
          pnl: roundTo(pnl, 10),
          r_multiple: rMultiple === null ? null : roundTo(rMultiple, 10),
          exit_reason: exitReason
        });

        position = null;
        continue;
      }

      // Carry forward position with updated trailing stop.
      position = {
        ...openPosition,
        trailingStopPrice
      };
    }

    // Entries.
    if (position === null && orLevels !== null && sessionEntryAllowed) {
      if (atrState.atr === null) {
        // ATR warmup not complete (docs/13).
        continue;
      }

      if (tradesThisSession >= args.params.entry.maxTradesPerSession) {
        continue;
      }

      // ATR filter is expressed in bps of price.
      if (args.params.atr.atrFilter.enabled) {
        const atrBps = (atrState.atr / candle.close) * 10_000;
        if (atrBps < args.params.atr.atrFilter.minAtrBps || atrBps > args.params.atr.atrFilter.maxAtrBps) {
          continue;
        }
      }

      const buffer = args.params.entry.breakoutBufferBps / 10_000;
      const longTrigger = orLevels.orHigh * (1 + buffer);
      const shortTrigger = orLevels.orLow * (1 - buffer);

      const longAllowed = args.params.entry.directionMode === "long_only" || args.params.entry.directionMode === "long_short";
      const shortAllowed = args.params.entry.directionMode === "short_only" || args.params.entry.directionMode === "long_short";

      const longTriggered =
        longAllowed &&
        (args.params.entry.entryMode === "stop_breakout" ? candle.high >= longTrigger : candle.close >= longTrigger);

      const shortTriggered =
        shortAllowed &&
        (args.params.entry.entryMode === "stop_breakout" ? candle.low <= shortTrigger : candle.close <= shortTrigger);

      if (longTriggered && shortTriggered) {
        // Ambiguous without intrabar order; skip conservatively.
        warnings.push({
          code: "ENTRY_AMBIGUOUS_BOTH_DIRECTIONS",
          message: "Both long and short triggers occurred on the same bar; skipping entry conservatively.",
          context: { sessionDateNy, timeUtc: new Date(candle.timeUtcMs).toISOString() }
        });
        continue;
      }

      let direction: "long" | "short" | null = null;
      let entryRawPrice: number | null = null;
      if (longTriggered) {
        direction = "long";
        entryRawPrice = args.params.entry.entryMode === "stop_breakout" ? longTrigger : candle.close;
      } else if (shortTriggered) {
        direction = "short";
        entryRawPrice = args.params.entry.entryMode === "stop_breakout" ? shortTrigger : candle.close;
      }

      if (direction === null || entryRawPrice === null) {
        continue;
      }

      const entrySide = direction === "long" ? "buy" : "sell";
      const entryPrice = applySlippage({
        side: entrySide,
        rawPrice: entryRawPrice,
        slippageBps: args.params.execution.slippageBps
      });

      // Stop placement.
      let stopPrice: number;
      if (args.params.risk.stopMode === "or_opposite") {
        stopPrice = direction === "long" ? orLevels.orLow : orLevels.orHigh;
      } else if (args.params.risk.stopMode === "or_midpoint") {
        stopPrice = orLevels.orMid;
      } else {
        // atr_multiple
        const stopOffset = args.params.risk.atrStopMultiple * atrState.atr;
        stopPrice = direction === "long" ? entryPrice - stopOffset : entryPrice + stopOffset;
      }

      const stopDistance = Math.abs(entryPrice - stopPrice);
      if (stopDistance <= 0) {
        warnings.push({
          code: "TRADE_SKIPPED_INVALID_STOP_DISTANCE",
          message: "Stop distance is 0/invalid; skipping entry.",
          context: { sessionDateNy, entryPrice, stopPrice }
        });
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
        warnings.push({
          code: "TRADE_SKIPPED_INVALID_QUANTITY",
          message: "Computed quantity is invalid; skipping entry.",
          context: { sessionDateNy, quantity }
        });
        continue;
      }

      const entryNotional = quantity * entryPrice;
      const feeEntry = feeForNotional({ notional: entryNotional, feeBps: args.params.execution.feeBps });

      // Take profit.
      let takeProfitPrice: number | null = null;
      if (args.params.risk.takeProfitMode === "r_multiple") {
        const initialRiskPerUnit = stopDistance;
        const tpOffset = args.params.risk.tpRMultiple * initialRiskPerUnit;
        takeProfitPrice = direction === "long" ? entryPrice + tpOffset : entryPrice - tpOffset;
      }

      position = {
        direction,
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

      tradesThisSession += 1;

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

      if (pnl >= 0) {
        winCount += 1;
        grossProfit += pnl;
      } else {
        grossLoss += pnl;
      }

      const riskDollars = position.initialRiskPerUnit * position.quantity;
      const rMultiple = riskDollars > 0 ? pnl / riskDollars : null;

      trades.push({
        id: randomUUID(),
        run_id: args.runId,
        session_date_ny: position.sessionDateNy,
        direction: position.direction,
        entry_time_utc: new Date(position.entryTimeUtcMs).toISOString(),
        entry_price: roundTo(position.entryPrice, 10),
        exit_time_utc: new Date(last.timeUtcMs).toISOString(),
        exit_price: roundTo(exitPrice, 10),
        quantity: roundTo(position.quantity, 12),
        fee_total: roundTo(totalFees, 10),
        pnl: roundTo(pnl, 10),
        r_multiple: rMultiple === null ? null : roundTo(rMultiple, 10),
        exit_reason: "time_exit"
      });

      warnings.push({
        code: "END_OF_DATA_FORCE_EXIT",
        message: "Position was open at end of data; exited at final close.",
        context: { exitTimeUtc: new Date(last.timeUtcMs).toISOString() }
      });
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
    warnings
  };
}

