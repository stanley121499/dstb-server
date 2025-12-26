import { randomUUID } from "node:crypto";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import { fetchBinanceCandles } from "../data/binanceDataSource.js";
import { candleCache } from "../data/candleCache.js";
import { runBacktest } from "../backtest/runBacktest.js";
import { insertTrades } from "../supabase/backtestTradesRepo.js";
import { completeBacktestRun, getBacktestRunRowById, updateBacktestRunStatus } from "../supabase/backtestRunsRepo.js";
import { insertRunEvent, insertRunEvents } from "../supabase/runEventsRepo.js";
import type { SupabaseClient } from "../supabase/client.js";
import { backtestEvents } from "../websocket/backtestEvents.js";
import type { ResultsFileWriter } from "./resultsFileWriter.js";

/**
 * Inserts equity points into the database.
 *
 * @param args - Supabase client and equity points to insert
 */
async function insertEquityPoints(args: Readonly<{
  supabase: SupabaseClient;
  runId: string;
  points: readonly Readonly<{ timeUtc: string; equity: number }>[];
}>): Promise<void> {
  if (args.points.length === 0) {
    return;
  }

  const rows = args.points.map((p) => ({
    id: randomUUID(),
    run_id: args.runId,
    time_utc: p.timeUtc,
    equity: p.equity
  }));

  const { error } = await args.supabase.from("backtest_equity_points").insert(rows);

  if (error) {
    throw new Error(`Failed to insert equity points: ${error.message}`);
  }
}

/**
 * Background runner for a single backtest run ID.
 *
 * Responsibilities:
 * - Transition status queued -> running -> completed/failed
 * - Fetch and validate candles
 * - Execute the strategy per docs/12 + docs/14
 * - Persist trades, metrics, and run events to Supabase
 */
