import React from "react";
import { Badge } from "../ui/badge";

export type RunStatus = "completed" | "running" | "queued" | "failed";

export interface StatusBadgeProps {
  status: RunStatus;
  className?: string;
}

/**
 * Status badge component for backtest run statuses.
 */
export function StatusBadge({ status, className }: StatusBadgeProps): React.ReactElement {
  const getVariantAndLabel = (): { variant: "success" | "warning" | "error" | "secondary"; label: string; icon: string } => {
    switch (status) {
      case "completed":
        return { variant: "success", label: "Completed", icon: "✓" };
      case "running":
        return { variant: "warning", label: "Running", icon: "⟳" };
      case "queued":
        return { variant: "warning", label: "Queued", icon: "⋯" };
      case "failed":
        return { variant: "error", label: "Failed", icon: "✕" };
      default:
        return { variant: "secondary", label: status, icon: "" };
    }
  };

  const { variant, label, icon } = getVariantAndLabel();

  return (
    <Badge variant={variant} className={className}>
      {icon && <span className="mr-1">{icon}</span>}
      {label}
    </Badge>
  );
}



