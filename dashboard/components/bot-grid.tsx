"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type BotGridRow = Readonly<{
  id: string;
  name: string;
  strategy: string;
  symbol: string;
  interval: string;
  exchange: string;
  enabled: boolean;
  bots:
    | { id: string; status: string; equity: string | number | null; last_heartbeat: string | null }
    | ReadonlyArray<{ id: string; status: string; equity: string | number | null; last_heartbeat: string | null }>
    | null;
}>;

function pickBot(row: BotGridRow): {
  id: string;
  status: string;
  equity: string | number | null;
  last_heartbeat: string | null;
} | null {
  const b = row.bots;
  if (b === null) {
    return null;
  }
  if (Array.isArray(b)) {
    return b[0] ?? null;
  }
  return b as { id: string; status: string; equity: string | number | null; last_heartbeat: string | null };
}

function statusDotClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-emerald-500";
    case "starting":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    case "paused":
      return "bg-yellow-600";
    default:
      return "bg-muted-foreground";
  }
}

function formatEquity(v: string | number | null | undefined): string {
  if (v === null || v === undefined) {
    return "-";
  }
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) {
    return "-";
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function heartbeatLabel(iso: string | null): { text: string; stale: boolean } {
  if (iso === null || iso.length === 0) {
    return { text: "never", stale: true };
  }
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) {
    return { text: "-", stale: true };
  }
  const ageMs = Date.now() - t;
  const stale = ageMs > 5 * 60 * 1000;
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) {
    return { text: "just now", stale };
  }
  if (mins < 60) {
    return { text: `${mins}m ago`, stale };
  }
  const hrs = Math.floor(mins / 60);
  return { text: `${hrs}h ago`, stale };
}

/**
 * Bot cards with Realtime refresh, enable toggle, and links to the config editor.
 */
export function BotGrid(props: Readonly<{
  rows: BotGridRow[];
  todayPnlByBotId: Readonly<Record<string, number>>;
}>): React.ReactElement {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const ch = supabase
      .channel("dashboard-grid")
      .on("postgres_changes", { event: "*", schema: "public", table: "configs" }, () => {
        router.refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bots" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [router]);

  async function setEnabled(configId: string, enabled: boolean): Promise<void> {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.from("configs").update({ enabled }).eq("id", configId);
    if (error !== null) {
      console.error(error.message);
    }
    router.refresh();
  }

  let running = 0;
  let totalEquity = 0;
  let totalTodayPnl = 0;
  for (const row of props.rows) {
    const bot = pickBot(row);
    if (bot?.status === "running") {
      running += 1;
    }
    if (bot !== null) {
      const equityNum =
        bot.equity === null || bot.equity === undefined
          ? Number.NaN
          : typeof bot.equity === "string"
            ? Number(bot.equity)
            : bot.equity;
      if (Number.isFinite(equityNum)) {
        totalEquity += equityNum;
      }
      const pnl = props.todayPnlByBotId[bot.id];
      if (pnl !== undefined && Number.isFinite(pnl)) {
        totalTodayPnl += pnl;
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
          <p className="text-sm text-muted-foreground">Configs and live status (UTC day P&amp;L).</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Configs</div>
            <div className="font-medium">{props.rows.length}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Running</div>
            <div className="font-medium">{running}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Total equity</div>
            <div className="font-medium">{formatEquity(totalEquity)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Today P&amp;L</div>
            <div className={cn("font-medium", totalTodayPnl >= 0 ? "text-emerald-600" : "text-red-600")}>
              {totalTodayPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {props.rows.map((row) => {
          const bot = pickBot(row);
          const status = bot?.status ?? "stopped";
          const hb = heartbeatLabel(bot?.last_heartbeat ?? null);
          const todayPnl = bot !== null ? (props.todayPnlByBotId[bot.id] ?? 0) : 0;
          return (
            <Card key={row.id} className="flex flex-col">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold">
                    <Link href={`/config/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {`${row.strategy} / ${row.symbol} / ${row.interval}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", statusDotClass(status))} title={status} />
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(v) => void setEnabled(row.id, v)}
                    aria-label={`Enable ${row.name}`}
                  />
                </div>
              </CardHeader>
              <CardContent className="mt-auto space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="capitalize">{status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Equity</span>
                  <span>{formatEquity(bot?.equity ?? null)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Today P&amp;L</span>
                  <span className={todayPnl >= 0 ? "text-emerald-600" : "text-red-600"}>
                    {todayPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Heartbeat</span>
                  <span className={hb.stale ? "text-amber-600" : ""}>{hb.text}</span>
                </div>
                {bot === null ? (
                  <p className="text-xs text-muted-foreground">No bot row yet - start server or sync.</p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
