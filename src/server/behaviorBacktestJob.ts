import { main as runBehaviorBacktest } from "../behavior/scripts/runBehaviorBacktest.js";
import type { Logger } from "../core/Logger.js";

/**
 * Returns the current calendar date string (YYYY-MM-DD) in GMT+8.
 * Used to determine whether today's backtest has already run.
 */
function todayGmt8(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Computes the milliseconds until the next midnight GMT+8 from now.
 * Adds a small buffer (30 s) so the tick fires safely after the boundary.
 */
function msUntilNextMidnightGmt8(): number {
  const nowMs = Date.now();
  const gmt8OffsetMs = 8 * 3600 * 1000;
  const gmt8NowMs = nowMs + gmt8OffsetMs;

  // UTC ms at the start of the current GMT+8 day
  const gmt8TodayStartMs = Math.floor(gmt8NowMs / 86400000) * 86400000;

  // Next GMT+8 midnight = next day start in GMT+8, converted back to UTC
  const nextMidnightGmt8UtcMs = gmt8TodayStartMs + 86400000 - gmt8OffsetMs;

  const bufferMs = 30 * 1000;
  return Math.max(0, nextMidnightGmt8UtcMs - nowMs + bufferMs);
}

/**
 * Starts the daily S2 behavior backtest scheduler.
 *
 * Strategy:
 * 1. Run immediately on startup (ensures the sheet is fresh after any redeploy).
 * 2. Schedule a timeout for the next midnight GMT+8; when it fires, run and reschedule.
 *
 * Both paths are guarded by `lastRunDate` so a date is never processed twice even
 * if the server restarts shortly after a scheduled run.
 *
 * Controlled via env vars read by `runBehaviorBacktest`:
 *   BEHAVIOR_BACKTEST_START  (default "2024-11-07" — set this on Render)
 *   BEHAVIOR_BACKTEST_END    (default today GMT+8 — aligns with midnight scheduler)
 *   BEHAVIOR_PAIR            (default "BTC-USD")
 *
 * Returns a cleanup function that cancels the pending timeout (call on SIGTERM).
 */
export function startBehaviorBacktestScheduler(args: Readonly<{
  logger: Logger;
}>): () => void {
  let lastRunDate: string | null = null;
  let running = false;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;

  const log = (msg: string): void => {
    // Write to both stdout (visible in Render log stream) and the file logger.
    console.log(msg);
    args.logger.info(msg, { event: "behavior_backtest_job" });
  };

  const runIfNeeded = (reason: string): void => {
    if (running) {
      log("[behavior-backtest-job] Skipping — a run is already in progress");
      return;
    }

    const today = todayGmt8();
    if (today === lastRunDate) {
      log(`[behavior-backtest-job] Already ran for ${today}, skipping (${reason})`);
      return;
    }

    running = true;
    lastRunDate = today;

    log(`[behavior-backtest-job] Starting daily backtest for ${today} (${reason})`);

    runBehaviorBacktest()
      .then(() => {
        log(`[behavior-backtest-job] Completed for ${today}`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[behavior-backtest-job] Failed for ${today}: ${msg}`);
        args.logger.warn(`[behavior-backtest-job] Failed for ${today}: ${msg}`, {
          event: "behavior_backtest_error",
          date: today,
        });
        // Reset so the midnight scheduler retries on the next tick.
        lastRunDate = null;
      })
      .finally(() => {
        running = false;
        scheduleNext();
      });
  };

  const scheduleNext = (): void => {
    if (nextTimer !== null) {
      clearTimeout(nextTimer);
    }
    const delayMs = msUntilNextMidnightGmt8();
    const nextRun = new Date(Date.now() + delayMs).toISOString();
    log(
      `[behavior-backtest-job] Next scheduled run at ~${nextRun} (in ${Math.round(delayMs / 60000)} min)`
    );
    nextTimer = setTimeout(() => {
      runIfNeeded("scheduled midnight GMT+8");
    }, delayMs);
  };

  // Run immediately on startup, then schedule the next midnight run.
  runIfNeeded("server startup");

  return () => {
    if (nextTimer !== null) {
      clearTimeout(nextTimer);
      nextTimer = null;
    }
  };
}
