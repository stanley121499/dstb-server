import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Settings, TrendingUp, BarChart3 } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { MetricCard } from "../components/design/MetricCard";
import { RunCard } from "../components/design/RunCard";
import { EmptyState } from "../components/layout/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { MetricCardSkeleton, RunCardSkeleton } from "../components/layout/LoadingState";
import { apiListBacktestRuns, type BacktestRunSummary } from "../lib/dstbApi";
import { useAuth } from "../auth/AuthProvider";

interface DashboardStats {
  totalRuns: number;
  thisWeekRuns: number;
  bestReturnPct: number | null;
  bestRunId: string | null;
  avgWinRate: number | null;
}

/**
 * Dashboard page - central hub for all backtesting activities.
 * Shows overview stats, quick actions, and recent runs.
 */
export function DashboardPage(): React.ReactElement {
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  
  const [stats, setStats] = useState<DashboardStats>({
    totalRuns: 0,
    thisWeekRuns: 0,
    bestReturnPct: null,
    bestRunId: null,
    avgWinRate: null,
  });
  
  const [recentRuns, setRecentRuns] = useState<readonly BacktestRunSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Load recent runs
      const runsPage = await apiListBacktestRuns(0, 5);
      setRecentRuns(runsPage.items);

      // Calculate stats from recent runs (temporary until backend endpoint is ready)
      const completed = runsPage.items.filter((r) => r.status === "completed");
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      const thisWeek = runsPage.items.filter((r) => new Date(r.createdAt) >= oneWeekAgo);
      
      let bestReturn = -Infinity;
      let bestId: string | null = null;
      let totalWinRate = 0;
      let winRateCount = 0;

      completed.forEach((run) => {
        if (run.totalReturnPct !== null && run.totalReturnPct > bestReturn) {
          bestReturn = run.totalReturnPct;
          bestId = run.id;
        }
        if (run.winRatePct !== null) {
          totalWinRate += run.winRatePct;
          winRateCount++;
        }
      });

      setStats({
        totalRuns: runsPage.total,
        thisWeekRuns: thisWeek.length,
        bestReturnPct: bestReturn === -Infinity ? null : bestReturn,
        bestRunId: bestId,
        avgWinRate: winRateCount > 0 ? totalWinRate / winRateCount : null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const formatPercent = (value: number | null): string => {
    if (value === null) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  };

  return (
    <div className="page-container">
      <PageHeader
        title={`Welcome back${authState.user?.email ? `, ${authState.user.email.split("@")[0]}` : ""}`}
        description="Your backtesting performance at a glance"
      />

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-small text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              label="Total Runs"
              value={stats.totalRuns}
              icon="📊"
              subtext="All time"
            />
            <MetricCard
              label="This Week"
              value={stats.thisWeekRuns}
              icon="📅"
              subtext="Last 7 days"
            />
            <MetricCard
              label="Best Return"
              value={formatPercent(stats.bestReturnPct)}
              valueColor={stats.bestReturnPct !== null && stats.bestReturnPct >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"}
              icon="🔥"
              subtext={stats.bestRunId ? "View best run" : "No completed runs yet"}
            />
            <MetricCard
              label="Avg Win Rate"
              value={formatPercent(stats.avgWinRate)}
              icon="🎯"
              subtext="Across all runs"
            />
          </>
        )}
      </div>

      {/* Quick Actions */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Button
              size="lg"
              className="h-auto py-6 flex-col items-start gap-2"
              onClick={() => navigate("/runs/new")}
            >
              <div className="flex items-center gap-2 text-left">
                <Play className="h-5 w-5" />
                <span className="font-semibold">Run New Backtest</span>
              </div>
              <span className="text-small font-normal opacity-90">
                Test your strategy against historical data
              </span>
            </Button>

            <Button
              size="lg"
              variant="secondary"
              className="h-auto py-6 flex-col items-start gap-2"
              onClick={() => navigate("/strategies")}
            >
              <div className="flex items-center gap-2 text-left">
                <Settings className="h-5 w-5" />
                <span className="font-semibold">Manage Strategies</span>
              </div>
              <span className="text-small font-normal opacity-90">
                Create and edit parameter sets
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Activity</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/runs">View All</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <RunCardSkeleton />
              <RunCardSkeleton />
            </div>
          ) : recentRuns.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-12 w-12" />}
              title="No runs yet"
              description="Get started by running your first backtest"
              action={
                <Button asChild>
                  <Link to="/runs/new">
                    <Play className="h-4 w-4 mr-2" />
                    Run First Backtest
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {recentRuns.map((run) => (
                <RunCard
                  key={run.id}
                  id={run.id}
                  name={run.parameterSetName || "Custom Strategy"}
                  symbol={run.symbol}
                  interval={run.interval}
                  status={run.status as "completed" | "running" | "queued" | "failed"}
                  createdAt={new Date(run.createdAt).toLocaleString()}
                  totalReturnPct={run.totalReturnPct}
                  tradeCount={run.tradeCount}
                  winRatePct={run.winRatePct}
                  maxDrawdownPct={run.maxDrawdownPct}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Strategies Widget - Coming Soon */}
      {stats.totalRuns > 5 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Performing Strategies</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={<BarChart3 className="h-10 w-10" />}
              title="Coming Soon"
              description="We're working on strategy performance analytics"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}



