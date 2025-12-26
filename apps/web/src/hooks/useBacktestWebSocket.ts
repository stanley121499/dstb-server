import { useCallback, useEffect, useRef, useState } from "react";
import type { BacktestProgressMessage } from "../lib/websocketClient";
import { getWebSocketUrl, parseWebSocketMessage } from "../lib/websocketClient";

export type EquityPoint = Readonly<{
  timeUtc: string;
  equity: number;
}>;

export type BacktestMetrics = Readonly<{
  finalEquity?: number;
  totalReturnPct?: number;
  maxDrawdownPct?: number;
  winRatePct?: number;
  profitFactor?: number;
  tradeCount?: number;
}>;

export type UseBacktestWebSocketResult = Readonly<{
  /** Real-time equity points received via WebSocket */
  equityPoints: readonly EquityPoint[];
  /** Current backtest status */
  status: "queued" | "running" | "completed" | "failed" | null;
  /** Partial or final metrics */
  metrics: BacktestMetrics | null;
  /** Error message if status is "failed" */
  errorMessage: string | null;
  /** Whether the WebSocket connection is active */
  isConnected: boolean;
  /** Connection error if any */
  connectionError: string | null;
}>;

/**
 * React hook for real-time backtest progress updates via WebSocket.
 *
 * Automatically connects to the WebSocket endpoint for the given run ID
 * and accumulates equity points, status changes, and metrics as they arrive.
 *
 * @param runId - The backtest run ID to watch
 * @param enabled - Whether to connect (default: true)
 * @returns Real-time backtest data and connection status
 */
export function useBacktestWebSocket(
  runId: string | null,
  enabled: boolean = true
): UseBacktestWebSocketResult {
  const [equityPoints, setEquityPoints] = useState<readonly EquityPoint[]>([]);
  const [status, setStatus] = useState<"queued" | "running" | "completed" | "failed" | null>(null);
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const handleMessage = useCallback((event: MessageEvent<string>) => {
    const message = parseWebSocketMessage(event.data);
    if (!message) {
      return;
    }

    switch (message.type) {
      case "connected":
        setConnectionError(null);
        break;

      case "status":
        setStatus(message.status);
        if (message.errorMessage) {
          setErrorMessage(message.errorMessage);
        }
        break;

      case "equity_chunk":
        setEquityPoints((prev) => [...prev, ...message.points]);
        break;

      case "metrics":
        setMetrics((prev) => ({ ...prev, ...message.metrics }));
        break;

      case "completed":
        setStatus("completed");
        setMetrics(message.finalMetrics);
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (!runId || !enabled) {
      return;
    }

    try {
      const url = getWebSocketUrl(runId);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        setConnectionError("WebSocket connection error");
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Don't reconnect if the backtest is completed or failed.
        if (status !== "completed" && status !== "failed") {
          // Attempt to reconnect after 3 seconds.
          reconnectTimeoutRef.current = globalThis.setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      wsRef.current = ws;
    } catch (err: unknown) {
      setConnectionError(err instanceof Error ? err.message : "Failed to connect to WebSocket");
      setIsConnected(false);
    }
  }, [enabled, handleMessage, runId, status]);

  useEffect(() => {
    if (!runId || !enabled) {
      return;
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current !== null) {
        globalThis.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, enabled, runId]);

  return {
    equityPoints,
    status,
    metrics,
    errorMessage,
    isConnected,
    connectionError
  };
}



