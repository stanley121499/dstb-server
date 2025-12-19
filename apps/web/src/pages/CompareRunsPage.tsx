import React, { useCallback, useEffect, useMemo, useState } from "react";

import { EquityCurveChart, type EquityCurveSeries } from "../components/EquityCurveChart";
import { SelectField } from "../components/SelectField";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { formatNumber, formatPercent } from "../components/format";

import {
  apiCompareRuns,
  apiListBacktestRuns,
  apiListEquity,
  type BacktestCompareResponse,
  type BacktestRunSummary,
  type EquityPoint
} from "../lib/dstbApi";

type CompareMetric = "totalReturnPct" | "maxDrawdownPct" | "winRatePct" | "profitFactor" | "tradeCount";

const METRIC_OPTIONS: readonly { value: CompareMetric; label: string }[] = [
  { value: "totalReturnPct", label: "Total return %" },
  { value: "maxDrawdownPct", label: "Max drawdown %" },
  { value: "winRatePct", label: "Win rate %" },
  { value: "profitFactor", label: "Profit factor" },
  { value: "tradeCount", label: "Trade count" }
] as const;

function metricValue(row: BacktestCompareResponse["rows"][number], metric: CompareMetric): number | null {
  const m = row.metrics;

  if (metric === "totalReturnPct") {
    return m.totalReturnPct;
  }

  if (metric === "maxDrawdownPct") {
    return m.maxDrawdownPct;
  }

  if (metric === "winRatePct") {
    return m.winRatePct;
  }

  if (metric === "profitFactor") {
    return m.profitFactor;
  }

  return m.tradeCount;
}

function pickBest(rows: readonly BacktestCompareResponse["rows"][number][], metric: CompareMetric): BacktestCompareResponse["rows"][number] | null {
  const candidates = rows
    .map((r) => ({ r, v: metricValue(r, metric) }))
    .filter((x): x is { r: BacktestCompareResponse["rows"][number]; v: number } => typeof x.v === "number" && Number.isFinite(x.v));

  if (candidates.length === 0) {
    return null;
  }

  // For these metrics, "higher is better". For drawdown, higher (less negative) is better.
  candidates.sort((a, b) => b.v - a.v);
  const first = candidates[0];
  return first === undefined ? null : first.r;
}

function buildSeriesFromEquity(runId: string, points: readonly EquityPoint[], label: string, color: string): EquityCurveSeries {
  const normalized = points.filter((p) => Number.isFinite(p.equity));

  return {
    label,
    color,
    points: normalized
  };
}

/**
 * Compare Runs screen.
 */
