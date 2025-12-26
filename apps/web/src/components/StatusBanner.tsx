import React from "react";

export type StatusBannerProps = Readonly<{
  /** Current backtest status */
  status: "queued" | "running" | "completed" | "failed";
  /** Optional message to display */
  message?: string;
  /** Optional error message (shown for failed status) */
  errorMessage?: string;
}>;

/**
 * Banner component showing backtest execution status with appropriate styling.
 *
 * Usage:
 * ```tsx
 * <StatusBanner
 *   status="running"
 *   message="Your backtest is being processed. This page will auto-update."
 * />
 * ```
 */
export function StatusBanner(props: StatusBannerProps): React.ReactElement {
  const { status, message, errorMessage } = props;

  const statusText: Record<typeof status, string> = {
    queued: "Queued",
    running: "Running...",
    completed: "Completed",
    failed: "Failed"
  };

  const statusClass =
    status === "running"
      ? "statusBannerRunning"
      : status === "completed"
        ? "statusBannerCompleted"
        : status === "failed"
          ? "statusBannerFailed"
          : "";

  const defaultMessage =
    status === "running"
      ? "Your backtest is being processed. This page will auto-update."
      : status === "queued"
        ? "Your backtest is queued and will start shortly."
        : status === "completed"
          ? "Backtest completed successfully."
          : "Backtest execution failed.";

  const displayMessage = status === "failed" && errorMessage ? errorMessage : message ?? defaultMessage;

  return (
    <div className={`statusBanner ${statusClass}`}>
      {status === "running" ? <div className="spinner" /> : null}
      <span className="badge">{statusText[status]}</span>
      <span style={{ flex: 1 }}>{displayMessage}</span>
    </div>
  );
}



