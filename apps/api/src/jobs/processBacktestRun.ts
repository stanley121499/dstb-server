import { randomUUID } from "node:crypto";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import { fetchYahooCandles } from "../data/yahooFinance.js";
import { runBacktest } from "../backtest/runBacktest.js";
import { insertTrades } from "../supabase/backtestTradesRepo.js";
import { completeBacktestRun, getBacktestRunRowById, updateBacktestRunStatus } from "../supabase/backtestRunsRepo.js";
import { insertRunEvent } from "../supabase/runEventsRepo.js";
import type { SupabaseClient } from "../supabase/client.js";

/**
 * Background runner for a single backtest run ID.
 *
 * Responsibilities:
 * - Transition status queued -> running -> completed/failed
 * - Fetch and validate candles
 * - Execute the strategy per docs/12 + docs/14
 * - Persist trades, metrics, and run events to Supabase
 */
export async function processBacktestRun(args: Readonly<{ supabase: SupabaseClient; runId: string }>): Promise<void> {
  await updateBacktestRunStatus({ supabase: args.supabase, id: args.runId, status: "running", errorMessage: null });

  try {
    const runRow = await getBacktestRunRowById({ supabase: args.supabase, id: args.runId });
    const params = strategyParamsSchema.parse(runRow.params_snapshot);

    await insertRunEvent({
      supabase: args.supabase,
      event: {
        id: randomUUID(),
        run_id: args.runId,
        level: "info",
        code: "RUN_START",
        message: "Backtest run started.",
        context: {
          symbol: runRow.symbol,
          interval: runRow.interval,
          startTimeUtc: new Date(runRow.start_time_utc).toISOString(),
          endTimeUtc: new Date(runRow.end_time_utc).toISOString()
        }
      }
    });

    const startTimeUtc = new Date(runRow.start_time_utc).toISOString();
    const endTimeUtc = new Date(runRow.end_time_utc).toISOString();

    // Data source intent is “yfinance” in docs; in Node we use Yahoo Finance via yahoo-finance2.
    // Use the validated params snapshot interval to ensure this runner cannot execute unsupported intervals.
    const effectiveInterval = params.interval;
    const fetchInterval = effectiveInterval;

    const fetchResult = await fetchYahooCandles({
      symbol: runRow.symbol,
      interval: fetchInterval,
      startTimeUtc,
      endTimeUtc
    });

    // Phase 1: runner only supports effective intervals accepted by the API schema.
    // Resampling rules (docs/13) are implemented when/if we add additional intervals later.
    const candles = fetchResult.candles;

    for (const w of fetchResult.warnings) {
      await insertRunEvent({
        supabase: args.supabase,
        event: {
          id: randomUUID(),
          run_id: args.runId,
          level: "warn",
          code: "DATA_FETCH_WARNING",
          message: w,
          context: { symbol: runRow.symbol, interval: fetchInterval }
        }
      });
    }

    const simulation = runBacktest({
      runId: args.runId,
      candles,
      params,
      startTimeUtc,
      endTimeUtc,
      initialEquity: Number(runRow.initial_equity)
    });

    for (const w of simulation.warnings) {
      await insertRunEvent({
        supabase: args.supabase,
        event: {
          id: randomUUID(),
          run_id: args.runId,
          level: "warn",
          code: w.code,
          message: w.message,
          context: w.context
        }
      });
    }

    await insertTrades({ supabase: args.supabase, trades: simulation.trades });

    await completeBacktestRun({
      supabase: args.supabase,
      id: args.runId,
      finalEquity: simulation.metrics.finalEquity,
      totalReturnPct: simulation.metrics.totalReturnPct,
      maxDrawdownPct: simulation.metrics.maxDrawdownPct,
      winRatePct: simulation.metrics.winRatePct,
      profitFactor: simulation.metrics.profitFactor,
      tradeCount: simulation.metrics.tradeCount,
      dataFingerprint: {
        data: fetchResult.fingerprint,
        resampledFromInterval: null,
        effectiveInterval,
        candleCount: candles.length
      }
    });

    await insertRunEvent({
      supabase: args.supabase,
      event: {
        id: randomUUID(),
        run_id: args.runId,
        level: "info",
        code: "RUN_COMPLETED",
        message: "Backtest run completed.",
        context: {
          tradeCount: simulation.metrics.tradeCount,
          finalEquity: simulation.metrics.finalEquity
        }
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown backtest failure";
    await updateBacktestRunStatus({
      supabase: args.supabase,
      id: args.runId,
      status: "failed",
      errorMessage: message
    });

    await insertRunEvent({
      supabase: args.supabase,
      event: {
        id: randomUUID(),
        run_id: args.runId,
        level: "error",
        code: "RUN_FAILED",
        message,
        context: {
          runId: args.runId
        }
      }
    });
  }
}

