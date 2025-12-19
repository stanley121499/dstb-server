import type { StrategyParams } from "./strategyParams.js";

export type ParameterSet = Readonly<{
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description: string | null;
  paramsVersion: string;
  params: StrategyParams;
}>;

export type BacktestRunStatus = "queued" | "running" | "completed" | "failed";

export type BacktestRun = Readonly<{
  id: string;
  createdAt: string;
  status: BacktestRunStatus;
  parameterSetId: string | null;

  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  initialEquity: number;

  finalEquity: number | null;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  tradeCount: number | null;

  errorMessage: string | null;
}>;

export type BacktestRunSummary = Readonly<{
  id: string;
  createdAt: string;
  status: BacktestRunStatus;
  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  tradeCount: number | null;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
}>;

export type TradeDirection = "long" | "short";

export type TradeExitReason = "stop" | "take_profit" | "time_exit" | "session_end" | "manual";

export type Trade = Readonly<{
  id: string;
  runId: string;
  sessionDateNy: string; // YYYY-MM-DD
  direction: TradeDirection;
  entryTimeUtc: string;
  entryPrice: number;
  exitTimeUtc: string;
  exitPrice: number;
  quantity: number;
  feeTotal: number;
  pnl: number;
  rMultiple: number | null;
  exitReason: TradeExitReason;
}>;

export type EquityPoint = Readonly<{
  timeUtc: string;
  equity: number;
}>;

export type BacktestCompareResponse = Readonly<{
  rows: readonly Readonly<{
    runId: string;
    createdAt: string;
    symbol: string;
    interval: string;
    status: BacktestRunStatus;
    metrics: Readonly<{
      totalReturnPct: number | null;
      maxDrawdownPct: number | null;
      winRatePct: number | null;
      profitFactor: number | null;
      tradeCount: number | null;
    }>;
  }>[];
}>;

