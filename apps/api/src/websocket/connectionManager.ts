import type { WebSocket } from "@fastify/websocket";

/**
 * Message types for backtest progress updates sent via WebSocket.
 */
export type BacktestProgressMessage =
  | Readonly<{
      type: "status";
      runId: string;
      status: "queued" | "running" | "completed" | "failed";
      errorMessage?: string;
    }>
  | Readonly<{
      type: "equity_chunk";
      runId: string;
      points: readonly Readonly<{ timeUtc: string; equity: number }>[];
    }>
  | Readonly<{
      type: "metrics";
      runId: string;
      metrics: Readonly<{
        finalEquity?: number;
        totalReturnPct?: number;
        maxDrawdownPct?: number;
        winRatePct?: number;
        profitFactor?: number;
        tradeCount?: number;
      }>;
    }>
  | Readonly<{
      type: "completed";
      runId: string;
      finalMetrics: Readonly<{
        finalEquity: number;
        totalReturnPct: number;
        maxDrawdownPct: number;
        winRatePct: number;
        profitFactor: number;
        tradeCount: number;
      }>;
    }>;

/**
 * Manages WebSocket connections for real-time backtest updates.
 *
 * Responsibilities:
 * - Register/unregister client connections per run ID
 * - Broadcast progress messages to all clients watching a specific run
 * - Handle connection cleanup and error states
 */
export class WebSocketConnectionManager {
  /**
   * Map of runId -> Set of WebSocket connections.
   * Multiple clients can watch the same run simultaneously.
   */
  private readonly connections: Map<string, Set<WebSocket>>;

  constructor() {
    this.connections = new Map();
  }

  /**
   * Registers a WebSocket connection for a specific backtest run.
   *
   * @param runId - The backtest run ID to watch
   * @param ws - The WebSocket connection
   */
  public addConnection(runId: string, ws: WebSocket): void {
    let clients = this.connections.get(runId);
    if (!clients) {
      clients = new Set();
      this.connections.set(runId, clients);
    }
    clients.add(ws);
  }

  /**
   * Removes a WebSocket connection from a run's subscriber list.
   *
   * @param runId - The backtest run ID
   * @param ws - The WebSocket connection to remove
   */
  public removeConnection(runId: string, ws: WebSocket): void {
    const clients = this.connections.get(runId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        this.connections.delete(runId);
      }
    }
  }

  /**
   * Broadcasts a progress message to all clients watching a specific run.
   *
   * @param message - The progress message to broadcast
   */
  public broadcast(message: BacktestProgressMessage): void {
    const clients = this.connections.get(message.runId);
    if (!clients || clients.size === 0) {
      return;
    }

    const payload = JSON.stringify(message);

    for (const ws of clients) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(payload);
        }
      } catch (err: unknown) {
        // Log error but don't throw - we want to continue broadcasting to other clients.
        console.error(`Failed to send WebSocket message to client for run ${message.runId}:`, err);
      }
    }
  }

  /**
   * Returns the number of active connections for a specific run.
   *
   * @param runId - The backtest run ID
   * @returns The number of connected clients watching this run
   */
  public getConnectionCount(runId: string): number {
    const clients = this.connections.get(runId);
    return clients ? clients.size : 0;
  }

  /**
   * Returns the total number of active WebSocket connections across all runs.
   *
   * @returns Total connection count
   */
  public getTotalConnectionCount(): number {
    let total = 0;
    for (const clients of this.connections.values()) {
      total += clients.size;
    }
    return total;
  }

  /**
   * Closes all connections for a specific run and removes them from tracking.
   * Useful when a run is completed and no more updates will be sent.
   *
   * @param runId - The backtest run ID
   */
  public closeAllForRun(runId: string): void {
    const clients = this.connections.get(runId);
    if (!clients) {
      return;
    }

    for (const ws of clients) {
      try {
        ws.close();
      } catch (err: unknown) {
        console.error(`Failed to close WebSocket for run ${runId}:`, err);
      }
    }

    this.connections.delete(runId);
  }
}



