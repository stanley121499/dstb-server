import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X, TrendingUp, RefreshCw, Plus } from "lucide-react";

import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { EquityCurveChart, type EquityCurveSeries } from "../components/EquityCurveChart";
import { formatNumber, formatPercent } from "../components/format";

import {
  apiCompareRuns,
  apiListBacktestRuns,
  apiListEquity,
  apiGetBacktestRun,
  type BacktestCompareResponse,
  type BacktestRunSummary,
  type EquityPoint
} from "../lib/dstbApi";

type CompareMetric = "totalReturnPct" | "maxDrawdownPct" | "winRatePct" | "profitFactor" | "tradeCount";

const METRIC_OPTIONS: readonly { value: CompareMetric; label: string }[] = [
  { value: "totalReturnPct", label: "Total return %" },
  { value: "maxDrawdownPct", label: "Max drawdown %" },
  { value: "winRatePct", label: "Win rate %" },
  { value: "profitFactor", label: "Profit factor" },
  { value: "tradeCount", label: "Trade count" }
] as const;

function metricValue(row: BacktestCompareResponse["rows"][number], metric: CompareMetric): number | null {
  const m = row.metrics;

  if (metric === "totalReturnPct") {
    return m.totalReturnPct;
  }

  if (metric === "maxDrawdownPct") {
    return m.maxDrawdownPct;
  }

  if (metric === "winRatePct") {
    return m.winRatePct;
  }

  if (metric === "profitFactor") {
    return m.profitFactor;
  }

  return m.tradeCount;
}

function pickBest(rows: readonly BacktestCompareResponse["rows"][number][], metric: CompareMetric): BacktestCompareResponse["rows"][number] | null {
  const candidates = rows
    .map((r) => ({ r, v: metricValue(r, metric) }))
    .filter((x): x is { r: BacktestCompareResponse["rows"][number]; v: number } => typeof x.v === "number" && Number.isFinite(x.v));

  if (candidates.length === 0) {
    return null;
  }

  // For these metrics, "higher is better". For drawdown, higher (less negative) is better.
  candidates.sort((a, b) => b.v - a.v);
  const first = candidates[0];
  return first === undefined ? null : first.r;
}

function buildSeriesFromEquity(runId: string, points: readonly EquityPoint[], label: string, color: string): EquityCurveSeries {
  const normalized = points.filter((p) => Number.isFinite(p.equity));

  return {
    label,
    color,
    points: normalized
  };
}

/**
 * Compare Runs page - select and compare multiple backtest runs.
 */
