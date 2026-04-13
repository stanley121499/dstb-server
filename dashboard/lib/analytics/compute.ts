import type { AnalyticsTrade, SeriesPoint, TradeStatsBlock } from "./types";

/**
 * Parses `trades.metadata` for optional R-multiple (written by Supabase bot on close).
 */
export function parseRMultiple(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  const raw = (metadata as Record<string, unknown>)["rMultiple"];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Builds cumulative equity series per config after each closed trade (chronological).
 */
export function equitySeriesByConfig(trades: readonly AnalyticsTrade[]): Readonly<Record<string, SeriesPoint[]>> {
  const sorted = [...trades].sort((a, b) => a.exitTimeMs - b.exitTimeMs);
  const initialByConfig = new Map<string, number>();
  for (const t of sorted) {
    if (!initialByConfig.has(t.configId)) {
      initialByConfig.set(t.configId, t.initialBalance);
    }
  }
  const running = new Map<string, number>();
  const pointsByConfig = new Map<string, SeriesPoint[]>();

  for (const t of sorted) {
    const init = initialByConfig.get(t.configId) ?? t.initialBalance;
    const prev = running.get(t.configId) ?? init;
    const next = prev + t.pnl;
    running.set(t.configId, next);
    const sec = Math.floor(t.exitTimeMs / 1000);
    const list = pointsByConfig.get(t.configId) ?? [];
    list.push({ timeUtcSec: sec, value: next });
    pointsByConfig.set(t.configId, list);
  }

  const out: Record<string, SeriesPoint[]> = {};
  for (const [k, v] of pointsByConfig) {
    out[k] = v;
  }
  return out;
}

/**
 * Aggregate equity: sum of each config's running equity after every trade event on a merged timeline.
 * Any config in `initialByConfig` that never trades stays at initial balance in the total.
 */
export function aggregateEquitySeries(
  trades: readonly AnalyticsTrade[],
  initialByConfig: ReadonlyMap<string, number>
): SeriesPoint[] {
  const sorted = [...trades].sort((a, b) => a.exitTimeMs - b.exitTimeMs);
  const running = new Map<string, number>(initialByConfig);
  const timeline: SeriesPoint[] = [];

  const sumEquity = (): number => {
    let s = 0;
    for (const [, v] of running) {
      s += v;
    }
    return s;
  };

  if (sorted.length > 0) {
    const firstSec = Math.floor(sorted[0].exitTimeMs / 1000);
    timeline.push({ timeUtcSec: firstSec - 1, value: sumEquity() });
  }

  for (const t of sorted) {
    if (!running.has(t.configId)) {
      running.set(t.configId, t.initialBalance);
    }
    const prev = running.get(t.configId) ?? t.initialBalance;
    running.set(t.configId, prev + t.pnl);
    timeline.push({ timeUtcSec: Math.floor(t.exitTimeMs / 1000), value: sumEquity() });
  }

  return timeline;
}

/**
 * Running drawdown % series from an equity curve (peak-to-trough relative to peak).
 */
export function drawdownPctSeries(equity: readonly SeriesPoint[]): SeriesPoint[] {
  if (equity.length === 0) {
    return [];
  }
  let peak = equity[0].value;
  const out: SeriesPoint[] = [];
  for (const p of equity) {
    if (p.value > peak) {
      peak = p.value;
    }
    const dd = peak > 0 ? ((p.value - peak) / peak) * 100 : 0;
    out.push({ timeUtcSec: p.timeUtcSec, value: dd });
  }
  return out;
}

/**
 * Max drawdown % (most negative trough vs prior peak) from equity series.
 */
export function maxDrawdownPctFromEquity(equity: readonly SeriesPoint[]): number | null {
  const dd = drawdownPctSeries(equity);
  if (dd.length === 0) {
    return null;
  }
  let min = 0;
  for (const p of dd) {
    if (p.value < min) {
      min = p.value;
    }
  }
  return min;
}

/**
 * Buckets total PnL by UTC calendar day (for bar chart and Sharpe helper).
 */
export function dailyPnlBuckets(trades: readonly AnalyticsTrade[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of trades) {
    const d = new Date(t.exitTimeMs);
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + t.pnl);
  }
  return map;
}

/**
 * Computes summary stats for a trade list.
 */
export function computeTradeStats(trades: readonly AnalyticsTrade[], equityForDd: readonly SeriesPoint[]): TradeStatsBlock {
  const n = trades.length;
  if (n === 0) {
    return {
      tradeCount: 0,
      winRatePct: 0,
      avgPnl: 0,
      profitFactor: null,
      avgRMultiple: null,
      grossProfit: 0,
      grossLoss: 0,
      maxDrawdownPct: null,
      sharpeDailyPnl: null
    };
  }

  let wins = 0;
  let sumPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const rVals: number[] = [];
  for (const t of trades) {
    sumPnl += t.pnl;
    if (t.pnl > 0) {
      wins += 1;
      grossProfit += t.pnl;
    } else if (t.pnl < 0) {
      grossLoss += t.pnl;
    }
    if (t.rMultiple !== null) {
      rVals.push(t.rMultiple);
    }
  }

  const pfResolved = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null;

  const daily = [...dailyPnlBuckets(trades).values()];
  const sharpeDailyPnl = computeSharpeDaily(daily);

  return {
    tradeCount: n,
    winRatePct: (wins / n) * 100,
    avgPnl: sumPnl / n,
    profitFactor: pfResolved,
    avgRMultiple: rVals.length > 0 ? rVals.reduce((a, b) => a + b, 0) / rVals.length : null,
    grossProfit,
    grossLoss,
    maxDrawdownPct: maxDrawdownPctFromEquity(equityForDd),
    sharpeDailyPnl
  };
}

function computeSharpeDaily(dailyPnls: readonly number[]): number | null {
  if (dailyPnls.length < 5) {
    return null;
  }
  const mean = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length;
  if (dailyPnls.length < 2) {
    return null;
  }
  let varSum = 0;
  for (const x of dailyPnls) {
    const d = x - mean;
    varSum += d * d;
  }
  const sd = Math.sqrt(varSum / (dailyPnls.length - 1));
  if (sd === 0) {
    return null;
  }
  return (mean / sd) * Math.sqrt(365);
}

/**
 * Per-config aggregates for strategy comparison table.
 */
export type ConfigPerformanceRow = Readonly<{
  configId: string;
  configName: string;
  strategy: string;
  stats: TradeStatsBlock;
}>;

export function comparisonRowsByConfig(
  trades: readonly AnalyticsTrade[],
  equityByConfig: Readonly<Record<string, SeriesPoint[]>>
): ConfigPerformanceRow[] {
  const byConfig = new Map<string, AnalyticsTrade[]>();
  for (const t of trades) {
    const list = byConfig.get(t.configId) ?? [];
    list.push(t);
    byConfig.set(t.configId, list);
  }
  const rows: ConfigPerformanceRow[] = [];
  for (const [configId, list] of byConfig) {
    const eq = equityByConfig[configId] ?? [];
    const stats = computeTradeStats(list, eq);
    const name = list[0]?.configName ?? configId;
    const strategy = list[0]?.strategy ?? "";
    rows.push({ configId, configName: name, strategy, stats });
  }
  return rows.sort((a, b) => a.configName.localeCompare(b.configName));
}
