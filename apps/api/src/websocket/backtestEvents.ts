import { EventEmitter } from "node:events";
import type { BacktestProgressMessage } from "./connectionManager.js";

/**
 * Event emitter for backtest progress events.
 *
 * This allows the backtest worker to emit progress updates that are
 * then broadcast to WebSocket clients by the connection manager.
 *
 * Usage in worker code:
 * ```typescript
 * backtestEvents.emit("progress", {
 *   type: "status",
 *   runId: "abc123",
 *   status: "running"
 * });
 * ```
 */
class BacktestEventEmitter extends EventEmitter {
  /**
   * Emits a progress update for a backtest run.
   *
   * @param event - Always "progress" for this emitter
   * @param message - The progress message to emit
   */
  public emitProgress(message: BacktestProgressMessage): void {
    this.emit("progress", message);
  }

  /**
   * Registers a listener for progress events.
   *
   * @param event - Always "progress" for this emitter
   * @param listener - Callback that receives progress messages
   */
  public onProgress(listener: (message: BacktestProgressMessage) => void): void {
    this.on("progress", listener);
  }
}

/**
 * Global singleton instance of the backtest event emitter.
 *
 * This can be imported and used across the application to emit
 * and listen for backtest progress events.
 */
export const backtestEvents = new BacktestEventEmitter();