export function CompareRunsPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  
  const [runs, setRuns] = useState<readonly BacktestRunSummary[]>([]);
  
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRuns, setSelectedRuns] = useState<readonly BacktestRunSummary[]>([]);
  const [compare, setCompare] = useState<BacktestCompareResponse | null>(null);
  const [bestMetric, setBestMetric] = useState<CompareMetric>("totalReturnPct");
  const [overlayEquity, setOverlayEquity] = useState<boolean>(true);

  const [equitySeries, setEquitySeries] = useState<readonly EquityCurveSeries[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const MAX_RUNS = 4;

  const loadRuns = useCallback(
    async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Load completed runs only (most useful for comparison)
        const page = await apiListBacktestRuns(0, 100);
        const completedRuns = page.items.filter((r) => r.status === "completed");
        setRuns(completedRuns);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load runs");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Load runs from URL query parameter (e.g., from optimization results)
  useEffect(() => {
    const runIdsParam = searchParams.get("runIds");
    if (!runIdsParam) {
      return;
    }

    const runIds = runIdsParam.split(",").filter((id) => id.trim().length > 0);
    if (runIds.length === 0) {
      return;
    }

    let cancelled = false;
    setIsLoadingFromUrl(true);
    setError(null);

    void Promise.all(
      runIds.slice(0, MAX_RUNS).map(async (id) => {
        try {
          const run = await apiGetBacktestRun(id);
          const summary: BacktestRunSummary = {
            id: run.id,
            createdAt: run.createdAt,
            status: run.status,
            symbol: run.symbol,
            interval: run.interval,
            startTimeUtc: run.startTimeUtc,
            endTimeUtc: run.endTimeUtc,
            tradeCount: run.tradeCount,
            totalReturnPct: run.totalReturnPct,
            maxDrawdownPct: run.maxDrawdownPct,
            winRatePct: run.winRatePct,
            profitFactor: run.profitFactor
          };
          return summary;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }

      const validRuns = results.filter((r): r is BacktestRunSummary => r !== null);
      if (validRuns.length > 0) {
        setSelectedRuns(validRuns);
      }
      setIsLoadingFromUrl(false);
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load runs from URL");
        setIsLoadingFromUrl(false);
      }
    });

    return () => {
      cancelled = true;
      setIsLoadingFromUrl(false);
    };
  }, [searchParams, MAX_RUNS]);

  const addRun = useCallback((run: BacktestRunSummary) => {
    setSelectedRuns((prev) => {
      if (prev.some((r) => r.id === run.id)) {
        return prev;
      }
      if (prev.length >= MAX_RUNS) {
        return prev;
      }
      return [...prev, run];
    });
    setSearchQuery("");
  }, [MAX_RUNS]);

  const removeRun = useCallback((runId: string) => {
    setSelectedRuns((prev) => prev.filter((r) => r.id !== runId));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedRuns([]);
    setCompare(null);
    setEquitySeries([]);
  }, []);

  const onCompare = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setCompare(null);
    setEquitySeries([]);

    const selectedIds = selectedRuns.map((r) => r.id);

    if (selectedIds.length < 2) {
      setError("Select at least 2 runs to compare");
      setIsLoading(false);
      return;
    }

    try {
      const resp = await apiCompareRuns(selectedIds);
      setCompare(resp);

      if (overlayEquity) {
        const palette: readonly string[] = [
          "rgba(96, 165, 250, 0.95)",
          "rgba(52, 211, 153, 0.95)",
          "rgba(251, 191, 36, 0.95)",
          "rgba(248, 113, 113, 0.95)"
        ];

        const rowsById = new Map(resp.rows.map((r) => [r.runId, r] as const));

        const series = await Promise.all(
          selectedIds.map(async (id, idx) => {
            const eq = await apiListEquity(id, 0, 500);
            const row = rowsById.get(id);
            const label = row ? `${row.symbol} ${row.interval} (${id.slice(0, 8)})` : id;
            const color = palette[idx % palette.length] ?? "rgba(96, 165, 250, 0.95)";
            return buildSeriesFromEquity(id, eq.items, label, color);
          })
        );

        setEquitySeries(series);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setIsLoading(false);
    }
  }, [overlayEquity, selectedRuns]);

  const bestRow = useMemo(() => {
    if (!compare) {
      return null;
    }

    return pickBest(compare.rows, bestMetric);
  }, [bestMetric, compare]);

  // Filter runs by search query
  const filteredRuns = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }
    
    const query = searchQuery.toLowerCase();
    const alreadySelected = new Set(selectedRuns.map((r) => r.id));
    
    return runs
      .filter((r) => !alreadySelected.has(r.id))
      .filter((r) =>
        r.id.toLowerCase().includes(query) ||
        r.symbol.toLowerCase().includes(query) ||
        r.interval.toLowerCase().includes(query) ||
        (r.parameterSetName && r.parameterSetName.toLowerCase().includes(query))
      )
      .slice(0, 10); // Show max 10 results
  }, [runs, searchQuery, selectedRuns]);

  const canCompare = selectedRuns.length >= 2;
  const canAddMore = selectedRuns.length < MAX_RUNS;

  return (
    <div className="page-container">
      <PageHeader
        title="Compare Runs"
        description="Select up to 4 runs to compare metrics and overlay equity curves"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void loadRuns()} disabled={isLoading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button onClick={() => void onCompare()} disabled={isLoading || !canCompare}>
              <TrendingUp className="h-4 w-4 mr-2" />
              {isLoading ? "Comparing..." : "Compare"}
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5 p-4">
          <p className="text-small text-destructive">{error}</p>
        </Card>
      )}

      {isLoadingFromUrl && (
        <Card className="mb-6 border-primary/50 bg-primary/5 p-4">
          <p className="text-small text-foreground">Loading optimization results... Please wait.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Run Selection */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Selected Runs</CardTitle>
                  <CardDescription className="mt-1">
                    {selectedRuns.length === 0
                      ? "Search and add runs to compare"
                      : `${selectedRuns.length} of ${MAX_RUNS} runs selected`}
                  </CardDescription>
                </div>
                {selectedRuns.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    Clear All
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search Input */}
              {canAddMore && (
                <div className="space-y-2">
                  <Label htmlFor="search-runs">Search runs</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search-runs"
                      placeholder="Search by ID, symbol, interval, or strategy name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  
                  {/* Search Results Dropdown */}
                  {filteredRuns.length > 0 && (
                    <Card className="border-primary/20">
                      <CardContent className="p-2">
                        <div className="space-y-1">
                          {filteredRuns.map((run) => (
                            <button
                              key={run.id}
                              onClick={() => addRun(run)}
                              className="w-full flex items-center justify-between p-3 rounded-sm hover:bg-secondary transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline">{run.symbol}</Badge>
                                  <Badge variant="outline">{run.interval}</Badge>
                                  {run.parameterSetName && (
                                    <span className="text-small text-muted-foreground truncate">
                                      {run.parameterSetName}
                                    </span>
                                  )}
                                </div>
                                <p className="text-caption text-muted-foreground truncate">
                                  {run.id.slice(0, 16)}... · {new Date(run.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                              <div className="text-right ml-4">
                                <p className={`text-small font-medium ${
                                  (run.totalReturnPct ?? 0) >= 0 ? "text-success" : "text-destructive"
                                }`}>
                                  {formatPercent(run.totalReturnPct)}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Selected Runs List */}
              {selectedRuns.length > 0 ? (
                <div className="space-y-2">
                  {selectedRuns.map((run, idx) => (
                    <Card key={run.id} className="border-primary/30">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="secondary">#{idx + 1}</Badge>
                              <Badge variant="outline">{run.symbol}</Badge>
                              <Badge variant="outline">{run.interval}</Badge>
                            </div>
                            {run.parameterSetName && (
                              <p className="text-small font-medium mb-1">{run.parameterSetName}</p>
                            )}
                            <p className="text-caption text-muted-foreground truncate mb-2">
                              {run.id}
                            </p>
                            <div className="flex gap-4 text-small">
                              <div>
                                <span className="text-muted-foreground">Return: </span>
                                <span className={`font-medium ${
                                  (run.totalReturnPct ?? 0) >= 0 ? "text-success" : "text-destructive"
                                }`}>
                                  {formatPercent(run.totalReturnPct)}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Trades: </span>
                                <span>{run.tradeCount ?? "-"}</span>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRun(run.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Plus className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No runs selected</p>
                  <p className="text-small text-muted-foreground">
                    Use the search above to find and add runs
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Options Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Comparison Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="best-metric">Best Run Metric</Label>
                <Select value={bestMetric} onValueChange={(v) => setBestMetric(v as CompareMetric)}>
                  <SelectTrigger id="best-metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METRIC_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-caption text-muted-foreground">
                  Highlights the best performing run
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="overlay-equity">Overlay Equity Curves</Label>
                  <button
                    id="overlay-equity"
                    onClick={() => setOverlayEquity(!overlayEquity)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      overlayEquity ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        overlayEquity ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-caption text-muted-foreground">
                  Shows equity chart overlay (first 500 points per run)
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Comparison Results */}
      {compare && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Metrics Comparison</CardTitle>
                {bestRow && (
                  <CardDescription className="mt-1">
                    Best by {METRIC_OPTIONS.find((o) => o.value === bestMetric)?.label.toLowerCase() ?? "metric"}: {bestRow.runId.slice(0, 16)}...
                  </CardDescription>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-3 text-small font-semibold">Run</th>
                    <th className="pb-3 text-small font-semibold">Status</th>
                    <th className="pb-3 text-small font-semibold">Symbol</th>
                    <th className="pb-3 text-small font-semibold">Interval</th>
                    <th className="pb-3 text-small font-semibold">Total Return</th>
                    <th className="pb-3 text-small font-semibold">Max DD</th>
                    <th className="pb-3 text-small font-semibold">Win Rate</th>
                    <th className="pb-3 text-small font-semibold">PF</th>
                    <th className="pb-3 text-small font-semibold">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {compare.rows.map((row) => {
                    const isBest = bestRow?.runId === row.runId;

                    return (
                      <tr
                        key={row.runId}
                        className={`border-b border-border last:border-0 transition-colors ${
                          isBest ? "bg-primary/5 border-primary/30" : "hover:bg-muted/30"
                        }`}
                      >
                        <td className="py-4 text-small text-muted-foreground font-mono truncate max-w-[120px]">
                          {row.runId.slice(0, 16)}...
                        </td>
                        <td className="py-4">
                          <Badge variant="outline">{row.status}</Badge>
                        </td>
                        <td className="py-4 text-small">{row.symbol}</td>
                        <td className="py-4 text-small">{row.interval}</td>
                        <td className="py-4">
                          <span className={`text-small font-medium ${
                            (row.metrics.totalReturnPct ?? 0) >= 0 ? "text-success" : "text-destructive"
                          }`}>
                            {formatPercent(row.metrics.totalReturnPct)}
                          </span>
                        </td>
                        <td className="py-4 text-small text-muted-foreground">
                          {formatPercent(row.metrics.maxDrawdownPct)}
                        </td>
                        <td className="py-4 text-small text-muted-foreground">
                          {formatPercent(row.metrics.winRatePct)}
                        </td>
                        <td className="py-4 text-small text-muted-foreground">
                          {formatNumber(row.metrics.profitFactor)}
                        </td>
                        <td className="py-4 text-small text-muted-foreground">
                          {row.metrics.tradeCount ?? "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Equity Overlay Chart */}
      {overlayEquity && equitySeries.length > 0 && <EquityCurveChart series={equitySeries} />}
    </div>
  );
}




