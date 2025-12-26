import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { StatusBadge, type RunStatus } from "./StatusBadge";
import { cn } from "../../lib/utils";

export interface RunCardProps {
  id: string;
  name: string;
  symbol: string;
  interval: string;
  status: RunStatus;
  createdAt: string;
  totalReturnPct?: number | null;
  tradeCount?: number | null;
  winRatePct?: number | null;
  maxDrawdownPct?: number | null;
  errorMessage?: string | null;
  progress?: number; // 0-100 for running backtests
  className?: string;
  actions?: {
    onClone?: () => void;
    onDelete?: () => void;
    onCancel?: () => void;
    onRetry?: () => void;
  };
}

/**
 * Run card component for displaying backtest run summaries.
 */
export function RunCard({
  id,
  name,
  symbol,
  interval,
  status,
  createdAt,
  totalReturnPct,
  tradeCount,
  winRatePct,
  maxDrawdownPct,
  errorMessage,
  progress,
  className,
  actions,
}: RunCardProps): React.ReactElement {
  const formatReturn = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  };

  const getReturnColor = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "text-foreground";
    return value >= 0 ? "text-success" : "text-destructive";
  };

  return (
    <Card className={cn("hover:shadow-md transition-all duration-150", className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="mb-2 flex items-center gap-2">
              <span className="truncate">{name}</span>
              <StatusBadge status={status} />
            </CardTitle>
            <CardDescription className="space-y-1">
              <div>
                {symbol} • {interval} • {createdAt}
              </div>
              {status === "completed" && (
                <div className="flex gap-4 mt-2 text-small">
                  <span className={getReturnColor(totalReturnPct)}>{formatReturn(totalReturnPct)}</span>
                  <span>{tradeCount ?? 0} trades</span>
                  {winRatePct !== null && winRatePct !== undefined && <span>{winRatePct.toFixed(0)}% win rate</span>}
                  {maxDrawdownPct !== null && maxDrawdownPct !== undefined && <span className="text-destructive">-{Math.abs(maxDrawdownPct).toFixed(2)}% max DD</span>}
                </div>
              )}
              {status === "running" && progress !== undefined && (
                <div className="mt-2">
                  <div className="flex justify-between text-caption text-muted-foreground mb-1">
                    <span>Processing...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300 ease-out" 
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              {status === "failed" && errorMessage && (
                <div className="mt-2 text-small text-destructive">
                  Error: {errorMessage}
                </div>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link to={`/runs/${id}`}>
              {status === "running" ? "View Live" : "View Results"}
            </Link>
          </Button>

          {status === "completed" && actions?.onClone && (
            <Button size="sm" variant="ghost" onClick={actions.onClone}>
              Clone
            </Button>
          )}

          {status === "running" && actions?.onCancel && (
            <Button size="sm" variant="ghost" onClick={actions.onCancel}>
              Cancel
            </Button>
          )}

          {status === "failed" && actions?.onRetry && (
            <Button size="sm" variant="ghost" onClick={actions.onRetry}>
              Retry
            </Button>
          )}

          {(status === "completed" || status === "failed") && actions?.onDelete && (
            <Button size="sm" variant="ghost" onClick={actions.onDelete} className="text-destructive hover:text-destructive">
              Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}



