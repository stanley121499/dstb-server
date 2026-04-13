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

function readStringRecord(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = String(val);
  }
  return out;
}

/**
 * Extracts the embedded behavior_raw_cycles object returned by PostgREST
 * for a many-to-one join (behavior_results → behavior_raw_cycles).
 * PostgREST returns the parent as a single object when joining from the
 * child side.
 */
function extractRawCycle(embed: unknown): { symbol: string; cycleDate: string } | null {
  if (typeof embed !== "object" || embed === null || Array.isArray(embed)) {
    return null;
  }
  const obj = embed as Record<string, unknown>;
  const symbol = obj["symbol"];
  const cycleDate = obj["cycle_date"];
  if (typeof symbol !== "string" || typeof cycleDate !== "string") {
    return null;
  }
  return { symbol, cycleDate: cycleDate.slice(0, 10) };
}

/**
 * Phase 4 — behavior analysis results joined with raw cycles via PostgREST
 * embedded resource select.  A single paginated query replaces the previous
 * two-step approach that fetched all result IDs then issued a giant .in()
 * query against behavior_raw_cycles, which exceeded the PostgREST URL limit
 * at ~800+ rows.
 *
 * Filters for symbol and date are pushed down to the embedded
 * behavior_raw_cycles table; label key/value filter is applied against the
 * behavior_results.columns JSONB column — all server-side.
 */
