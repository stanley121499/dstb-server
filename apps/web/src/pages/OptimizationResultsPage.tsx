import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square, GitCompare } from "lucide-react";

import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

import { apiGetBacktestRun, apiListBacktestRuns, type BacktestRunSummary } from "../lib/dstbApi";
import { formatNumber, formatPercent } from "../components/format";
import type { StrategyParams } from "../domain/strategyParams";

type SortField = "totalReturnPct" | "maxDrawdownPct" | "winRatePct" | "profitFactor" | "tradeCount" | "symbol" | "interval";
type SortDirection = "asc" | "desc";

/**
 * Sort icon component that shows sort direction for table columns
 */
function SortIcon(props: Readonly<{ field: SortField; currentField: SortField; direction: SortDirection }>): React.ReactElement {
  if (props.currentField !== props.field) {
    return <ArrowUpDown className="h-4 w-4 opacity-50" />;
  }
  return props.direction === "asc" 
    ? <ArrowUp className="h-4 w-4" />
    : <ArrowDown className="h-4 w-4" />;
}

/**
 * OptimizationResultsPage: Displays leaderboard of all optimization runs.
 * 
 * Performance optimizations for large result sets (44K+ runs):
 * - Uses batched pagination (500 runs per request) instead of Promise.all
 * - Shows loading progress bar for user feedback
 * - Filters results by grid run IDs to avoid loading unrelated runs
 * - Fetches strategyParams only for visible runs in each batch
 */
