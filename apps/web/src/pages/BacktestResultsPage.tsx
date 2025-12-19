import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EquityCurveChart, type EquityCurveSeries } from "../components/EquityCurveChart";
import { JsonViewer } from "../components/JsonViewer";
import { formatNumber, formatPercent } from "../components/format";

import {
  apiGetBacktestRun,
  apiListEquity,
  apiListTrades,
  type BacktestRunDetail,
  type EquityPoint,
  type Trade
} from "../lib/dstbApi";

function badgeClassForStatus(status: string): string {
  if (status === "completed") {
    return "badge badgeOk";
  }

  if (status === "failed") {
    return "badge badgeErr";
  }

  return "badge badgeWarn";
}

/**
 * Backtest Results screen.
 */
export function BacktestResultsPage(): React.ReactElement {
  const params = useParams();
  const runId = params.runId ?? "";

  const [run, setRun] = useState<BacktestRunDetail | null>(null);
  const [equity, setEquity] = useState<readonly EquityPoint[]>([]);
  const [trades, setTrades] = useState<readonly Trade[]>([]);

  const [equityTotal, setEquityTotal] = useState<number>(0);
  const [tradesTotal, setTradesTotal] = useState<number>(0);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadRun = useCallback(async () => {
    if (runId.trim().length === 0) {
      setError("Missing runId");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const detail = await apiGetBacktestRun(runId);
      setRun(detail);

      if (detail.status === "failed" && detail.errorMessage) {
        setError(detail.errorMessage);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  const loadTrades = useCallback(
    async (offset: number) => {
      if (runId.trim().length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const page = await apiListTrades(runId, offset, 100);

        setTrades((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTradesTotal(page.total);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load trades");
      } finally {
        setIsLoading(false);
      }
    },
    [runId]
  );

  const loadEquity = useCallback(
    async (offset: number) => {
      if (runId.trim().length === 0) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const page = await apiListEquity(runId, offset, 500);

        setEquity((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setEquityTotal(page.total);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load equity");
      } finally {
        setIsLoading(false);
      }
    },
    [runId]
  );

  useEffect(() => {
    void loadRun();
    void loadTrades(0);
    void loadEquity(0);
  }, [loadEquity, loadRun, loadTrades]);

  const canLoadMoreTrades = useMemo(() => trades.length < tradesTotal, [trades.length, tradesTotal]);
  const canLoadMoreEquity = useMemo(() => equity.length < equityTotal, [equity.length, equityTotal]);

  const equitySeries = useMemo<readonly EquityCurveSeries[]>(() => {
    return [
      {
        label: "Equity",
        color: "rgba(96, 165, 250, 0.95)",
        points: equity
      }
    ];
  }, [equity]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="col">
          <p className="h1" style={{ marginBottom: 2 }}>
            Backtest Results
          </p>
          <span className="muted">Run ID: {runId}</span>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <Link className="btn" to="/run">
            Run another
          </Link>
          <button className="btn" type="button" onClick={() => void loadRun()} disabled={isLoading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="hr" />

      {error ? <div className="errorBox" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardHeader">
          <p className="h2">Summary</p>
        </div>
        <div className="cardBody">
          {run ? (
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="col" style={{ gap: 6 }}>
                <span className={badgeClassForStatus(run.status)}>{run.status}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {`${run.symbol} | ${run.interval} | ${run.startTimeUtc} → ${run.endTimeUtc}`}
                </span>
              </div>

              <div className="row" style={{ gap: 12 }}>
                <div className="col" style={{ minWidth: 140 }}>
                  <span className="label">Trades</span>
                  <span>{run.tradeCount ?? "-"}</span>
                </div>
                <div className="col" style={{ minWidth: 140 }}>
                  <span className="label">Total return</span>
                  <span>{formatPercent(run.totalReturnPct)}</span>
                </div>
                <div className="col" style={{ minWidth: 140 }}>
                  <span className="label">Max drawdown</span>
                  <span>{formatPercent(run.maxDrawdownPct)}</span>
                </div>
                <div className="col" style={{ minWidth: 140 }}>
                  <span className="label">Win rate</span>
                  <span>{formatPercent(run.winRatePct)}</span>
                </div>
                <div className="col" style={{ minWidth: 140 }}>
                  <span className="label">Profit factor</span>
                  <span>{formatNumber(run.profitFactor)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="muted">Loading...</div>
          )}
        </div>
      </div>

      <EquityCurveChart series={equitySeries} />

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10, marginBottom: 12 }}>
        <button className="btn" type="button" onClick={() => void loadEquity(equity.length)} disabled={!canLoadMoreEquity || isLoading}>
          {isLoading ? "Loading..." : "Load more equity"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardHeader">
          <p className="h2">Trades</p>
        </div>
        <div className="cardBody">
          <table className="table">
            <thead>
              <tr>
                <th>Session (NY)</th>
                <th>Dir</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Qty</th>
                <th>Fee</th>
                <th>PnL</th>
                <th>R</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{t.sessionDateNy}</td>
                  <td>{t.direction}</td>
                  <td className="muted">{`${t.entryTimeUtc} @ ${t.entryPrice}`}</td>
                  <td className="muted">{`${t.exitTimeUtc} @ ${t.exitPrice}`}</td>
                  <td className="muted">{t.quantity}</td>
                  <td className="muted">{t.feeTotal}</td>
                  <td style={{ color: t.pnl >= 0 ? "var(--ok)" : "var(--danger)" }}>{t.pnl}</td>
                  <td className="muted">{t.rMultiple === null ? "-" : t.rMultiple.toFixed(2)}</td>
                  <td className="muted">{t.exitReason}</td>
                </tr>
              ))}

              {trades.length === 0 && isLoading ? (
                <tr>
                  <td colSpan={9} className="muted">
                    Loading...
                  </td>
                </tr>
              ) : null}

              {trades.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No trades.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>{`Showing ${trades.length} of ${tradesTotal}`}</span>
            <button className="btn" type="button" onClick={() => void loadTrades(trades.length)} disabled={!canLoadMoreTrades || isLoading}>
              {isLoading ? "Loading..." : "Load more trades"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Run config (JSON)</p>
        </div>
        <div className="cardBody">
          <JsonViewer value={run ? run.paramsSnapshot : null} />
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}
