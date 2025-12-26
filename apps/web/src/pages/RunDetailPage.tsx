import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Download, Copy, Plus } from "lucide-react";

import { PageHeader } from "../components/layout/PageHeader";
import { MetricCard } from "../components/design/MetricCard";
import { StatusBadge } from "../components/design/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { MetricCardSkeleton, TableSkeleton } from "../components/layout/LoadingState";

import { EquityCurveChart, type EquityCurveSeries } from "../components/EquityCurveChart";
import { JsonViewer } from "../components/JsonViewer";
import { formatNumber, formatPercent } from "../components/format";

import {
  apiGetBacktestRun,
  apiListEquity,
  apiListTrades,
  type BacktestRunDetail,
  type EquityPoint,
  type Trade
} from "../lib/dstbApi";
import { useBacktestWebSocket } from "../hooks/useBacktestWebSocket";

/**
 * Interprets the total return percentage with contextual messaging.
 */
function interpretReturn(returnPct: number | null): Readonly<{ text: string; icon: string }> {
  if (returnPct === null) {
    return { text: "Pending", icon: "" };
  }
  if (returnPct > 15) {
    return { text: "Excellent performance", icon: "🔥" };
  }
  if (returnPct > 5) {
    return { text: "Strong returns", icon: "✓" };
  }
  if (returnPct > 0) {
    return { text: "Positive result", icon: "✓" };
  }
  if (returnPct === 0) {
    return { text: "Break-even", icon: "―" };
  }
  return { text: "Loss incurred", icon: "⚠️" };
}

/**
 * Interprets win rate with contextual messaging.
 */
function interpretWinRate(winRatePct: number | null, tradeCount: number | null): Readonly<{ text: string }> {
  if (winRatePct === null || tradeCount === null) {
    return { text: "Pending" };
  }
  const wins = Math.round((winRatePct / 100) * tradeCount);
  const losses = tradeCount - wins;
  return { text: `${wins} wins · ${losses} losses` };
}

/**
 * Interprets profit factor with contextual messaging.
 */
function interpretProfitFactor(profitFactor: number | null): Readonly<{ text: string; icon: string }> {
  if (profitFactor === null || !Number.isFinite(profitFactor)) {
    return { text: "Pending", icon: "" };
  }
  if (profitFactor >= 2.0) {
    return { text: "Excellent", icon: "🔥" };
  }
  if (profitFactor >= 1.5) {
    return { text: "Good", icon: "✓" };
  }
  if (profitFactor >= 1.0) {
    return { text: "Profitable", icon: "✓" };
  }
  return { text: "Net loss", icon: "⚠️" };
}

/**
 * Run Detail page - displays comprehensive backtest results with real-time updates.
 * 
 * Features:
 * - Real-time status and equity updates via WebSocket
 * - Polling fallback if WebSocket fails
 * - Enhanced metric cards with interpretations
 * - Interactive Recharts equity curve
 * - Breadcrumb navigation
 */
