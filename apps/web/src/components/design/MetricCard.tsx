import React from "react";
import { Card, CardContent } from "../ui/card";
import { cn } from "../../lib/utils";

export interface MetricCardProps {
  label: string;
  value: string | number;
  valueColor?: string;
  icon?: string;
  subtext?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

/**
 * Metric card component for displaying key statistics.
 * Redesigned with Apple-inspired clean aesthetics.
 */
export function MetricCard({ label, value, valueColor, icon, subtext, trend, className }: MetricCardProps): React.ReactElement {
  return (
    <Card className={cn("metric-card flex-1 min-w-[180px]", className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-3">
          <p className="text-caption text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
          {icon && <span className="text-xl">{icon}</span>}
        </div>
        
        <div className="flex items-baseline gap-2 mb-1">
          <p className={cn("metric-value", valueColor && `text-[${valueColor}]`)} style={valueColor ? { color: valueColor } : undefined}>
            {value}
          </p>
          {trend && (
            <span className={cn("text-small font-medium", trend.isPositive ? "text-success" : "text-destructive")}>
              {trend.isPositive ? "↗" : "↘"} {Math.abs(trend.value)}%
            </span>
          )}
        </div>
        
        {subtext && <p className="text-small text-muted-foreground">{subtext}</p>}
      </CardContent>
    </Card>
  );
}



