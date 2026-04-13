import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
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

function readColumns(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = String(val);
  }
  return out;
}

type PnlRow = Readonly<{ symbol: string; exit_day: string; total_pnl: string | number | null }>;

/**
 * Phase 5 — compare two rulesets side-by-side with fuzzy realized P&amp;L column.
 */
export default async function RulesetComparePage(props: Readonly<{ searchParams: Promise<Search> }>): Promise<React.ReactElement> {
  const sp = await props.searchParams;
  const rulesetA = first(sp["a"]);
  const rulesetB = first(sp["b"]);
  const symbol = first(sp["symbol"]);
  const fromIn = first(sp["from"]);
  const toIn = first(sp["to"]);

  const supabase = await createSupabaseServerClient();

  const { data: rulesetRows } = await supabase
    .from("behavior_rulesets")
    .select("id, name")
    .order("name", { ascending: true });

  const rulesets = (rulesetRows ?? []) as Array<Record<string, unknown>>;

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 90);
  const defaultTo = end.toISOString().slice(0, 10);
  const defaultFrom = start.toISOString().slice(0, 10);
  const from = fromIn.length > 0 ? fromIn : defaultFrom;
  const to = toIn.length > 0 ? toIn : defaultTo;

  let cycles: Array<{ id: string; symbol: string; cycle_date: string }> = [];
  let mapA = new Map<string, Record<string, string>>();
  let mapB = new Map<string, Record<string, string>>();
  let pnlByKey = new Map<string, number>();
  let pnlError: string | null = null;
  let agree = 0;
  let disagree = 0;
  let emptyBoth = 0;
  const allKeys = new Set<string>();
  let keysArr: string[] = [];

  if (rulesetA.length > 0 && rulesetB.length > 0) {
    let cq = supabase
      .from("behavior_raw_cycles")
      .select("id, symbol, cycle_date")
      .gte("cycle_date", from)
      .lte("cycle_date", to)
      .order("cycle_date", { ascending: false });

    if (symbol.length > 0) {
      cq = cq.eq("symbol", symbol);
    }

    const { data: cRows, error: cErr } = await cq;
    if (cErr !== null) {
      return <div className="text-destructive text-sm">Raw cycles: {cErr.message}</div>;
    }
    cycles = (cRows ?? []).map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: String(o["id"] ?? ""),
        symbol: String(o["symbol"] ?? ""),
        cycle_date: String(o["cycle_date"] ?? ""),
      };
    });

    const cycleIds = cycles.map((c) => c.id).filter((id) => id.length > 0);

    let qA = supabase.from("behavior_results").select("raw_cycle_id, columns").eq("ruleset_id", rulesetA);
    let qB = supabase.from("behavior_results").select("raw_cycle_id, columns").eq("ruleset_id", rulesetB);
    if (cycleIds.length > 0) {
      qA = qA.in("raw_cycle_id", cycleIds);
      qB = qB.in("raw_cycle_id", cycleIds);
    }

    const [{ data: ra }, { data: rb }] = await Promise.all([qA, qB]);

    mapA = new Map();
    for (const r of ra ?? []) {
      const o = r as Record<string, unknown>;
      const rid = o["raw_cycle_id"];
      if (typeof rid === "string") {
        mapA.set(rid, readColumns(o["columns"]));
      }
    }
    mapB = new Map();
    for (const r of rb ?? []) {
      const o = r as Record<string, unknown>;
      const rid = o["raw_cycle_id"];
      if (typeof rid === "string") {
        mapB.set(rid, readColumns(o["columns"]));
      }
    }

    const { data: pnlData, error: pnlErr } = await supabase.rpc("trades_realized_pnl_by_symbol_exit_utc_date", {
      p_from: from,
      p_to: to,
    });

    if (pnlErr !== null) {
      pnlError = pnlErr.message;
    } else {
      for (const row of (pnlData ?? []) as PnlRow[]) {
        const sym = row.symbol;
        const dayRaw = row.exit_day;
        let day: string;
        if (typeof dayRaw === "string") {
          day = dayRaw.slice(0, 10);
        } else if (dayRaw !== null && typeof dayRaw === "object" && "toISOString" in dayRaw) {
          const d = dayRaw as { toISOString: () => string };
          day = typeof d.toISOString === "function" ? d.toISOString().slice(0, 10) : String(dayRaw).slice(0, 10);
        } else {
          day = String(dayRaw).slice(0, 10);
        }
        const raw = row.total_pnl;
        const num = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
        if (typeof sym === "string" && day.length >= 8 && Number.isFinite(num)) {
          pnlByKey.set(`${sym}|${day}`, num);
        }
      }
    }

    for (const c of cycles) {
      const ca = mapA.get(c.id) ?? {};
      const cb = mapB.get(c.id) ?? {};
      Object.keys(ca).forEach((k) => allKeys.add(k));
      Object.keys(cb).forEach((k) => allKeys.add(k));
    }

    keysArr = [...allKeys].sort((x, y) => x.localeCompare(y));

    for (const c of cycles) {
      const hasA = mapA.has(c.id);
      const hasB = mapB.has(c.id);

      // Exclude cycles where neither ruleset produced results — counting
      // them as "agree" (both empty → "" === "") inflates the agreement rate.
      if (!hasA && !hasB) {
        emptyBoth += 1;
        continue;
      }

      const ca = mapA.get(c.id) ?? {};
      const cb = mapB.get(c.id) ?? {};
      let same = true;
      for (const k of keysArr) {
        const va = ca[k] ?? "";
        const vb = cb[k] ?? "";
        if (va !== vb) {
          same = false;
          break;
        }
      }
      if (same) {
        agree += 1;
      } else {
        disagree += 1;
      }
    }
  }

  const totalCompared = agree + disagree;
  const agreementRate = totalCompared > 0 ? Math.round((agree / totalCompared) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Compare rulesets</h1>
        <Link href="/behavior/rulesets" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to rulesets
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <p className="text-muted-foreground text-sm">
            Uses behavior cycles in range. P&amp;L matches trades by symbol and UTC exit date (fuzzy — not a behavior-cycle FK).
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-4" method="get" action="/behavior/rulesets/compare">
            <div className="space-y-1">
              <Label htmlFor="a">Ruleset A</Label>
              <select
                name="a"
                id="a"
                className="border-input bg-background flex h-9 min-w-[12rem] rounded-md border px-3 text-sm"
                defaultValue={rulesetA}
              >
                <option value="">—</option>
                {rulesets.map((r) => {
                  const id = typeof r["id"] === "string" ? r["id"] : "";
                  const n = typeof r["name"] === "string" ? r["name"] : "";
                  return (
                    <option key={id} value={id}>
                      {n}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="b">Ruleset B</Label>
              <select
                name="b"
                id="b"
                className="border-input bg-background flex h-9 min-w-[12rem] rounded-md border px-3 text-sm"
                defaultValue={rulesetB}
              >
                <option value="">—</option>
                {rulesets.map((r) => {
                  const id = typeof r["id"] === "string" ? r["id"] : "";
                  const n = typeof r["name"] === "string" ? r["name"] : "";
                  return (
                    <option key={`b-${id}`} value={id}>
                      {n}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="from">From</Label>
              <Input name="from" id="from" type="date" defaultValue={from} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">To</Label>
              <Input name="to" id="to" type="date" defaultValue={to} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="symbol">Symbol (optional)</Label>
              <Input name="symbol" id="symbol" placeholder="BTCUSDT" defaultValue={symbol} className="w-36" />
            </div>
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              Apply
            </button>
          </form>
        </CardContent>
      </Card>

      {pnlError !== null ? (
        <p className="text-destructive text-sm">
          Realized P&amp;L RPC unavailable (apply migration `20260407150100_trades_pnl_by_exit_date_fn.sql`): {pnlError}
        </p>
      ) : null}

      {rulesetA.length > 0 && rulesetB.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-1 text-sm">
            <p>
              Cycles in view: <span className="text-foreground font-medium">{String(cycles.length)}</span>
            </p>
            <p>
              Label agreement (all columns): <span className="text-foreground font-medium">{String(agree)}</span> agree ·{" "}
              <span className="text-foreground font-medium">{String(disagree)}</span> disagree · rate{" "}
              <span className="text-foreground font-medium">{String(agreementRate)}%</span>
              {emptyBoth > 0 ? (
                <span className="text-muted-foreground ml-2 text-xs">
                  ({String(emptyBoth)} cycles excluded — neither ruleset has results)
                </span>
              ) : null}
            </p>
            <p>
              Empty <strong className="text-foreground">Realized P&amp;L (matched by date)</strong> means no trades exited that UTC day for
              that symbol — expected if the bot was idle.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {rulesetA.length > 0 && rulesetB.length > 0 && cycles.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Cycle date</TableHead>
                <TableHead
                  title="Sum of trades.pnl where symbol matches this row and UTC date(exit_time) equals cycle_date. Fuzzy proxy, not a precise link to this behavior row."
                  className="cursor-help"
                >
                  Realized P&amp;L (matched by date)
                </TableHead>
                {keysArr.map((k) => (
                  <TableHead key={`a-${k}`} className="min-w-[7rem] whitespace-normal">
                    A · {k}
                  </TableHead>
                ))}
                {keysArr.map((k) => (
                  <TableHead key={`b-${k}`} className="min-w-[7rem] whitespace-normal">
                    B · {k}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.map((c) => {
                const ca = mapA.get(c.id) ?? {};
                const cb = mapB.get(c.id) ?? {};
                const pnlKey = `${c.symbol}|${c.cycle_date}`;
                const pnl = pnlByKey.get(pnlKey);
                const pnlStr = pnl !== undefined ? String(pnl) : "";
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.symbol}</TableCell>
                    <TableCell className="text-xs">{c.cycle_date}</TableCell>
                    <TableCell className="font-mono text-xs">{pnlStr}</TableCell>
                    {keysArr.map((k) => {
                      const va = ca[k] ?? "";
                      const vb = cb[k] ?? "";
                      const diff = va !== vb;
                      return (
                        <TableCell
                          key={`ca-${c.id}-${k}`}
                          className={`text-xs ${diff ? "bg-amber-500/10 dark:bg-amber-500/15" : ""}`}
                        >
                          {va}
                        </TableCell>
                      );
                    })}
                    {keysArr.map((k) => {
                      const va = ca[k] ?? "";
                      const vb = cb[k] ?? "";
                      const diff = va !== vb;
                      return (
                        <TableCell
                          key={`cb-${c.id}-${k}`}
                          className={`text-xs ${diff ? "bg-amber-500/10 dark:bg-amber-500/15" : ""}`}
                        >
                          {vb}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {rulesetA.length > 0 && rulesetB.length > 0 && cycles.length === 0 ? (
        <p className="text-muted-foreground text-sm">No raw cycles in this range (check symbol filter).</p>
      ) : null}

      {rulesetA.length === 0 || rulesetB.length === 0 ? (
        <p className="text-muted-foreground text-sm">Select two rulesets and click Apply.</p>
      ) : null}
    </div>
  );
}
