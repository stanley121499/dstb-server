/**
 * WebSocket message types for backtest progress updates.
 */
export type BacktestProgressMessage =
  | Readonly<{
      type: "connected";
      runId: string;
      message: string;
    }>
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
 * Creates a WebSocket connection URL for a specific backtest run.
 *
 * @param runId - The backtest run ID
 * @returns WebSocket URL
 */
export function getWebSocketUrl(runId: string): string {
  const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
  const wsProtocol = apiUrl.startsWith("https://") ? "wss://" : "ws://";
  const host = apiUrl.replace(/^https?:\/\//, "");
  return `${wsProtocol}${host}/ws/backtests/${runId}`;
}

/**
 * Parses a WebSocket message payload.
 *
 * @param data - Raw message data from WebSocket
 * @returns Parsed message or null if invalid
 */
export function parseWebSocketMessage(data: string | ArrayBuffer | Blob): BacktestProgressMessage | null {
  try {
    if (typeof data !== "string") {
      return null;
    }
    const parsed: unknown = JSON.parse(data);
    return parsed as BacktestProgressMessage;
  } catch {
    return null;
  }
}



