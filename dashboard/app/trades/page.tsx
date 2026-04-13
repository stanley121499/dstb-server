import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Search = Readonly<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  if (v === undefined) {
    return "";
  }
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

/**
 * Paginated trade log with GET filters (no row navigation in Phase 2).
 */
export default async function TradesPage(props: Readonly<{ searchParams: Promise<Search> }>): Promise<React.ReactElement> {
  const sp = await props.searchParams;
  const botId = first(sp["bot"]);
  const symbol = first(sp["symbol"]);
  const side = first(sp["side"]);
  const result = first(sp["result"]);
  const exitReason = first(sp["exitReason"]);
  const from = first(sp["from"]);
  const to = first(sp["to"]);
  const pageRaw = first(sp["page"]);
  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const pageSize = 50;
  const fromIdx = (page - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  const { data: configOptions } = await supabase.from("configs").select("id, name").order("name", { ascending: true });

  let q = supabase
    .from("trades")
    .select("id, bot_id, config_id, symbol, side, entry_price, exit_price, pnl, pnl_pct, exit_reason, exit_time, configs ( name )", {
      count: "exact"
    })
    .order("exit_time", { ascending: false });

  if (botId.length > 0) {
    q = q.eq("config_id", botId);
  }
  if (symbol.length > 0) {
    q = q.eq("symbol", symbol);
  }
  if (side.length > 0) {
    q = q.eq("side", side.toUpperCase());
  }
  if (result === "win") {
    q = q.gt("pnl", 0);
  } else if (result === "loss") {
    q = q.lte("pnl", 0);
  }
  if (exitReason.length > 0) {
    q = q.eq("exit_reason", exitReason);
  }
  if (from.length > 0) {
    q = q.gte("exit_time", new Date(from).toISOString());
  }
  if (to.length > 0) {
    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);
    q = q.lte("exit_time", end.toISOString());
  }

  const { data: rows, error, count } = await q.range(fromIdx, toIdx);

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
          <p className="text-sm text-muted-foreground">Completed trades — click exit time for chart detail.</p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>Back to bots</Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3 lg:grid-cols-4" method="get">
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
              <Label htmlFor="side">Side</Label>
              <select
                name="side"
                id="side"
                defaultValue={side}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">All</option>
                <option value="long">LONG</option>
                <option value="short">SHORT</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="result">Win / loss</Label>
              <select
                name="result"
                id="result"
                defaultValue={result}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">All</option>
                <option value="win">Win</option>
                <option value="loss">Loss / flat</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exitReason">Exit reason</Label>
              <Input name="exitReason" id="exitReason" defaultValue={exitReason} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">From (date)</Label>
              <Input name="from" id="from" type="date" defaultValue={from} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To (date)</Label>
              <Input name="to" id="to" type="date" defaultValue={to} />
            </div>
            <div className="flex items-end gap-2 md:col-span-2">
              <Button type="submit">Apply</Button>
              <a href="/trades" className={buttonVariants({ variant: "secondary", size: "default" })}>Clear</a>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Exit (UTC)</TableHead>
              <TableHead>Bot</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Exit</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead className="text-right">P&amp;L %</TableHead>
              <TableHead>Exit reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  No trades match.
                </TableCell>
              </TableRow>
            ) : (
              (rows ?? []).map((raw) => {
                const t = raw as Record<string, unknown>;
                const cfg = t["configs"];
                let botName = "-";
                if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
                  const n = (cfg as Record<string, unknown>)["name"];
                  if (typeof n === "string") {
                    botName = n;
                  }
                }
                return (
                  <TableRow key={String(t["id"])}>
                    <TableCell className="whitespace-nowrap text-xs">
                      <Link
                        href={`/trades/${String(t["id"])}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {new Date(String(t["exit_time"])).toISOString().replace("T", " ").slice(0, 19)}
                      </Link>
                    </TableCell>
                    <TableCell>{botName}</TableCell>
                    <TableCell>{String(t["symbol"])}</TableCell>
                    <TableCell>{String(t["side"])}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{String(t["entry_price"])}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{String(t["exit_price"])}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{String(t["pnl"])}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{String(t["pnl_pct"])}</TableCell>
                    <TableCell className="text-xs">{String(t["exit_reason"])}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span>
          Page {page} of {totalPages} ({total} trades)
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/trades?${new URLSearchParams({
                  ...Object.fromEntries(
                    Object.entries({ bot: botId, symbol, side, result, exitReason, from, to }).filter(
                      ([, v]) => v.length > 0
                    )
                  ),
                  page: String(page - 1)
                }).toString()}`}
              >
                Previous
              </Link>
          ) : null}
          {page < totalPages ? (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/trades?${new URLSearchParams({
                  ...Object.fromEntries(
                    Object.entries({ bot: botId, symbol, side, result, exitReason, from, to }).filter(
                      ([, v]) => v.length > 0
                    )
                  ),
                  page: String(page + 1)
                }).toString()}`}
              >
                Next
              </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
