import { processBacktestRun } from "./processBacktestRun.js";
import type { SupabaseClient } from "../supabase/client.js";

/**
 * Simple in-process FIFO queue for backtests.
 *
 * Why:
 * - Phase 1 prioritizes correctness and minimal infrastructure.
 *
 * Limitations:
 * - Not suitable for horizontal scaling (multiple instances won't share state).
 * - A real job system (BullMQ/Cloud Tasks/etc.) can replace this later.
 */
export class BacktestQueue {
  private readonly supabase: SupabaseClient;
  private readonly queue: string[] = [];
  private isRunning: boolean = false;
  private isStarted: boolean = false;

  public constructor(args: Readonly<{ supabase: SupabaseClient }>) {
    this.supabase = args.supabase;
  }

  /**
   * Enqueues a run ID for background processing.
   */
  public enqueue(runId: string): void {
    this.queue.push(runId);
    this.kick();
  }

  /**
   * Starts the background loop (idempotent).
   */
  public start(): void {
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;
    this.kick();
  }

  private kick(): void {
    if (!this.isStarted) {
      return;
    }
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    try {
      // Concurrency = 1 by default for determinism and to avoid API rate limits.
      while (this.queue.length > 0) {
        const runId = this.queue.shift();
        if (runId === undefined) {
          continue;
        }

        await processBacktestRun({ supabase: this.supabase, runId });
      }
    } finally {
      this.isRunning = false;
    }
  }
}

