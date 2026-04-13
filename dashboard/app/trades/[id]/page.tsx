import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { TradeDetailChart } from "@/components/trade-detail-chart";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCandlesJsonb } from "@/lib/tradeChart";

const uuidSchema = z.string().uuid();

function readNumeric(v: unknown): string {
  if (v === null || v === undefined) {
    return "-";
  }
  return String(v);
}

function readNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Single trade with chart context and config snapshot (Phase 3).
 */
export default async function TradeDetailPage(props: Readonly<{ params: Promise<{ id: string }> }>): Promise<React.ReactElement> {
  const { id } = await props.params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data: tradeRow, error: tErr } = await supabase
    .from("trades")
    .select(
      "id, symbol, side, entry_price, exit_price, quantity, stop_loss, take_profit, pnl, pnl_pct, entry_time, exit_time, exit_reason, config_version, config_snapshot, metadata, configs ( name )"
    )
    .eq("id", parsed.data)
    .maybeSingle();

  if (tErr !== null || tradeRow === null) {
    notFound();
  }

  const t = tradeRow as Record<string, unknown>;
  const cfg = t["configs"];
  let botName = "-";
  if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
    const n = (cfg as Record<string, unknown>)["name"];
    if (typeof n === "string") {
      botName = n;
    }
  }

  const { data: candleRows } = await supabase.from("trade_candles").select("timeframe, candles").eq("trade_id", parsed.data);

  const seriesByTf: Record<string, ReturnType<typeof parseCandlesJsonb>> = {};
  for (const raw of candleRows ?? []) {
    const row = raw as Record<string, unknown>;
    const tf = row["timeframe"];
    if (typeof tf !== "string" || tf.length === 0) {
      continue;
    }
    seriesByTf[tf] = parseCandlesJsonb(row["candles"]);
  }

  const entryMs = new Date(String(t["entry_time"])).getTime();
  const exitMs = new Date(String(t["exit_time"])).getTime();
  const entryPrice = readNum(t["entry_price"]);
  const exitPrice = readNum(t["exit_price"]);
  const sl = readNum(t["stop_loss"]);
  const tp = readNum(t["take_profit"]);

  const snapshotJson =
    typeof t["config_snapshot"] === "object" && t["config_snapshot"] !== null
      ? JSON.stringify(t["config_snapshot"], null, 2)
      : String(t["config_snapshot"]);

  const metadataJson =
    typeof t["metadata"] === "object" && t["metadata"] !== null
      ? JSON.stringify(t["metadata"], null, 2)
      : String(t["metadata"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trade detail</h1>
          <p className="text-sm text-muted-foreground">
            {botName} · {String(t["symbol"])} · {String(t["side"])}
          </p>
        </div>
        <Link href="/trades" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to trades
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Price action</CardTitle>
          </CardHeader>
          <CardContent>
            {entryPrice !== null && exitPrice !== null ? (
              <TradeDetailChart
                seriesByTf={seriesByTf}
                entryTimeMs={entryMs}
                exitTimeMs={exitMs}
                entryPrice={entryPrice}
                exitPrice={exitPrice}
                stopLoss={sl}
                takeProfit={tp}
                side={String(t["side"])}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Missing entry/exit prices.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Entry</span>
                <span className="font-mono text-xs">{readNumeric(t["entry_price"])}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Exit</span>
                <span className="font-mono text-xs">{readNumeric(t["exit_price"])}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Qty</span>
                <span className="font-mono text-xs">{readNumeric(t["quantity"])}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Stop loss</span>
                <span className="font-mono text-xs">{sl !== null ? String(sl) : "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Take profit</span>
                <span className="font-mono text-xs">{tp !== null ? String(tp) : "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">P&amp;L</span>
                <span className="font-mono text-xs">{readNumeric(t["pnl"])}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">P&amp;L %</span>
                <span className="font-mono text-xs">{readNumeric(t["pnl_pct"])}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Exit reason</span>
                <span className="text-xs">{String(t["exit_reason"])}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Config version</span>
                <span className="text-xs">{String(t["config_version"])}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Entry (UTC): {String(t["entry_time"])}
                <br />
                Exit (UTC): {String(t["exit_time"])}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">{metadataJson}</pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Config snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show params at trade time</summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">{snapshotJson}</pre>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
