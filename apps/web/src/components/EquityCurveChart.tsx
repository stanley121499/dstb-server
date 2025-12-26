import React, { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type EquityPoint = Readonly<{
  timeUtc: string;
  equity: number;
}>;

export type EquityCurveSeries = Readonly<{
  label: string;
  color: string;
  points: readonly EquityPoint[];
}>;

/**
 * Custom tooltip for the equity curve chart.
 * Shows timestamp and equity value in a styled container.
 */
function CustomTooltip(props: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }

  const entry = props.payload[0];
  if (!entry) {
    return null;
  }

  return (
    <div className="customTooltip">
      <div className="label">{props.label}</div>
      <div className="value" style={{ color: entry.color }}>
        ${entry.value.toFixed(2)}
      </div>
    </div>
  );
}

/**
 * Equity curve chart using Recharts library.
 *
 * Features:
 * - Time-based X-axis with formatted dates
 * - Interactive tooltips showing equity value
 * - Grid lines for easier reading
 * - Support for multiple series (for comparison)
 * - Responsive sizing
 *
 * @param props - Chart series data
 */
export function EquityCurveChart(props: Readonly<{ series: readonly EquityCurveSeries[] }>): React.ReactElement {
  const chartData = useMemo(() => {
    // Merge all series into a single time-indexed dataset.
    const timeMap = new Map<string, Record<string, number | string>>();

    for (const s of props.series) {
      for (const point of s.points) {
        let entry = timeMap.get(point.timeUtc);
        if (!entry) {
          entry = { time: point.timeUtc };
          timeMap.set(point.timeUtc, entry);
        }
        entry[s.label] = point.equity;
      }
    }

    // Convert to array and sort by time.
    const data = Array.from(timeMap.values()).sort((a, b) => {
      const timeA = typeof a.time === "string" ? new Date(a.time).getTime() : 0;
      const timeB = typeof b.time === "string" ? new Date(b.time).getTime() : 0;
      return timeA - timeB;
    });

    // Format time labels to be more readable.
    return data.map((d) => ({
      ...d,
      time: typeof d.time === "string" ? new Date(d.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : d.time
    }));
  }, [props.series]);

  const domain = useMemo(() => {
    const allEquities: number[] = [];
    for (const s of props.series) {
      for (const p of s.points) {
        if (Number.isFinite(p.equity)) {
          allEquities.push(p.equity);
        }
      }
    }

    if (allEquities.length === 0) {
      return { min: 0, max: 1 };
    }

    const min = Math.min(...allEquities);
    const max = Math.max(...allEquities);

    return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1 };
  }, [props.series]);

  if (props.series.length === 0 || props.series.every((s) => s.points.length === 0)) {
    return (
      <div className="card">
        <div className="cardHeader">
          <p className="h2">Equity curve</p>
        </div>
        <div className="cardBody">
          <p className="muted">No equity data available yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardHeader">
        <p className="h2">Equity curve</p>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Min: ${domain.min.toFixed(2)} | Max: ${domain.max.toFixed(2)}
        </p>
      </div>
      <div className="cardBody">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
            <XAxis 
              dataKey="time" 
              stroke="var(--muted)"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              stroke="var(--muted)"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              domain={[domain.min * 0.98, domain.max * 1.02]}
              tickFormatter={(value: number) => `$${value.toFixed(0)}`}
            />
            <Tooltip content={<CustomTooltip />} />
            {props.series.length > 1 ? <Legend wrapperStyle={{ paddingTop: 20 }} /> : null}
            {props.series.map((s) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                animationDuration={300}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}



