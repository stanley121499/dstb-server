/**
 * Normalized trade row for analytics (Phase 3).
 */
export type AnalyticsTrade = Readonly<{
  id: string;
  configId: string;
  configName: string;
  strategy: string;
  initialBalance: number;
  pnl: number;
  exitTimeMs: number;
  exitTimeIso: string;
  rMultiple: number | null;
}>;

/**
 * One point on an equity or drawdown series (Lightweight Charts: `time` = UTC seconds).
 */
export type SeriesPoint = Readonly<{
  timeUtcSec: number;
  value: number;
}>;

/**
 * Aggregated stats for a set of trades.
 */
export type TradeStatsBlock = Readonly<{
  tradeCount: number;
  winRatePct: number;
  avgPnl: number;
  profitFactor: number | null;
  avgRMultiple: number | null;
  grossProfit: number;
  grossLoss: number;
  maxDrawdownPct: number | null;
  sharpeDailyPnl: number | null;
}>;
