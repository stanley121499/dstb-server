"use client";

import { useEffect, useMemo, useRef } from "react";
import { ColorType, createChart, CrosshairMode, type Time } from "lightweight-charts";

import type { ChartCandle } from "@/lib/tradeChart";
import { toLwCandlestickData } from "@/lib/tradeChart";

export type BehaviorCycleChartProps = Readonly<{
  candles: readonly ChartCandle[];
  pdh: number | null;
  pdl: number | null;
  sessionOpen: number | null;
}>;

/**
 * Single-timeframe candlestick chart with optional reference level price lines.
 */
export function BehaviorCycleChart(props: Readonly<BehaviorCycleChartProps>): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const candles = props.candles;

  const lw = useMemo(() => toLwCandlestickData(candles), [candles]);

  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) {
      return;
    }

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "hsl(var(--foreground))",
      },
      grid: {
        vertLines: { color: "hsl(var(--border))" },
        horzLines: { color: "hsl(var(--border))" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "hsl(var(--border))" },
      timeScale: { borderColor: "hsl(var(--border))" },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    series.setData(lw as { time: Time; open: number; high: number; low: number; close: number }[]);

    if (props.pdh !== null && Number.isFinite(props.pdh)) {
      series.createPriceLine({
        price: props.pdh,
        color: "#3b82f6",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "PDH",
      });
    }
    if (props.pdl !== null && Number.isFinite(props.pdl)) {
      series.createPriceLine({
        price: props.pdl,
        color: "#f97316",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "PDL",
      });
    }
    if (props.sessionOpen !== null && Number.isFinite(props.sessionOpen)) {
      series.createPriceLine({
        price: props.sessionOpen,
        color: "#a855f7",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "Open",
      });
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
  }, [lw, props.pdh, props.pdl, props.sessionOpen]);

  if (candles.length === 0) {
    return <p className="text-sm text-muted-foreground">No 15m candles for this cycle.</p>;
  }

  return <div ref={wrapRef} className="h-[420px] w-full rounded-md border border-border" />;
}
