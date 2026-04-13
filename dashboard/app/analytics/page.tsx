import Link from "next/link";

import { AnalyticsCharts } from "@/components/analytics-charts";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  aggregateEquitySeries,
  comparisonRowsByConfig,
  computeTradeStats,
  dailyPnlBuckets,
  drawdownPctSeries,
  equitySeriesByConfig,
  parseRMultiple,
  type ConfigPerformanceRow
} from "@/lib/analytics/compute";
import type { AnalyticsTrade } from "@/lib/analytics/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Search = Readonly<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  if (v === undefined) {
    return "";
  }
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function readNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapRowToAnalyticsTrade(raw: Readonly<Record<string, unknown>>): AnalyticsTrade | null {
  const id = raw["id"];
  const configId = raw["config_id"];
  if (typeof id !== "string" || typeof configId !== "string") {
    return null;
  }
  const cfg = raw["configs"];
  let configName = "";
  let strategy = "";
  let initialBalance = 0;
  if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
    const c = cfg as Record<string, unknown>;
    if (typeof c["name"] === "string") {
      configName = c["name"];
    }
    if (typeof c["strategy"] === "string") {
      strategy = c["strategy"];
    }
    initialBalance = readNum(c["initial_balance"]);
  }
  const exitIso = String(raw["exit_time"]);
  const exitMs = new Date(exitIso).getTime();
  if (!Number.isFinite(exitMs)) {
    return null;
  }
  return {
    id,
    configId,
    configName,
    strategy,
    initialBalance,
    pnl: readNum(raw["pnl"]),
    exitTimeMs: exitMs,
    exitTimeIso: exitIso,
    rMultiple: parseRMultiple(raw["metadata"])
  };
}

function StatCard(props: Readonly<{ label: string; value: string }>): React.ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{props.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold tabular-nums">{props.value}</p>
      </CardContent>
    </Card>
  );
}

function formatPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) {
    return "n/a";
  }
  return `${n.toFixed(2)}%`;
}

function formatNum(n: number | null, digits = 2): string {
  if (n === null || Number.isNaN(n)) {
    return "n/a";
  }
  return n.toFixed(digits);
}

/**
 * P&amp;L analytics and strategy comparison (Phase 3).
 */
