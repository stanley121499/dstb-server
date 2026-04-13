import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BehaviorCycleChart } from "@/components/behavior-cycle-chart";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseBehaviorCandlesJson } from "@/lib/behaviorChart";

const uuidSchema = z.string().uuid();

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

function readRefLevels(raw: unknown): { pdh: number | null; pdl: number | null; sessionOpen: number | null } {
  if (typeof raw !== "object" || raw === null) {
    return { pdh: null, pdl: null, sessionOpen: null };
  }
  const o = raw as Record<string, unknown>;
  return {
    pdh: readNum(o["pdh"]),
    pdl: readNum(o["pdl"]),
    sessionOpen: readNum(o["sessionOpen"]),
  };
}

/**
 * Single raw behavior cycle with 15m chart and reference levels.
 */
export default async function BehaviorCycleDetailPage(
  props: Readonly<{ params: Promise<{ rawCycleId: string }> }>
): Promise<React.ReactElement> {
  const { rawCycleId } = await props.params;
  const parsed = uuidSchema.safeParse(rawCycleId);
  if (!parsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data: rawRow, error } = await supabase
    .from("behavior_raw_cycles")
    .select("id, symbol, cycle_date, candles, reference_levels, metadata")
    .eq("id", parsed.data)
    .maybeSingle();

  if (error !== null || rawRow === null) {
    notFound();
  }

  const row = rawRow as Record<string, unknown>;
  const candlesJson = row["candles"];
  let candles15: unknown = undefined;
  if (typeof candlesJson === "object" && candlesJson !== null && !Array.isArray(candlesJson)) {
    const cj = candlesJson as Record<string, unknown>;
    candles15 = cj["15m"];
  }
  const chartCandles = parseBehaviorCandlesJson(candles15);
  const ref = readRefLevels(row["reference_levels"]);

  const meta =
    typeof row["metadata"] === "object" && row["metadata"] !== null
      ? JSON.stringify(row["metadata"], null, 2)
      : String(row["metadata"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Behavior cycle</h1>
          <p className="text-sm text-muted-foreground">
            {String(row["symbol"])} · {String(row["cycle_date"]).slice(0, 10)}
          </p>
        </div>
        <Link href="/behavior" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to behavior
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">15m context</CardTitle>
        </CardHeader>
        <CardContent>
          <BehaviorCycleChart candles={chartCandles} pdh={ref.pdh} pdl={ref.pdl} sessionOpen={ref.sessionOpen} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">{meta}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
