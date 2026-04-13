import Link from "next/link";
import { notFound } from "next/navigation";

import { BehaviorAnalyzerDetailClient, type AnalyzerRow } from "@/components/behavior-analyzer-detail-client";
import { buttonVariants } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = Readonly<{ params: Promise<{ id: string }> }>;

/**
 * Phase 5 — analyzer detail, code editor, test run, clone.
 */
export default async function AnalyzerDetailPage(props: PageProps): Promise<React.ReactElement> {
  const { id } = await props.params;
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase.from("behavior_analyzers").select("*").eq("id", id).maybeSingle();

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }
  if (row === null) {
    notFound();
  }

  const r = row as Record<string, unknown>;
  const slug = r["slug"];
  const name = r["name"];
  const description = r["description"];
  const code = r["code"];
  const execution_mode = r["execution_mode"];
  const param_defaults = r["param_defaults"];
  const param_schema = r["param_schema"];
  const version = r["version"];
  const tested = r["tested"];
  if (
    typeof slug !== "string" ||
    typeof name !== "string" ||
    typeof code !== "string" ||
    typeof execution_mode !== "string" ||
    typeof version !== "number" ||
    typeof tested !== "boolean"
  ) {
    return <div className="text-destructive text-sm">Invalid analyzer row.</div>;
  }

  const pd =
    typeof param_defaults === "object" && param_defaults !== null && !Array.isArray(param_defaults)
      ? (param_defaults as Record<string, unknown>)
      : {};
  const ps =
    typeof param_schema === "object" && param_schema !== null && !Array.isArray(param_schema)
      ? (param_schema as Record<string, unknown>)
      : {};

  const analyzer: AnalyzerRow = {
    id,
    slug,
    name,
    description: typeof description === "string" ? description : null,
    code,
    execution_mode,
    param_defaults: pd,
    param_schema: ps,
    version,
    tested,
  };

  const { data: cycles, error: cErr } = await supabase
    .from("behavior_raw_cycles")
    .select("id, symbol, cycle_date")
    .order("cycle_date", { ascending: false })
    .limit(200);

  if (cErr !== null) {
    return <div className="text-destructive text-sm">Error loading raw cycles: {cErr.message}</div>;
  }

  const rawCycles = (cycles ?? []).map((c) => {
    const o = c as Record<string, unknown>;
    return {
      id: String(o["id"] ?? ""),
      symbol: String(o["symbol"] ?? ""),
      cycle_date: String(o["cycle_date"] ?? ""),
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{analyzer.name}</h1>
        <Link href="/behavior/analyzers" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      </div>
      <BehaviorAnalyzerDetailClient analyzer={analyzer} rawCycles={rawCycles} />
    </div>
  );
}
