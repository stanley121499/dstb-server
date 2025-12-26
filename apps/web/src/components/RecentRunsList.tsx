import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { formatPercent } from "./format";
import { cn } from "../lib/utils";

export type RecentRun = Readonly<{
  id: string;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
  symbol: string;
  interval: string;
  totalReturnPct: number | null;
  tradeCount: number | null;
}>;

export type RecentRunsListProps = Readonly<{
  runs: readonly RecentRun[];
  isLoading?: boolean;
}>;

/**
 * Displays a list of recent backtest runs with quick access links.
 * Redesigned with modern card-based layout and status badges.
 */
export function RecentRunsList(props: RecentRunsListProps): React.ReactElement {
  const getStatusVariant = (status: string): "success" | "warning" | "error" | "secondary" => {
    if (status === "completed") return "success";
    if (status === "running" || status === "queued") return "warning";
    if (status === "failed") return "error";
    return "secondary";
  };

  if (props.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>Your last 5 backtests</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (props.runs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>Your last 5 backtests</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-small text-muted-foreground text-center py-8">
            No recent runs yet. Run your first backtest to see results here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Runs</CardTitle>
        <CardDescription>Your last {props.runs.length} backtests</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {props.runs.map((run) => {
          const returnColor =
            run.totalReturnPct !== null && run.totalReturnPct >= 0
              ? "text-success"
              : "text-destructive";

          return (
            <Link
              key={run.id}
              to={`/runs/${run.id}`}
              className={cn(
                "block p-3 rounded-sm border border-transparent",
                "hover:bg-secondary hover:border-border transition-all duration-150"
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge variant={getStatusVariant(run.status)}>
                  {run.status}
                </Badge>
                {run.totalReturnPct !== null && (
                  <span className={cn("text-small font-semibold", returnColor)}>
                    {formatPercent(run.totalReturnPct)}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-small font-medium">
                  {run.symbol} • {run.interval}
                </p>
                {run.tradeCount !== null && (
                  <p className="text-caption text-muted-foreground">
                    {run.tradeCount} trades
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}