export default async function AnalyticsPage(props: Readonly<{ searchParams: Promise<Search> }>): Promise<React.ReactElement> {
  const sp = await props.searchParams;
  const botId = first(sp["bot"]);
  const symbol = first(sp["symbol"]);
  const strategy = first(sp["strategy"]);
  const from = first(sp["from"]);
  const to = first(sp["to"]);
  const view = first(sp["view"]) || "overview";

  const supabase = await createSupabaseServerClient();

  const { data: configOptions } = await supabase.from("configs").select("id, name, strategy, initial_balance").order("name", { ascending: true });

  let q = supabase
    .from("trades")
    .select("id, config_id, pnl, exit_time, metadata, configs ( name, strategy, initial_balance )")
    .order("exit_time", { ascending: true })
    .limit(8000);

  if (botId.length > 0) {
    q = q.eq("config_id", botId);
  }
  if (symbol.length > 0) {
    q = q.eq("symbol", symbol);
  }
  if (from.length > 0) {
    q = q.gte("exit_time", new Date(from).toISOString());
  }
  if (to.length > 0) {
    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);
    q = q.lte("exit_time", end.toISOString());
  }

  const { data: rows, error } = await q;

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }

  let trades: AnalyticsTrade[] = [];
  for (const raw of rows ?? []) {
    const t = mapRowToAnalyticsTrade(raw as Record<string, unknown>);
    if (t !== null) {
      trades.push(t);
    }
  }
  if (strategy.length > 0) {
    trades = trades.filter((t) => t.strategy === strategy);
  }

  const distinctIds = [...new Set(trades.map((t) => t.configId))];
  const initialByConfig = new Map<string, number>();
  for (const id of distinctIds) {
    const t0 = trades.find((x) => x.configId === id);
    if (t0 !== undefined) {
      initialByConfig.set(id, t0.initialBalance);
    }
  }
  if (botId.length > 0) {
    const row = (configOptions ?? []).find((c) => (c as { id: string }).id === botId) as { id: string; initial_balance?: unknown } | undefined;
    if (row !== undefined) {
      initialByConfig.set(botId, readNum(row.initial_balance));
    }
  }

  const equityByConfig = equitySeriesByConfig(trades);
  const aggregateEquity = aggregateEquitySeries(trades, initialByConfig);
  const aggregateDrawdownPct = drawdownPctSeries(aggregateEquity);
  const stats = computeTradeStats(trades, aggregateEquity);
  const compareRows: ConfigPerformanceRow[] = comparisonRowsByConfig(trades, equityByConfig);

  const bucketMap = dailyPnlBuckets(trades);
  const dailyPnl = [...bucketMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, pnl]) => {
      const [y, m, d] = day.split("-").map((x) => Number(x));
      const sec = Math.floor(Date.UTC(y, m - 1, d) / 1000);
      return { dayUtcSec: sec, pnl };
    });

  const configLabels: Record<string, string> = {};
  for (const t of trades) {
    configLabels[t.configId] = t.configName;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Equity, drawdown, and performance vs filters.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/analytics?${new URLSearchParams({
              ...Object.fromEntries(
                Object.entries({ bot: botId, symbol, strategy, from, to }).filter(([, v]) => v.length > 0)
              ),
              view: "overview"
            }).toString()}`}
            className={buttonVariants({ variant: view === "overview" ? "default" : "outline", size: "sm" })}
          >
            Overview
          </Link>
          <Link
            href={`/analytics?${new URLSearchParams({
              ...Object.fromEntries(
                Object.entries({ bot: botId, symbol, strategy, from, to }).filter(([, v]) => v.length > 0)
              ),
              view: "compare"
            }).toString()}`}
            className={buttonVariants({ variant: view === "compare" ? "default" : "outline", size: "sm" })}
          >
            Strategy comparison
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Bots
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3 lg:grid-cols-4" method="get">
            <input type="hidden" name="view" value={view} />
            <div className="space-y-2">
              <Label htmlFor="bot">Bot</Label>
              <select
                name="bot"
                id="bot"
                defaultValue={botId}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">All</option>
                {(configOptions ?? []).map((c) => {
                  const row = c as { id: string; name: string };
                  return (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input name="symbol" id="symbol" defaultValue={symbol} placeholder="BTC-USD" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy">Strategy</Label>
              <Input name="strategy" id="strategy" defaultValue={strategy} placeholder="orb-atr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <Input name="from" id="from" type="date" defaultValue={from} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input name="to" id="to" type="date" defaultValue={to} />
            </div>
            <div className="flex items-end gap-2 md:col-span-2">
              <button type="submit" className={buttonVariants({ variant: "default" })}>
                Apply
              </button>
              <Link href={`/analytics?view=${view}`} className={buttonVariants({ variant: "secondary" })}>
                Clear
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {view === "compare" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Strategy / config comparison</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Config</th>
                  <th className="py-2 pr-4">Strategy</th>
                  <th className="py-2 pr-4 text-right">Trades</th>
                  <th className="py-2 pr-4 text-right">Win rate</th>
                  <th className="py-2 pr-4 text-right">PF</th>
                  <th className="py-2 pr-4 text-right">Avg P&amp;L</th>
                  <th className="py-2 pr-4 text-right">Max DD %</th>
                  <th className="py-2 pr-4 text-right">Sharpe*</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      No trades for these filters.
                    </td>
                  </tr>
                ) : (
                  compareRows.map((row) => (
                    <tr key={row.configId} className="border-b border-border/60">
                      <td className="py-2 pr-4 font-medium">{row.configName}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{row.strategy}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{row.stats.tradeCount}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatPct(row.stats.winRatePct)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNum(row.stats.profitFactor, 2)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNum(row.stats.avgPnl, 2)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatPct(row.stats.maxDrawdownPct)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNum(row.stats.sharpeDailyPnl, 2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              *Sharpe uses daily bucketed P&amp;L (rough scale); n/a when fewer than 5 days.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total trades" value={String(stats.tradeCount)} />
            <StatCard label="Win rate" value={formatPct(stats.winRatePct)} />
            <StatCard label="Avg P&amp;L" value={formatNum(stats.avgPnl, 2)} />
            <StatCard label="Profit factor" value={formatNum(stats.profitFactor, 2)} />
            <StatCard label="Avg R-multiple" value={formatNum(stats.avgRMultiple, 2)} />
            <StatCard label="Max drawdown (agg.)" value={formatPct(stats.maxDrawdownPct)} />
            <StatCard label="Sharpe (daily PnL)*" value={formatNum(stats.sharpeDailyPnl, 2)} />
            <StatCard label="Gross profit / loss" value={`${formatNum(stats.grossProfit, 0)} / ${formatNum(stats.grossLoss, 0)}`} />
          </div>

          {trades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades match — adjust filters.</p>
          ) : (
            <AnalyticsCharts
              equityByConfig={equityByConfig}
              aggregateEquity={aggregateEquity}
              aggregateDrawdownPct={aggregateDrawdownPct}
              dailyPnl={dailyPnl}
              configLabels={configLabels}
            />
          )}
        </>
      )}
    </div>
  );
}