export function CompareRunsPage(): React.ReactElement {
  const [runs, setRuns] = useState<readonly BacktestRunSummary[]>([]);
  const [runsTotal, setRunsTotal] = useState<number>(0);
  const [runsOffset, setRunsOffset] = useState<number>(0);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [compare, setCompare] = useState<BacktestCompareResponse | null>(null);
  const [bestMetric, setBestMetric] = useState<CompareMetric>("totalReturnPct");
  const [overlayEquity, setOverlayEquity] = useState<boolean>(true);

  const [equitySeries, setEquitySeries] = useState<readonly EquityCurveSeries[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canLoadMore = useMemo(() => runs.length < runsTotal, [runs.length, runsTotal]);

  const loadRuns = useCallback(
    async (offset: number) => {
      setIsLoading(true);
      setError(null);

      try {
        const page = await apiListBacktestRuns(offset, 50);

        setRuns((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setRunsTotal(page.total);
        setRunsOffset(page.offset);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load runs");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadRuns(0);
  }, [loadRuns]);

  const toggleSelected = useCallback((runId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        return prev.includes(runId) ? prev : [...prev, runId];
      }

      return prev.filter((id) => id !== runId);
    });
  }, []);

  const onCompare = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setCompare(null);
    setEquitySeries([]);

    if (selectedIds.length < 2) {
      setError("Select at least 2 runs to compare");
      setIsLoading(false);
      return;
    }

    try {
      const resp = await apiCompareRuns(selectedIds);
      setCompare(resp);

      if (overlayEquity) {
        const palette: readonly string[] = [
          "rgba(96, 165, 250, 0.95)",
          "rgba(52, 211, 153, 0.95)",
          "rgba(251, 191, 36, 0.95)",
          "rgba(248, 113, 113, 0.95)",
          "rgba(167, 139, 250, 0.95)",
          "rgba(94, 234, 212, 0.95)"
        ];

        const rowsById = new Map(resp.rows.map((r) => [r.runId, r] as const));

        const series = await Promise.all(
          selectedIds.map(async (id, idx) => {
            const eq = await apiListEquity(id, 0, 500);
            const row = rowsById.get(id);
            const label = row ? `${row.symbol} ${row.interval} (${id.slice(0, 8)})` : id;
            const color = palette[idx % palette.length] ?? "rgba(96, 165, 250, 0.95)";
            return buildSeriesFromEquity(id, eq.items, label, color);
          })
        );

        setEquitySeries(series);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setIsLoading(false);
    }
  }, [overlayEquity, selectedIds]);

  const bestRow = useMemo(() => {
    if (!compare) {
      return null;
    }

    return pickBest(compare.rows, bestMetric);
  }, [bestMetric, compare]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="col">
          <p className="h1" style={{ marginBottom: 2 }}>
            Compare Runs
          </p>
          <span className="muted">Select multiple runs, compare metrics, optionally overlay equity curves.</span>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="button" onClick={() => void loadRuns(0)} disabled={isLoading}>
            Refresh
          </button>
          <button className="btn btnPrimary" type="button" onClick={() => void onCompare()} disabled={isLoading}>
            {isLoading ? "Comparing..." : "Compare"}
          </button>
        </div>
      </div>

      <div className="hr" />

      {error ? <div className="errorBox" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardHeader">
          <p className="h2">Run picker</p>
        </div>
        <div className="cardBody">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>{`Selected: ${selectedIds.length}`}</span>
            <button className="btn" type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0 || isLoading}>
              Clear
            </button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Created</th>
                <th>Status</th>
                <th>Symbol</th>
                <th>Interval</th>
                <th>Range</th>
                <th>Total return</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const checked = selectedIds.includes(r.id);

                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(ev) => toggleSelected(r.id, ev.target.checked)}
                        aria-label={`Select run ${r.id}`}
                      />
                    </td>
                    <td className="muted">{r.createdAt}</td>
                    <td>
                      <span className="badge">{r.status}</span>
                    </td>
                    <td className="muted">{r.symbol}</td>
                    <td className="muted">{r.interval}</td>
                    <td className="muted">{`${r.startTimeUtc} → ${r.endTimeUtc}`}</td>
                    <td className="muted">{formatPercent(r.totalReturnPct)}</td>
                  </tr>
                );
              })}

              {runs.length === 0 && isLoading ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Loading...
                  </td>
                </tr>
              ) : null}

              {runs.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No runs found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>{`Showing ${runs.length} of ${runsTotal}`}</span>
            <button className="btn" type="button" onClick={() => void loadRuns(runsOffset + runs.length)} disabled={!canLoadMore || isLoading}>
              {isLoading ? "Loading..." : "Load more"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardHeader">
          <p className="h2">Compare options</p>
        </div>
        <div className="cardBody">
          <div className="row" style={{ alignItems: "center" }}>
            <SelectField<CompareMetric> label="Best run metric" value={bestMetric} options={METRIC_OPTIONS} onChange={setBestMetric} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <ToggleSwitch
                label="Overlay equity curves"
                checked={overlayEquity}
                onChange={setOverlayEquity}
                description="Fetches equity for each selected run (first 500 points)."
              />
            </div>
          </div>
        </div>
      </div>

      {compare ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardHeader">
            <p className="h2">Metrics comparison</p>
            {bestRow ? (
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {`Best by ${bestMetric}: ${bestRow.runId}`}
              </p>
            ) : null}
          </div>
          <div className="cardBody">
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Symbol</th>
                  <th>Interval</th>
                  <th>Total return</th>
                  <th>Max DD</th>
                  <th>Win rate</th>
                  <th>PF</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((row) => {
                  const isBest = bestRow?.runId === row.runId;

                  return (
                    <tr key={row.runId} style={isBest ? { outline: "1px solid rgba(96, 165, 250, 0.55)" } : undefined}>
                      <td className="muted">{row.runId}</td>
                      <td>
                        <span className="badge">{row.status}</span>
                      </td>
                      <td className="muted">{row.symbol}</td>
                      <td className="muted">{row.interval}</td>
                      <td className="muted">{formatPercent(row.metrics.totalReturnPct)}</td>
                      <td className="muted">{formatPercent(row.metrics.maxDrawdownPct)}</td>
                      <td className="muted">{formatPercent(row.metrics.winRatePct)}</td>
                      <td className="muted">{formatNumber(row.metrics.profitFactor)}</td>
                      <td className="muted">{row.metrics.tradeCount ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {overlayEquity && equitySeries.length > 0 ? <EquityCurveChart series={equitySeries} /> : null}

      <div style={{ height: 24 }} />
    </div>
  );
}