export function OptimizationResultsPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [runs, setRuns] = useState<readonly BacktestRunSummary[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("totalReturnPct");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [runIds, setRunIds] = useState<readonly string[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null);

  const MAX_COMPARE = 10; // Allow comparing up to 10 runs
  const POLL_INTERVAL_MS = 10000; // Poll every 10 seconds (reduced from 3s to reduce log spam)

  // Extract grid ID and fetch runs
  useEffect(() => {
    const gridId = searchParams.get("gridId");
    
    if (!gridId) {
      setError("No optimization results found");
      setIsLoading(false);
      return;
    }

    // Fetch all runs created around the optimization timestamp
    const timestamp = sessionStorage.getItem("optimizationTimestamp");
    const totalQueued = sessionStorage.getItem("optimizationTotalQueued");
    
    if (!timestamp) {
      setError("Optimization session expired. Please run optimization again.");
      setIsLoading(false);
      return;
    }

    // We'll fetch runs by querying the API for recent runs
    // For now, we'll fetch the last N runs where N = totalQueued
    const expectedCount = totalQueued ? Number.parseInt(totalQueued, 10) : 1000;
    
    // Fetch the most recent runs (they should be from this grid search)
    apiListBacktestRuns(0, Math.min(expectedCount, 10000))
      .then((result) => {
        // Filter runs created after the timestamp
        const gridTimestamp = new Date(timestamp).getTime();
        const recentRuns = result.items.filter((run) => {
          const runTime = new Date(run.createdAt).getTime();
          return runTime >= gridTimestamp - 5000; // 5 second buffer
        });
        
        const ids = recentRuns.map((r) => r.id);
        setRunIds(ids);
        
        // Clear session storage after reading
        sessionStorage.removeItem("optimizationGridId");
        sessionStorage.removeItem("optimizationTotalQueued");
        sessionStorage.removeItem("optimizationTimestamp");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load runs");
        setIsLoading(false);
      });
  }, [searchParams]);

  // Fetch run data using batched API calls to avoid browser crash with large result sets
  const fetchRunData = useCallback(async (): Promise<void> => {
    if (runIds.length === 0) {
      return;
    }

    try {
      setLoadingProgress({ current: 0, total: runIds.length });
      
      // Use batched pagination approach to fetch runs efficiently
      // API limit is 500 per request, so we'll batch at that size
      const BATCH_SIZE = 500;
      const allRuns: BacktestRunSummary[] = [];
      
      // Calculate how many batches we need
      const totalBatches = Math.ceil(runIds.length / BATCH_SIZE);
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const offset = batchIndex * BATCH_SIZE;
        
        try {
          // Fetch page of results
          const page = await apiListBacktestRuns(offset, BATCH_SIZE);
          
          // Filter to only include runs from our grid search
          const gridRunIds = new Set(runIds);
          const batchRuns = page.items.filter((run) => gridRunIds.has(run.id));
          
          // Fetch full details for each run in this batch to get strategyParams
          const detailedRuns = await Promise.all(
            batchRuns.map(async (summary) => {
              try {
                const detail = await apiGetBacktestRun(summary.id);
                return {
                  ...summary,
                  strategyParams: detail.paramsSnapshot as StrategyParams | null
                };
              } catch {
                return summary;
              }
            })
          );
          
          allRuns.push(...detailedRuns);
          
          // Update progress
          setLoadingProgress({ 
            current: Math.min(offset + BATCH_SIZE, runIds.length), 
            total: runIds.length 
          });
          
          // If we got fewer results than requested, we've reached the end
          if (page.items.length < BATCH_SIZE) {
            break;
          }
        } catch (err) {
          console.error(`Failed to fetch batch ${batchIndex + 1}/${totalBatches}:`, err);
          // Continue with next batch even if this one fails
        }
      }
      
      setRuns(allRuns);
      setError(null);
      setLoadingProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load optimization results");
      setLoadingProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, [runIds]);

  // Initial load
  useEffect(() => {
    if (runIds.length > 0) {
      setIsLoading(true);
      void fetchRunData();
    }
  }, [runIds, fetchRunData]);

  // Poll for updates every 3 seconds
  useEffect(() => {
    if (runIds.length === 0) {
      return;
    }

    // Check if all runs are completed or failed
    const allComplete = runs.length > 0 && runs.every(
      (r) => r.status === "completed" || r.status === "failed"
    );

    if (allComplete) {
      console.log("[OptimizationResults] All runs complete, stopping polling");
      return;
    }

    const intervalId = setInterval(() => {
      console.log("[OptimizationResults] Polling for updates...");
      void fetchRunData();
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [runIds, runs, fetchRunData, POLL_INTERVAL_MS]);

  const toggleRunSelection = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else if (next.size < MAX_COMPARE) {
        next.add(runId);
      }
      return next;
    });
  }, [MAX_COMPARE]);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }, [sortField]);

  const onCompareSelected = useCallback(() => {
    if (selectedRunIds.size === 0) {
      return;
    }
    const runIdsQuery = Array.from(selectedRunIds).join(",");
    navigate(`/compare?runIds=${encodeURIComponent(runIdsQuery)}`);
  }, [selectedRunIds, navigate]);

  // Sort runs
  const sortedRuns = React.useMemo(() => {
    const sorted = [...runs].sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortField) {
        case "totalReturnPct":
          aVal = a.totalReturnPct;
          bVal = b.totalReturnPct;
          break;
        case "maxDrawdownPct":
          aVal = a.maxDrawdownPct;
          bVal = b.maxDrawdownPct;
          break;
        case "winRatePct":
          aVal = a.winRatePct;
          bVal = b.winRatePct;
          break;
        case "profitFactor":
          aVal = a.profitFactor;
          bVal = b.profitFactor;
          break;
        case "tradeCount":
          aVal = a.tradeCount;
          bVal = b.tradeCount;
          break;
        case "symbol":
          aVal = a.symbol;
          bVal = b.symbol;
          break;
        case "interval":
          aVal = a.interval;
          bVal = b.interval;
          break;
      }

      // Handle nulls
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return sorted;
  }, [runs, sortField, sortDirection]);

  const completedCount = runs.filter((r) => r.status === "completed").length;
  const runningCount = runs.filter((r) => r.status === "running").length;
  const queuedCount = runs.filter((r) => r.status === "queued").length;
  const allComplete = runs.length > 0 && runs.every((r) => r.status === "completed" || r.status === "failed");
  
  // Only show best run if it has results
  const bestRun = sortedRuns.find((r) => r.status === "completed" && r.totalReturnPct !== null);

  if (isLoading) {
    return (
      <div className="page-container">
        <PageHeader
          title="Optimization Results"
          description="Loading results..."
        />
        <Card className="p-8">
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">Loading optimization results...</p>
            
            {loadingProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-small">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">
                    {loadingProgress.current.toLocaleString()} / {loadingProgress.total.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-3">
                  <div 
                    className="bg-primary h-3 rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                    style={{ width: `${Math.min((loadingProgress.current / loadingProgress.total) * 100, 100)}%` }}
                  >
                    {loadingProgress.current > 0 && (
                      <span className="text-xs font-medium text-primary-foreground">
                        {Math.round((loadingProgress.current / loadingProgress.total) * 100)}%
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-caption text-muted-foreground text-center">
                  This may take a few minutes for large optimizations...
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <PageHeader
          title="Optimization Results"
          description="Error loading results"
        />
        <Card className="border-destructive/50 bg-destructive/5 p-4">
          <p className="text-destructive">{error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Optimization Results"
        description={
          allComplete 
            ? `${runs.length} tests • All complete ✓`
            : `${runs.length} tests • ${completedCount} completed • ${runningCount} running • ${queuedCount} queued`
        }
        actions={
          <Button 
            onClick={onCompareSelected} 
            disabled={selectedRunIds.size === 0}
          >
            <GitCompare className="h-4 w-4 mr-2" />
            Compare Selected ({selectedRunIds.size})
          </Button>
        }
      />

      {/* Summary Stats */}
      {bestRun && (
        <Card className="mb-6 bg-success-background border-success/30">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-small font-medium text-success-foreground mb-1">
                  🏆 Best Performer
                </p>
                <div className="flex items-center gap-4">
                  <Badge variant="outline">{bestRun.symbol}</Badge>
                  <Badge variant="outline">{bestRun.interval}</Badge>
                  <span className="text-h3 font-bold text-success-foreground">
                    {formatPercent(bestRun.totalReturnPct)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-caption text-muted-foreground">Win Rate</p>
                <p className="text-body font-medium">{formatPercent(bestRun.winRatePct)}</p>
              </div>
              <div className="text-right">
                <p className="text-caption text-muted-foreground">Profit Factor</p>
                <p className="text-body font-medium">{formatNumber(bestRun.profitFactor)}</p>
              </div>
              <div className="text-right">
                <p className="text-caption text-muted-foreground">Trades</p>
                <p className="text-body font-medium">{bestRun.tradeCount ?? "-"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Real-time status banner */}
      {!allComplete && (
        <Card className="mb-6 bg-primary/10 border-primary/30 p-4">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 bg-primary rounded-full animate-pulse" />
            <p className="text-small text-foreground">
              <strong>Live Updates:</strong> Page refreshing every 10 seconds. {runningCount} running, {queuedCount} queued.
            </p>
          </div>
        </Card>
      )}

      {/* Instructions */}
      {allComplete && (
        <Card className="mb-6 bg-secondary/30 p-4">
          <p className="text-small text-foreground">
            💡 <strong>Tip:</strong> Click column headers to sort. Select up to {MAX_COMPARE} runs to compare in detail.
          </p>
        </Card>
      )}

      {/* Results Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                <th className="p-3 text-left">
                  <span className="text-small font-semibold">Select</span>
                </th>
                <th className="p-3 text-left">
                  <button
                    onClick={() => toggleSort("symbol")}
                    className="flex items-center gap-1 text-small font-semibold hover:text-primary transition-colors"
                  >
                    Symbol
                    <SortIcon field="symbol" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-left">
                  <button
                    onClick={() => toggleSort("interval")}
                    className="flex items-center gap-1 text-small font-semibold hover:text-primary transition-colors"
                  >
                    Interval
                    <SortIcon field="interval" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-right">
                  <button
                    onClick={() => toggleSort("totalReturnPct")}
                    className="flex items-center gap-1 ml-auto text-small font-semibold hover:text-primary transition-colors"
                  >
                    Return
                    <SortIcon field="totalReturnPct" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-right">
                  <button
                    onClick={() => toggleSort("maxDrawdownPct")}
                    className="flex items-center gap-1 ml-auto text-small font-semibold hover:text-primary transition-colors"
                  >
                    Max DD
                    <SortIcon field="maxDrawdownPct" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-right">
                  <button
                    onClick={() => toggleSort("winRatePct")}
                    className="flex items-center gap-1 ml-auto text-small font-semibold hover:text-primary transition-colors"
                  >
                    Win Rate
                    <SortIcon field="winRatePct" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-right">
                  <button
                    onClick={() => toggleSort("profitFactor")}
                    className="flex items-center gap-1 ml-auto text-small font-semibold hover:text-primary transition-colors"
                  >
                    PF
                    <SortIcon field="profitFactor" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-right">
                  <button
                    onClick={() => toggleSort("tradeCount")}
                    className="flex items-center gap-1 ml-auto text-small font-semibold hover:text-primary transition-colors"
                  >
                    Trades
                    <SortIcon field="tradeCount" currentField={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="p-3 text-left">
                  <span className="text-small font-semibold">Parameters</span>
                </th>
                <th className="p-3 text-left">
                  <span className="text-small font-semibold">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRuns.map((run, index) => {
                const isSelected = selectedRunIds.has(run.id);
                const isBest = index === 0;

                return (
                  <tr
                    key={run.id}
                    className={`border-b border-border last:border-0 transition-colors ${
                      isBest ? "bg-success-background/30" : "hover:bg-secondary/30"
                    }`}
                  >
                    <td className="p-3">
                      <button
                        onClick={() => toggleRunSelection(run.id)}
                        disabled={!isSelected && selectedRunIds.size >= MAX_COMPARE}
                        className="text-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>
                    </td>
                    <td className="p-3 text-small font-medium">{run.symbol}</td>
                    <td className="p-3 text-small">{run.interval}</td>
                    <td className="p-3 text-right">
                      <span className={`text-small font-medium ${
                        (run.totalReturnPct ?? 0) >= 0 ? "text-success" : "text-destructive"
                      }`}>
                        {formatPercent(run.totalReturnPct)}
                      </span>
                    </td>
                    <td className="p-3 text-right text-small text-muted-foreground">
                      {formatPercent(run.maxDrawdownPct)}
                    </td>
                    <td className="p-3 text-right text-small text-muted-foreground">
                      {formatPercent(run.winRatePct)}
                    </td>
                    <td className="p-3 text-right text-small text-muted-foreground">
                      {formatNumber(run.profitFactor)}
                    </td>
                    <td className="p-3 text-right text-small text-muted-foreground">
                      {run.tradeCount ?? "-"}
                    </td>
                    <td className="p-3 text-small text-muted-foreground max-w-xs">
                      {run.strategyParams && (
                        <div className="space-y-0.5 text-xs font-mono leading-tight">
                          <div>OR: {run.strategyParams.session.openingRangeMinutes}m</div>
                          <div>BrkBuf: {run.strategyParams.entry.breakoutBufferBps}bp</div>
                          <div>MaxTrd: {run.strategyParams.entry.maxTradesPerSession}</div>
                          <div>ATR: {run.strategyParams.atr.atrLength}</div>
                          <div>Risk: {run.strategyParams.risk.riskPctPerTrade}%</div>
                          <div>Stop: {run.strategyParams.risk.atrStopMultiple}x</div>
                          <div>TP: {run.strategyParams.risk.tpRMultiple}R</div>
                          <div>Trail: {run.strategyParams.risk.atrTrailMultiple}x</div>
                          <div>Fee: {run.strategyParams.execution.feeBps}bp</div>
                          <div>Slip: {run.strategyParams.execution.slippageBps}bp</div>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                        {run.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {runs.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No results found</p>
        </Card>
      )}
    </div>
  );
}


