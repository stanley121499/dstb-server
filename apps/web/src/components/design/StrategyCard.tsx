import React from "react";
import { Card, CardContent } from "../ui/card";
import { cn } from "../../lib/utils";

export interface StrategyCardProps {
  name: string;
  description: string;
  onClick?: () => void;
  icon?: string;
  stats?: {
    avgReturn?: number;
    runCount?: number;
  };
  className?: string;
}

/**
 * Strategy card component for displaying strategy templates and saved strategies.
 */
export function StrategyCard({ name, description, onClick, icon, stats, className }: StrategyCardProps): React.ReactElement {
  return (
    <Card 
      className={cn(
        "cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-150 group",
        onClick && "hover:translate-y-[-2px]",
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-start gap-3 mb-3">
          {icon && <span className="text-2xl flex-shrink-0">{icon}</span>}
          <div className="flex-1 min-w-0">
            <h4 className="text-h3 font-semibold mb-1 group-hover:text-primary transition-colors">{name}</h4>
            <p className="text-small text-muted-foreground line-clamp-2">{description}</p>
          </div>
        </div>
        
        {stats && (stats.avgReturn !== undefined || stats.runCount !== undefined) && (
          <div className="flex gap-4 pt-3 border-t border-border text-small">
            {stats.avgReturn !== undefined && (
              <div>
                <span className="text-muted-foreground">Avg return: </span>
                <span className={cn("font-medium", stats.avgReturn >= 0 ? "text-success" : "text-destructive")}>
                  {stats.avgReturn >= 0 ? "+" : ""}{stats.avgReturn.toFixed(1)}%
                </span>
              </div>
            )}
            {stats.runCount !== undefined && (
              <div>
                <span className="text-muted-foreground">{stats.runCount} runs</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}