export default async function BehaviorPage(props: Readonly<{ searchParams: Promise<Search> }>): Promise<React.ReactElement> {
  const sp = await props.searchParams;
  const rulesetId = first(sp["ruleset"]);
  const symbol = first(sp["symbol"]);
  const labelKey = first(sp["labelKey"]);
  const labelVal = first(sp["labelVal"]);
  const from = first(sp["from"]);
  const to = first(sp["to"]);
  const pageRaw = first(sp["page"]);
  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const pageSize = 50;

  const supabase = await createSupabaseServerClient();

  // ------------------------------------------------------------------
  // 1. Load rulesets for the filter dropdown
  // ------------------------------------------------------------------
  const { data: rulesetRows, error: rsErr } = await supabase
    .from("behavior_rulesets")
    .select("id, name, is_active")
    .order("name", { ascending: true });

  if (rsErr !== null) {
    return <div className="text-destructive text-sm">Error loading rulesets: {rsErr.message}</div>;
  }

  const rulesets = (rulesetRows ?? []) as Array<Record<string, unknown>>;
  let activeRulesetId = rulesetId;
  if (activeRulesetId.length === 0) {
    const active = rulesets.find((r) => r["is_active"] === true);
    const id = active?.["id"];
    activeRulesetId = typeof id === "string" ? id : "";
  }
  if (activeRulesetId.length === 0 && rulesets.length > 0) {
    const id0 = rulesets[0]?.["id"];
    activeRulesetId = typeof id0 === "string" ? id0 : "";
  }

  if (activeRulesetId.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Behavior</h1>
        <p className="text-sm text-muted-foreground">No behavior rulesets found. Apply Phase 4 migration and seed.</p>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to bots
        </Link>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // 2. Single paginated query: behavior_results joined to behavior_raw_cycles
  //    via PostgREST embedded resource select (!inner = inner join, so
  //    results without a matching cycle are excluded).
  //
  //    Filters on the embedded table use the "table.column" notation which
  //    PostgREST translates to a WHERE clause on the joined row.
  // ------------------------------------------------------------------
  const fromIdx = (page - 1) * pageSize;

  let q = supabase
    .from("behavior_results")
    .select(
      `id,
       raw_cycle_id,
       columns,
       behavior_raw_cycles!inner (
         id,
         symbol,
         cycle_date
       )`,
      { count: "exact" }
    )
    .eq("ruleset_id", activeRulesetId)
    .order("created_at", { ascending: false });

  // Symbol filter → pushed down to the embedded behavior_raw_cycles row
  if (symbol.length > 0) {
    q = q.filter("behavior_raw_cycles.symbol", "ilike", `%${symbol}%`);
  }

  // Date range filters → pushed down to behavior_raw_cycles.cycle_date
  if (from.length > 0) {
    q = q.filter("behavior_raw_cycles.cycle_date", "gte", from);
  }
  if (to.length > 0) {
    q = q.filter("behavior_raw_cycles.cycle_date", "lte", to);
  }

  // Label key/value → filter on behavior_results.columns JSONB using
  // the ->> text extraction operator supported by PostgREST.
  if (labelKey.length > 0 && labelVal.length > 0) {
    q = q.filter(`columns->>${labelKey}`, "eq", labelVal);
  }

  const { data: resultPage, count: countRaw, error: resErr } = await q.range(fromIdx, fromIdx + pageSize - 1);

  if (resErr !== null) {
    return <div className="text-destructive text-sm">Error loading results: {resErr.message}</div>;
  }

  // ------------------------------------------------------------------
  // 3. Shape the response rows into the Merged type
  // ------------------------------------------------------------------
  type Merged = Readonly<{
    rawCycleId: string;
    symbol: string;
    cycleDate: string;
    columns: Record<string, string>;
  }>;

  const pageRows: Merged[] = [];
  for (const row of (resultPage ?? []) as Array<Record<string, unknown>>) {
    const rawCycleId = row["raw_cycle_id"];
    if (typeof rawCycleId !== "string") {
      continue;
    }
    const cycle = extractRawCycle(row["behavior_raw_cycles"]);
    if (cycle === null) {
      continue;
    }
    pageRows.push({
      rawCycleId,
      symbol: cycle.symbol,
      cycleDate: cycle.cycleDate,
      columns: readStringRecord(row["columns"]),
    });
  }

  // Discover visible column keys from the current page only (max 50 rows).
  const columnKeys = new Set<string>();
  for (const m of pageRows) {
    for (const k of Object.keys(m.columns)) {
      columnKeys.add(k);
    }
  }
  const displayCols = [...columnKeys].sort((a, b) => a.localeCompare(b)).slice(0, 24);

  const total = countRaw ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Behavior</h1>
          <p className="text-sm text-muted-foreground">Cycle-level labels from Supabase behavior_results.</p>
          <p className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <Link href="/behavior/analyzers" className="underline">
              Analyzers
            </Link>
            <Link href="/behavior/rulesets" className="underline">
              Rulesets
            </Link>
            <Link href="/behavior/rulesets/compare" className="underline">
              Compare rulesets
            </Link>
            <Link href="/behavior/environments" className="underline">
              Environments
            </Link>
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to bots
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3 lg:grid-cols-4" method="get">
            <div className="space-y-2">
              <Label htmlFor="ruleset">Ruleset</Label>
              <select
                name="ruleset"
                id="ruleset"
                defaultValue={activeRulesetId}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {rulesets.map((row) => {
                  const id = String(row["id"] ?? "");
                  const name = String(row["name"] ?? id);
                  return (
                    <option key={id} value={id}>
                      {name}
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
              <Label htmlFor="from">From (date)</Label>
              <Input name="from" id="from" type="date" defaultValue={from} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To (date)</Label>
              <Input name="to" id="to" type="date" defaultValue={to} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labelKey">Label key</Label>
              <Input name="labelKey" id="labelKey" defaultValue={labelKey} placeholder="resolvedDecisionOutput" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labelVal">Label value</Label>
              <Input name="labelVal" id="labelVal" defaultValue={labelVal} placeholder="ACCEPTANCE" />
            </div>
            <div className="flex items-end gap-2 md:col-span-2">
              <button type="submit" className={buttonVariants({ variant: "default" })}>
                Apply
              </button>
              <a href="/behavior" className={buttonVariants({ variant: "secondary" })}>
                Clear
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cycle (UTC date)</TableHead>
              <TableHead>Symbol</TableHead>
              {displayCols.map((c) => (
                <TableHead key={c} className="max-w-[140px] truncate text-xs">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2 + displayCols.length} className="text-center text-muted-foreground">
                  No rows match.
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((m) => (
                <TableRow key={m.rawCycleId}>
                  <TableCell className="whitespace-nowrap text-xs">
                    <Link href={`/behavior/${m.rawCycleId}`} className="text-primary underline-offset-4 hover:underline">
                      {m.cycleDate}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{m.symbol}</TableCell>
                  {displayCols.map((c) => (
                    <TableCell key={c} className="max-w-[140px] truncate text-xs font-mono">
                      {m.columns[c] ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span>
          Page {page} of {totalPages} ({total} cycles)
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/behavior?${new URLSearchParams({
                ...Object.fromEntries(
                  Object.entries({ ruleset: activeRulesetId, symbol, from, to, labelKey, labelVal }).filter(([, v]) => v.length > 0)
                ),
                page: String(page - 1),
              }).toString()}`}
            >
              Previous
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/behavior?${new URLSearchParams({
                ...Object.fromEntries(
                  Object.entries({ ruleset: activeRulesetId, symbol, from, to, labelKey, labelVal }).filter(([, v]) => v.length > 0)
                ),
                page: String(page + 1),
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
