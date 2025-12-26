import React from "react";

export type MetricCardProps = Readonly<{
  /** Metric label (e.g., "Total Return") */
  label: string;
  /** Main value to display */
  value: string;
  /** Optional subtext providing context */
  subtext?: string;
  /** Optional color for the value (uses CSS variable or direct color) */
  valueColor?: string;
  /** Optional icon or emoji to display before the subtext */
  icon?: string;
}>;

/**
 * A card component for displaying a single metric with label, value, and optional subtext.
 *
 * Usage:
 * ```tsx
 * <MetricCard
 *   label="Total Return"
 *   value="+15.3%"
 *   subtext="Strong performance"
 *   valueColor="var(--ok)"
 *   icon="🔥"
 * />
 * ```
 */
export function MetricCard(props: MetricCardProps): React.ReactElement {
  return (
    <div className="metricCard">
      <span className="metricLabel">{props.label}</span>
      <span className="metricValue" style={props.valueColor ? { color: props.valueColor } : undefined}>
        {props.value}
      </span>
      {props.subtext ? (
        <span className="metricSubtext">
          {props.icon ? `${props.icon} ` : ""}
          {props.subtext}
        </span>
      ) : null}
    </div>
  );
}