export function RunDetailPage(): React.ReactElement {
  const params = useParams();
  const runId = params.runId ?? "";

  const [run, setRun] = useState<BacktestRunDetail | null>(null);
  const [equity, setEquity] = useState<readonly EquityPoint[]>([]);
  const [trades, setTrades] = useState<readonly Trade[]>([]);

  const [equityTotal, setEquityTotal] = useState<number>(0);
  const [tradesTotal, setTradesTotal] = useState<number>(0);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // WebSocket hook for real-time updates.
  const ws = useBacktestWebSocket(runId);

  // Polling fallback: If WebSocket is not connected and status is running/queued, poll.
  const shouldPoll = useMemo(() => {
    return !ws.isConnected && (run?.status === "running" || run?.status === "queued");
  }, [run?.status, ws.isConnected]);

  const loadRun = useCallback(async () => {
    if (runId.trim().length === 0) {
      setError("Missing runId");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const detail = await apiGetBacktestRun(runId);
      setRun(detail);

      if (detail.status === "failed" && detail.errorMessage) {
        setError(detail.errorMessage);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  const loadTrades = useCallback(
    async (offset: number) => {
      if (runId.trim().length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const page = await apiListTrades(runId, offset, 100);

        setTrades((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTradesTotal(page.total);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load trades");
      } finally {
        setIsLoading(false);
      }
    },
    [runId]
  );

  const loadEquity = useCallback(
    async (offset: number) => {
      if (runId.trim().length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const page = await apiListEquity(runId, offset, 500);

        setEquity((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setEquityTotal(page.total);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load equity");
      } finally {
        setIsLoading(false);
      }
    },
    [runId]
  );

  const refreshAll = useCallback(async () => {
    setTrades([]);
    setEquity([]);
    setTradesTotal(0);
    setEquityTotal(0);

    await Promise.all([loadRun(), loadTrades(0), loadEquity(0)]);
  }, [loadEquity, loadRun, loadTrades]);

  // Initial load.
  useEffect(() => {
    refreshAll().catch(() => {
      // Errors are surfaced via `error` state in the individual loaders.
    });
  }, [refreshAll]);

  // Polling fallback: Poll status every 2 seconds if WebSocket is not connected.
  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    const interval = setInterval(() => {
      loadRun().catch(() => {
        // Errors are surfaced via `error` state.
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [loadRun, shouldPoll]);

  // Merge WebSocket equity points with loaded equity.
  const mergedEquity = useMemo(() => {
    const combined = [...equity, ...ws.equityPoints];
    const unique = Array.from(new Map(combined.map((p) => [p.timeUtc, p])).values());
    return unique.sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
  }, [equity, ws.equityPoints]);

  // Update run status from WebSocket.
  useEffect(() => {
    if (ws.status && run) {
      setRun((prev) => (prev ? { ...prev, status: ws.status ?? prev.status } : prev));
    }
  }, [run, ws.status]);

  // Update metrics from WebSocket.
  useEffect(() => {
    if (ws.metrics && run) {
      setRun((prev) =>
        prev
          ? {
              ...prev,
              finalEquity: ws.metrics?.finalEquity ?? prev.finalEquity,
              totalReturnPct: ws.metrics?.totalReturnPct ?? prev.totalReturnPct,
              maxDrawdownPct: ws.metrics?.maxDrawdownPct ?? prev.maxDrawdownPct,
              winRatePct: ws.metrics?.winRatePct ?? prev.winRatePct,
              profitFactor: ws.metrics?.profitFactor ?? prev.profitFactor,
              tradeCount: ws.metrics?.tradeCount ?? prev.tradeCount
            }
          : prev
      );
    }
  }, [run, ws.metrics]);

  const canLoadMoreTrades = useMemo(() => trades.length < tradesTotal, [trades.length, tradesTotal]);
  const canLoadMoreEquity = useMemo(() => equity.length < equityTotal, [equity.length, equityTotal]);

  const equitySeries = useMemo<readonly EquityCurveSeries[]>(() => {
    return [
      {
        label: "Equity",
        color: "hsl(var(--primary))",
        points: mergedEquity
      }
    ];
  }, [mergedEquity]);

  const returnInterpretation = interpretReturn(run?.totalReturnPct ?? null);
  const winRateInterpretation = interpretWinRate(run?.winRatePct ?? null, run?.tradeCount ?? null);
  const profitFactorInterpretation = interpretProfitFactor(run?.profitFactor ?? null);

  // Breadcrumbs
  const breadcrumbs = (
    <div className="flex items-center gap-2 text-small text-muted-foreground">
      <Link to="/" className="hover:text-foreground transition-colors">
        Dashboard
      </Link>
      <span>/</span>
      <Link to="/runs" className="hover:text-foreground transition-colors">
        Runs
      </Link>
      <span>/</span>
      <span className="text-foreground">{runId.slice(0, 8)}...</span>
    </div>
  );

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={run?.parameterSetName || "Backtest Run"}
        description={run ? `${run.symbol} • ${run.interval} • ${run.startTimeUtc} to ${run.endTimeUtc}` : "Loading..."}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => void refreshAll()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="secondary" size="sm" disabled>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" disabled>
              <Copy className="h-4 w-4 mr-2" />
              Clone
            </Button>
            <Button size="sm" asChild>
              <Link to="/runs/new">
                <Plus className="h-4 w-4 mr-2" />
                New Run
              </Link>
            </Button>
          </div>
        }
      />

      {/* Status Badge */}
      {run && (
        <div className="mb-6 flex items-center gap-3">
          <StatusBadge status={run.status as "completed" | "running" | "queued" | "failed"} />
          {ws.isConnected && (
            <span className="text-caption text-muted-foreground">
              ● Live updates
            </span>
          )}
        </div>
      )}

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5 p-4">
          <p className="text-small text-destructive">{error}</p>
        </Card>
      )}

      {/* Metrics */}
      {isLoading && !run ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : run && run.status === "completed" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <MetricCard
            label="Total Return"
            value={formatPercent(run.totalReturnPct)}
            valueColor={run.totalReturnPct !== null && run.totalReturnPct >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"}
            subtext={returnInterpretation.text}
            icon={returnInterpretation.icon}
          />
          <MetricCard
            label="Win Rate"
            value={formatPercent(run.winRatePct)}
            subtext={winRateInterpretation.text}
          />
          <MetricCard
            label="Max Drawdown"
            value={formatPercent(run.maxDrawdownPct)}
            valueColor="hsl(var(--destructive))"
            subtext={run.maxDrawdownPct !== null ? "Worst decline from peak" : undefined}
          />
          <MetricCard
            label="Profit Factor"
            value={formatNumber(run.profitFactor)}
            subtext={profitFactorInterpretation.text}
            icon={profitFactorInterpretation.icon}
          />
          <MetricCard
            label="Trade Count"
            value={run.tradeCount?.toString() ?? "-"}
            subtext={`${run.symbol} ${run.interval}`}
          />
        </div>
      ) : null}

      {/* Equity Curve */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <EquityCurveChart series={equitySeries} />
          {mergedEquity.length > 0 && mergedEquity.length < equityTotal && (
            <div className="flex justify-end mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadEquity(equity.length)}
                disabled={!canLoadMoreEquity || isLoading}
              >
                {isLoading ? "Loading..." : "Load more equity"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trades Table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && trades.length === 0 ? (
            <TableSkeleton rows={5} columns={9} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Session (NY)</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Dir</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Entry</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Exit</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Fee</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">PnL</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">R</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id} className="border-b border-border hover:bg-secondary/50 transition-colors">
                        <td className="py-3 px-4 text-muted-foreground">{t.sessionDateNy}</td>
                        <td className="py-3 px-4">{t.direction}</td>
                        <td className="py-3 px-4 text-muted-foreground text-caption">{`${t.entryTimeUtc} @ ${t.entryPrice}`}</td>
                        <td className="py-3 px-4 text-muted-foreground text-caption">{`${t.exitTimeUtc} @ ${t.exitPrice}`}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{t.quantity}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{t.feeTotal}</td>
                        <td className={`py-3 px-4 text-right font-medium ${t.pnl >= 0 ? "text-success" : "text-destructive"}`}>
                          {t.pnl >= 0 ? "+" : ""}{t.pnl}
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{t.rMultiple === null ? "-" : t.rMultiple.toFixed(2)}</td>
                        <td className="py-3 px-4 text-muted-foreground text-caption">{t.exitReason}</td>
                      </tr>
                    ))}

                    {trades.length === 0 && !isLoading && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-muted-foreground">
                          No trades yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
                <span className="text-caption text-muted-foreground">
                  Showing {trades.length} of {tradesTotal} trades
                </span>
                {canLoadMoreTrades && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadTrades(trades.length)}
                    disabled={isLoading}
                  >
                    {isLoading ? "Loading..." : "Load more"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Strategy Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <JsonViewer value={run ? run.paramsSnapshot : null} />
        </CardContent>
      </Card>
    </div>
  );
}
