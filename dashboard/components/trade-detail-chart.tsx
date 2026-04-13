"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  CrosshairMode,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";

import { Button } from "@/components/ui/button";
import type { ChartCandle } from "@/lib/tradeChart";
import { toLwCandlestickData } from "@/lib/tradeChart";

export type TradeDetailChartProps = Readonly<{
  seriesByTf: Readonly<Record<string, readonly ChartCandle[]>>;
  entryTimeMs: number;
  exitTimeMs: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  side: string;
}>;

/**
 * Snaps an event time to the nearest bar `time` (seconds) so markers align with candles.
 */
function snapToNearestBarTimeSec(candles: readonly ChartCandle[], eventMs: number): UTCTimestamp {
  const data = toLwCandlestickData(candles);
  if (data.length === 0) {
    return Math.floor(eventMs / 1000) as UTCTimestamp;
  }
  let bestT = data[0].time as UTCTimestamp;
  let bestDiff = Infinity;
  for (const row of data) {
    const sec = typeof row.time === "number" ? row.time : 0;
    const ms = sec * 1000;
    const diff = Math.abs(ms - eventMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestT = row.time as UTCTimestamp;
    }
  }
  return bestT;
}

/**
 * Renders TradingView Lightweight Charts with entry/exit markers and SL/TP lines.
 */
export function TradeDetailChart(props: Readonly<TradeDetailChartProps>): React.ReactElement {
  const timeframes = useMemo(() => Object.keys(props.seriesByTf).sort(), [props.seriesByTf]);
  const defaultTf = timeframes[0] ?? "";
  const [activeTf, setActiveTf] = useState(defaultTf);

  useEffect(() => {
    if (timeframes.length > 0 && !timeframes.includes(activeTf)) {
      setActiveTf(timeframes[0] ?? "");
    }
  }, [timeframes, activeTf]);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  const candles = props.seriesByTf[activeTf] ?? [];

  useEffect(() => {
    const el = wrapRef.current;
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

    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626"
    });

    const lw = toLwCandlestickData(candles);
    series.setData(lw);

    const isLong = props.side.toUpperCase() === "LONG";
    const entryT = snapToNearestBarTimeSec(candles, props.entryTimeMs);
    const exitT = snapToNearestBarTimeSec(candles, props.exitTimeMs);
    const markers: SeriesMarker<Time>[] = [
      {
        time: entryT,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#15803d" : "#b91c1c",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: "Entry"
      },
      {
        time: exitT,
        position: isLong ? "aboveBar" : "belowBar",
        color: "#7c3aed",
        shape: isLong ? "arrowDown" : "arrowUp",
        text: "Exit"
      }
    ];
    series.setMarkers(markers);

    if (props.stopLoss !== null) {
      series.createPriceLine({
        price: props.stopLoss,
        color: "#ef4444",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "SL"
      });
    }
    if (props.takeProfit !== null) {
      series.createPriceLine({
        price: props.takeProfit,
        color: "#22c55e",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "TP"
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
  }, [activeTf, candles, props.entryTimeMs, props.exitTimeMs, props.side, props.stopLoss, props.takeProfit]);

  return (
    <div className="space-y-3">
      {timeframes.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {timeframes.map((tf) => (
            <Button
              key={tf}
              type="button"
              variant={tf === activeTf ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setActiveTf(tf);
              }}
            >
              {tf}
            </Button>
          ))}
        </div>
      ) : null}
      {timeframes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No candle data stored for this trade yet.</p>
      ) : (
        <div ref={wrapRef} className="h-[420px] w-full rounded-md border border-border" />
      )}
    </div>
  );
}
