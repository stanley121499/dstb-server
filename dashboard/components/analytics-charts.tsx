"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  CrosshairMode,
  type HistogramData,
  type LineData,
  type Time
} from "lightweight-charts";

import { Button } from "@/components/ui/button";
import type { SeriesPoint } from "@/lib/analytics/types";

export type AnalyticsChartsProps = Readonly<{
  equityByConfig: Readonly<Record<string, readonly SeriesPoint[]>>;
  aggregateEquity: readonly SeriesPoint[];
  aggregateDrawdownPct: readonly SeriesPoint[];
  dailyPnl: readonly Readonly<{ dayUtcSec: number; pnl: number }>[];
  configLabels: Readonly<Record<string, string>>;
}>;

const PALETTE = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#db2777", "#0891b2"];

function toLineData(points: readonly SeriesPoint[]): LineData<Time>[] {
  return points.map((p) => ({
    time: p.timeUtcSec as Time,
    value: p.value
  }));
}

/**
 * Equity, drawdown, and daily PnL charts with per-bot toggles on the equity panel.
 */
export function AnalyticsCharts(props: Readonly<AnalyticsChartsProps>): React.ReactElement {
  const configIds = useMemo(() => Object.keys(props.equityByConfig).sort(), [props.equityByConfig]);
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set(configIds));
  const [showAgg, setShowAgg] = useState(true);

  useEffect(() => {
    setVisible(new Set(configIds));
  }, [configIds]);

  const eqRef = useRef<HTMLDivElement | null>(null);
  const ddRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const eqKey = useMemo(() => {
    const parts = [...visible].sort().join(",");
    return `${parts}|agg:${showAgg ? "1" : "0"}`;
  }, [visible, showAgg]);

  useEffect(() => {
    const el = eqRef.current;
    if (el === null) {
      return;
    }
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "hsl(var(--foreground))"
      },
      grid: {
        vertLines: { color: "hsl(var(--border))" },
        horzLines: { color: "hsl(var(--border))" }
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "hsl(var(--border))" },
      timeScale: { borderColor: "hsl(var(--border))" }
    });

    let colorIdx = 0;
    for (const id of configIds) {
      if (!visible.has(id)) {
        continue;
      }
      const series = chart.addLineSeries({
        color: PALETTE[colorIdx % PALETTE.length],
        lineWidth: 2,
        title: props.configLabels[id] ?? id
      });
      colorIdx += 1;
      series.setData(toLineData(props.equityByConfig[id] ?? []));
    }
    if (showAgg && props.aggregateEquity.length > 0) {
      const agg = chart.addLineSeries({
        color: "#64748b",
        lineWidth: 2,
        lineStyle: 2,
        title: "Aggregate"
      });
      agg.setData(toLineData(props.aggregateEquity));
    }

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) {
        return;
      }
      chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    ro.observe(el);
    chart.applyOptions({ width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight) });
    chart.timeScale().fitContent();

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [configIds, eqKey, props.aggregateEquity, props.configLabels, props.equityByConfig, showAgg, visible]);

  useEffect(() => {
    const el = ddRef.current;
    if (el === null || props.aggregateDrawdownPct.length === 0) {
      return;
    }
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "hsl(var(--foreground))"
      },
      grid: {
        vertLines: { color: "hsl(var(--border))" },
        horzLines: { color: "hsl(var(--border))" }
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "hsl(var(--border))" },
      timeScale: { borderColor: "hsl(var(--border))" }
    });
    const series = chart.addLineSeries({ color: "#dc2626", lineWidth: 2, title: "Drawdown %" });
    series.setData(toLineData(props.aggregateDrawdownPct));
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) {
        return;
      }
      chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    ro.observe(el);
    chart.applyOptions({ width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight) });
    chart.timeScale().fitContent();
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [props.aggregateDrawdownPct]);

  useEffect(() => {
    const el = barRef.current;
    if (el === null || props.dailyPnl.length === 0) {
      return;
    }
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "hsl(var(--foreground))"
      },
      grid: {
        vertLines: { color: "hsl(var(--border))" },
        horzLines: { color: "hsl(var(--border))" }
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "hsl(var(--border))" },
      timeScale: { borderColor: "hsl(var(--border))" }
    });
    const series = chart.addHistogramSeries({
      color: "#2563eb",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 }
    });
    const data: HistogramData<Time>[] = props.dailyPnl.map((d) => ({
      time: d.dayUtcSec as Time,
      value: d.pnl,
      color: d.pnl >= 0 ? "#16a34a" : "#dc2626"
    }));
    series.setData(data);
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) {
        return;
      }
      chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    ro.observe(el);
    chart.applyOptions({ width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight) });
    chart.timeScale().fitContent();
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [props.dailyPnl]);

  function toggleId(id: string): void {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Equity curve</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showAgg}
              onChange={(e) => {
                setShowAgg(e.target.checked);
              }}
            />
            Show aggregate
          </label>
        </div>
        {configIds.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {configIds.map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={visible.has(id) ? "default" : "outline"}
                onClick={() => {
                  toggleId(id);
                }}
              >
                {props.configLabels[id] ?? id}
              </Button>
            ))}
          </div>
        ) : null}
        <div ref={eqRef} className="h-[320px] w-full rounded-md border border-border" />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Drawdown % (aggregate)</h2>
        <p className="text-xs text-muted-foreground">Peak-to-trough percent vs running peak on the combined equity curve.</p>
        {props.aggregateDrawdownPct.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drawdown series.</p>
        ) : (
          <div ref={ddRef} className="h-[260px] w-full rounded-md border border-border" />
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Daily P&amp;L (UTC)</h2>
        {props.dailyPnl.length === 0 ? (
          <p className="text-sm text-muted-foreground">No daily buckets.</p>
        ) : (
          <div ref={barRef} className="h-[260px] w-full rounded-md border border-border" />
        )}
      </div>
    </div>
  );
}
