import React, { useMemo } from "react";

export type EquityPoint = Readonly<{
  timeUtc: string;
  equity: number;
}>;

export type EquityCurveSeries = Readonly<{
  label: string;
  color: string;
  points: readonly EquityPoint[];
}>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Simple SVG line chart for equity curves.
 *
 * We keep this lightweight to avoid adding a charting dependency.
 */
export function EquityCurveChart(props: Readonly<{ series: readonly EquityCurveSeries[] }>): React.ReactElement {
  const width = 980;
  const height = 280;
  const pad = 26;

  const allPoints = useMemo(() => props.series.flatMap((s) => s.points), [props.series]);

  const domain = useMemo(() => {
    const equities = allPoints.map((p) => p.equity).filter((x) => Number.isFinite(x));

    const min = equities.length > 0 ? Math.min(...equities) : 0;
    const max = equities.length > 0 ? Math.max(...equities) : 1;

    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) ? max : 1;

    return {
      min: safeMin,
      max: safeMax
    };
  }, [allPoints]);

  const yScale = useMemo(() => {
    const span = domain.max - domain.min;
    const safeSpan = span === 0 ? 1 : span;

    return (equity: number): number => {
      const t = (equity - domain.min) / safeSpan;
      const y = pad + (1 - clamp(t, 0, 1)) * (height - pad * 2);
      return y;
    };
  }, [domain.max, domain.min]);

  const makePath = (pts: readonly EquityPoint[]): string => {
    if (pts.length === 0) {
      return "";
    }

    const innerWidth = width - pad * 2;

    const toX = (idx: number): number => {
      const denom = pts.length <= 1 ? 1 : pts.length - 1;
      const t = idx / denom;
      return pad + t * innerWidth;
    };

    const commands: string[] = [];

    for (let i = 0; i < pts.length; i += 1) {
      const x = toX(i);
      const p = pts[i];
      if (p === undefined) {
        continue;
      }
      const y = yScale(p.equity);
      commands.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    return commands.join(" ");
  };

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="cardHeader">
        <p className="h2">Equity curve</p>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Min: {domain.min.toFixed(2)} | Max: {domain.max.toFixed(2)}
        </p>
      </div>
      <div className="cardBody">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Equity curve chart">
          <rect x={0} y={0} width={width} height={height} fill="rgba(255, 255, 255, 0.02)" />
          <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="rgba(255, 255, 255, 0.15)" />
          <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="rgba(255, 255, 255, 0.15)" />

          {props.series.map((s) => {
            const d = makePath(s.points);

            return d.length > 0 ? (
              <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} opacity={0.95} />
            ) : null;
          })}
        </svg>

        {props.series.length > 1 ? (
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            {props.series.map((s) => (
              <span key={s.label} className="badge">
                <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, display: "inline-block", marginRight: 6 }} />
                {s.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
