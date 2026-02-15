import { processBacktestRun } from "./processBacktestRun.js";
import type { SupabaseClient } from "../supabase/client.js";
import type { ResultsFileWriter } from "./resultsFileWriter.js";

/**
 * Simple in-process FIFO queue for backtests with concurrent processing.
 *
 * Why:
 * - Phase 1 prioritizes correctness and minimal infrastructure.
 * - Concurrent processing significantly speeds up optimizations.
 *
 * Limitations:
 * - Not suitable for horizontal scaling (multiple instances won't share state).
 * - A real job system (BullMQ/Cloud Tasks/etc.) can replace this later.
 */
export class BacktestQueue {
  private readonly supabase: SupabaseClient;
  private readonly queue: string[] = [];
  private readonly maxConcurrency: number;
  private readonly resultsWriter: ResultsFileWriter | undefined;
  private activeCount: number = 0;
  private isStarted: boolean = false;

  /**
   * Creates a new backtest queue.
   * 
   * @param maxConcurrency - Maximum number of concurrent backtests (default: 3)
   *                         Set to 1 for sequential processing
   *                         Set to 5-10 for faster optimizations (watch API rate limits!)
   * @param resultsWriter - Optional file writer for optimization results (10-50x faster than DB)
   */
  public constructor(args: Readonly<{ 
    supabase: SupabaseClient; 
    maxConcurrency?: number;
    resultsWriter?: ResultsFileWriter;
  }>) {
    this.supabase = args.supabase;
    this.maxConcurrency = args.maxConcurrency ?? 3; // Default: 3 concurrent
    this.resultsWriter = args.resultsWriter;
    console.log(`[BacktestQueue] Initialized with concurrency: ${this.maxConcurrency}${this.resultsWriter ? " (file-based results)" : ""}`);
  }

  /**
   * Enqueues a run ID for background processing.
   */
  public enqueue(runId: string): void {
    console.log(`[BacktestQueue] Enqueuing run: ${runId}`);
    this.queue.push(runId);
    this.kick();
  }