export async function processBacktestRun(args: Readonly<{ 
  supabase: SupabaseClient; 
  runId: string;
  resultsWriter?: ResultsFileWriter;
}>): Promise<void> {
  // Keep runIdShort in outer scope for error handling
  const runIdShort = args.runId.substring(0, 8);
  
  try {
    // SKIP initial status update - saves 100 concurrent DB calls!
    // Tests start as "queued", we'll update to "completed" at the end
    
    // Step 1: Fetch run details
    const runRow = await getBacktestRunRowById({ supabase: args.supabase, id: args.runId });
    
    // Step 2: Parse params
    const params = strategyParamsSchema.parse(runRow.params_snapshot);
    
    // Check if this is an optimization run (for performance optimization)
    // For large grid searches (44K+ tests), we skip verbose logging and expensive DB writes
    const dataFingerprint = runRow.data_fingerprint as Record<string, unknown> | null;
    const isOptimization = dataFingerprint && typeof dataFingerprint === "object" && dataFingerprint.optimization_mode === true;
    
    // Treat all bulk runs as optimization mode (most tests won't have the flag yet)
    // We can detect bulk runs by checking if data_fingerprint is minimal/empty
    const isBulkRun = !dataFingerprint || Object.keys(dataFingerprint).length === 0;
    const optimizationMode = isOptimization || isBulkRun;
    
    if (optimizationMode) {
      console.log(`[processBacktestRun] Optimization mode - skipping verbose operations`);
    }

  // Emit status change via WebSocket only for non-optimization runs
  if (!optimizationMode) {
    backtestEvents.emitProgress({
      type: "status",
      runId: args.runId,
      status: "running"
    });
  }

    // Skip run start event for optimization runs
    if (!optimizationMode) {
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
    }

    const startTimeUtc = new Date(runRow.start_time_utc).toISOString();
    const endTimeUtc = new Date(runRow.end_time_utc).toISOString();

    // Data source intent is “yfinance” in docs; in Node we use Yahoo Finance via yahoo-finance2.
    // Use the validated params snapshot interval to ensure this runner cannot execute unsupported intervals.
    const effectiveInterval = params.interval;
    const fetchInterval = effectiveInterval;

    // Reduced logging for performance
    
    // Use cache to avoid refetching same data during grid search
    const cacheKey = candleCache.buildKey({
      source: "binance",
      symbol: runRow.symbol,
      interval: fetchInterval,
      startTime: startTimeUtc,
      endTime: endTimeUtc
    });

    // Step 4: Fetch candles
    const fetchResult = await candleCache.getOrCompute(
      cacheKey,
      async () => await fetchBinanceCandles({
        symbol: runRow.symbol,
        interval: fetchInterval,
        startTimeUtc,
        endTimeUtc
      })
    );

    // Phase 1: runner only supports effective intervals accepted by the API schema.
    // Resampling rules (docs/13) are implemented when/if we add additional intervals later.
    const candles = fetchResult.candles;

    // Skip data fetch warnings for optimization runs (saves millions of DB writes)
    if (!optimizationMode && fetchResult.warnings.length > 0) {
      const warningEvents = fetchResult.warnings.map((w) => ({
        id: randomUUID(),
        run_id: args.runId,
        level: "warn" as const,
        code: "DATA_FETCH_WARNING",
        message: w,
        context: { symbol: runRow.symbol, interval: fetchInterval }
      }));
      await insertRunEvents({ supabase: args.supabase, events: warningEvents });
    }

    // Step 5: Run simulation
    const simulation = runBacktest({
      runId: args.runId,
      candles,
      params,
      startTimeUtc,
      endTimeUtc,
      initialEquity: Number(runRow.initial_equity),
      optimizationMode // Pass optimization flag to enable performance optimizations
    });

    // Skip WebSocket equity updates for optimization runs (reduces overhead)
    if (!optimizationMode) {
      // Emit equity points in chunks for real-time updates.
      const chunkSize = 10;
      for (let i = 0; i < simulation.equityPoints.length; i += chunkSize) {
        const chunk = simulation.equityPoints.slice(i, i + chunkSize);
        backtestEvents.emitProgress({
          type: "equity_chunk",
          runId: args.runId,
          points: chunk
        });
      }
    }

    // Skip simulation warnings for optimization runs (saves ~7 million DB writes for 43K runs!)
    if (!optimizationMode && simulation.warnings.length > 0) {
      const warningEvents = simulation.warnings.map((w) => ({
        id: randomUUID(),
        run_id: args.runId,
        level: "warn" as const,
        code: w.code,
        message: w.message,
        context: w.context
      }));
      await insertRunEvents({ supabase: args.supabase, events: warningEvents });
    }

    // TEMPORARILY DISABLED: Skip all trade and equity inserts to speed up processing
    // TODO: Re-enable after optimization is complete
    // During optimization, we only need final metrics to compare parameter sets
    // if (!isOptimization) {
    //   await insertTrades({ supabase: args.supabase, trades: simulation.trades });
    //   await insertEquityPoints({
    //     supabase: args.supabase,
    //     runId: args.runId,
    //     points: simulation.equityPoints
    //   });
    // }
    console.log(`[processBacktestRun] ${runIdShort} simulation done: ${simulation.trades.length} trades`);

    // Step 6: Write results - file-based in optimization mode, DB otherwise
    if (optimizationMode && args.resultsWriter !== undefined) {
      // OPTIMIZATION: Write to file instead of DB (10-50x faster!)
      await args.resultsWriter.writeResult({
        runId: args.runId,
        status: "completed",
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
          candleCount: candles.length,
          optimization_mode: true
        }
      });
      console.log(`[processBacktestRun] ✅ Written to file: ${runIdShort}`);
    } else {
      // Normal mode: write directly to database
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
          candleCount: candles.length,
          optimization_mode: optimizationMode
        }
      });
      console.log(`[processBacktestRun] ✅ Completed: ${runIdShort}`);
    }

    // Skip completion event for optimization runs
    if (!optimizationMode) {
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

      // Emit final completion message via WebSocket.
      backtestEvents.emitProgress({
        type: "completed",
        runId: args.runId,
        finalMetrics: simulation.metrics
      });
    }
  } catch (err: unknown) {
    // Capture ALL error details for debugging
    let message = "Unknown backtest failure";
    let stack: string | undefined;
    
    if (err instanceof Error) {
      message = err.message;
      stack = err.stack;
    } else if (typeof err === "string") {
      message = err;
    } else if (err !== null && typeof err === "object") {
      // Try to extract any useful info from object errors
      message = JSON.stringify(err, null, 2);
    }
    
    // Log detailed error for debugging
    console.error(`[processBacktestRun] ❌ Run ${runIdShort} failed:`);
    console.error(`[processBacktestRun]    Type: ${typeof err}`);
    console.error(`[processBacktestRun]    Error: ${message}`);
    if (stack !== undefined) {
      console.error(`[processBacktestRun]    Stack:\n${stack.substring(0, 300)}`);
    } else {
      console.error(`[processBacktestRun]    Raw error: ${String(err).substring(0, 300)}`);
    }
    
    // Get optimization flag to determine write destination
    const runRow = await getBacktestRunRowById({ supabase: args.supabase, id: args.runId });
    const dataFingerprint = runRow.data_fingerprint as Record<string, unknown> | null;
    const isOptimization = dataFingerprint && typeof dataFingerprint === "object" && dataFingerprint.optimization_mode === true;
    const isBulkRun = !dataFingerprint || Object.keys(dataFingerprint).length === 0;
    const optimizationMode = isOptimization || isBulkRun;
    
    // Write failure - file-based in optimization mode, DB otherwise
    if (optimizationMode && args.resultsWriter !== undefined) {
      // Write failure to file
      await args.resultsWriter.writeResult({
        runId: args.runId,
        status: "failed",
        errorMessage: message
      });
    } else {
      // Write failure to database
      await updateBacktestRunStatus({
        supabase: args.supabase,
        id: args.runId,
        status: "failed",
        errorMessage: message
      });
    }

    // Skip failure events for optimization runs (errors are in file)
    if (!optimizationMode) {
      // Emit failure status via WebSocket.
      backtestEvents.emitProgress({
        type: "status",
        runId: args.runId,
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
}