  /**
   * Starts the background loop (idempotent).
   * Also recovers any tests that were stuck in "running" status from a previous server crash/restart.
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;

    // Recovery: Find tests stuck in "running" status and re-queue them
    await this.recoverStuckTests();
    
    this.kick();
  }

  /**
   * Recovers tests that were stuck in "running" status from a previous server crash/restart,
   * and also loads all "queued" tests back into the in-memory queue.
   * 
   * This ensures that if the server restarts during a large optimization (44K+ tests),
   * all pending tests are resumed automatically.
   * 
   * Uses pagination to handle more than 1000 queued tests (Supabase default limit).
   */
  private async recoverStuckTests(): Promise<void> {
    try {
      const PAGE_SIZE = 1000;
      let allPendingTests: Array<{ id: string; symbol: string; interval: string; status: string }> = [];
      let offset = 0;
      let hasMore = true;

      console.log("[BacktestQueue] 🔍 Checking for pending tests to recover...");

      // Paginate through all pending tests (handles 44K+ runs)
      // Include "failed" tests for retry
      while (hasMore) {
        const result = await this.supabase
          .from("backtest_runs")
          .select("id, symbol, interval, status")
          .in("status", ["running", "queued", "failed"])
          .order("created_at", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (result.error !== null) {
          console.error("[BacktestQueue] Failed to check for stuck tests:", result.error);
          return;
        }

        const page = result.data ?? [];
        allPendingTests = allPendingTests.concat(page);

        if (page.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
          console.log(`[BacktestQueue] Loaded ${allPendingTests.length} pending tests so far...`);
        }
      }
      
      if (allPendingTests.length === 0) {
        console.log("[BacktestQueue] ✅ No pending tests found, queue is clean");
        return;
      }

      const runningCount = allPendingTests.filter((t) => t.status === "running").length;
      const queuedCount = allPendingTests.filter((t) => t.status === "queued").length;
      const failedCount = allPendingTests.filter((t) => t.status === "failed").length;

      console.log(`[BacktestQueue] ⚠️  RECOVERY: Found ${runningCount} stuck, ${queuedCount} queued, and ${failedCount} failed tests, recovering...`);

      // Reset "running" and "failed" tests back to "queued" status for retry (chunked)
      const testsToReset = runningCount + failedCount;
      if (testsToReset > 0) {
        console.log(`[BacktestQueue] Resetting ${testsToReset} tests (${runningCount} stuck + ${failedCount} failed)...`);
        
        const idsToReset = allPendingTests
          .filter((t) => t.status === "running" || t.status === "failed")
          .map((t) => t.id);

        if (idsToReset.length > 0) {
          const CHUNK_SIZE = 100;
          let reset = 0;
          
          for (let i = 0; i < idsToReset.length; i += CHUNK_SIZE) {
            const chunk = idsToReset.slice(i, i + CHUNK_SIZE);
            
            const updateResult = await this.supabase
              .from("backtest_runs")
              .update({ status: "queued", error_message: null })
              .in("id", chunk);

            if (updateResult.error !== null) {
              console.error(`[BacktestQueue] Failed to reset chunk ${i}:`, updateResult.error);
            } else {
              reset += chunk.length;
              if (reset % 1000 === 0) {
                console.log(`[BacktestQueue] Reset: ${reset}/${idsToReset.length}`);
              }
            }
          }
          console.log(`[BacktestQueue] ✅ Reset ${reset} tests`);
        }
      }

      // Load all pending tests into the queue
      for (const test of allPendingTests) {
        this.queue.push(test.id);
      }

      console.log(`[BacktestQueue] 🎉 Recovery complete: ${allPendingTests.length} tests loaded into queue`);
      console.log(`[BacktestQueue] Queue size: ${this.queue.length}, will process with concurrency=${this.maxConcurrency}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[BacktestQueue] ❌ Recovery failed:", message);
    }
  }

  private kick(): void {
    if (!this.isStarted) {
      console.log("[BacktestQueue] Cannot kick: queue not started yet");
      return;
    }

    // Start processing if we have capacity and items in queue
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const runId = this.queue.shift();
      if (runId === undefined) {
        continue;
      }

      this.activeCount++;
      console.log(`[BacktestQueue] Starting run: ${runId} (active: ${this.activeCount}/${this.maxConcurrency})`);
      
      // Process in background (don't await)
      void this.processRun(runId);
    }
  }

  private async processRun(runId: string): Promise<void> {
    try {
      const runnerArgs: {
        supabase: SupabaseClient;
        runId: string;
        resultsWriter?: ResultsFileWriter;
      } = { supabase: this.supabase, runId };

      // With `exactOptionalPropertyTypes`, we must omit optional props rather than pass `undefined`.
      if (this.resultsWriter !== undefined) {
        runnerArgs.resultsWriter = this.resultsWriter;
      }

      await processBacktestRun(runnerArgs);
      console.log(`[BacktestQueue] Completed run: ${runId.substring(0, 8)}`);
    } catch (err: unknown) {
      // This catch should never trigger - processBacktestRun handles its own errors
      // If we get here, it means there's an unhandled error in the process itself
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(`[BacktestQueue] ❌ FATAL: Unhandled error in processRun ${runId.substring(0, 8)}:`);
      console.error(`[BacktestQueue]    Type: ${typeof err}`);
      console.error(`[BacktestQueue]    Error: ${message}`);
      if (stack !== undefined) {
        console.error(`[BacktestQueue]    Stack:\n${stack}`);
      } else {
        console.error(`[BacktestQueue]    Raw: ${JSON.stringify(err)}`);
      }
      // Continue processing other jobs even if one fails
    } finally {
      this.activeCount--;
      console.log(`[BacktestQueue] Active count: ${this.activeCount}/${this.maxConcurrency}, Queue: ${this.queue.length}`);
      
      // Kick again to process next items
      this.kick();
    }
  }
}





