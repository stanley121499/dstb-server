import Link from "next/link";
import { notFound } from "next/navigation";

import { EnvironmentActionsClient } from "@/components/environment-actions-client";
import { EnvironmentFormClient, type RulesetOption } from "@/components/environment-form-client";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

/**
 * Phase 6 — environment detail, edit, pipeline actions, backtest stats preview.
 */
export default async function EnvironmentDetailPage(props: Props): Promise<React.ReactElement> {
  const { id } = await props.params;
  const supabase = await createSupabaseServerClient();

  const { data: env, error: envErr } = await supabase
    .from("behavior_environments")
    .select("id, name, status, ruleset_id, config_id, derived_params, backtest_stats, live_stats, notes, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (envErr !== null) {
    return <div className="text-destructive text-sm">Error: {envErr.message}</div>;
  }
  if (env === null) {
    notFound();
  }

  const row = env as Record<string, unknown>;
  const name = typeof row["name"] === "string" ? row["name"] : "";
  const status = typeof row["status"] === "string" ? row["status"] : "";
  const rulesetId = typeof row["ruleset_id"] === "string" ? row["ruleset_id"] : "";
  const configId = typeof row["config_id"] === "string" ? row["config_id"] : null;
  const notes = typeof row["notes"] === "string" ? row["notes"] : "";
  const derivedParamsJson = JSON.stringify(row["derived_params"] ?? {}, null, 2);
  const backtestStats = row["backtest_stats"];
  const liveStats = row["live_stats"];

  const { data: rulesets, error: rsErr } = await supabase
    .from("behavior_rulesets")
    .select("id, name")
    .order("name", { ascending: true });

  if (rsErr !== null) {
    return <div className="text-destructive text-sm">Error: {rsErr.message}</div>;
  }

  const rs: RulesetOption[] = (rulesets ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    return { id: String(o["id"] ?? ""), name: String(o["name"] ?? "") };
  });

  const trades =
    backtestStats !== null &&
    typeof backtestStats === "object" &&
    !Array.isArray(backtestStats) &&
    "trades" in backtestStats &&
    Array.isArray((backtestStats as { trades: unknown }).trades)
      ? ((backtestStats as { trades: Array<Record<string, unknown>> }).trades)
      : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <Link href="/behavior/environments" className={buttonVariants({ variant: "outline", size: "sm" })}>
          All environments
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <EnvironmentActionsClient environmentId={id} status={status} configId={configId} />
        <div className="rounded-lg border p-4 space-y-2">
          <h2 className="text-lg font-medium">Stats (JSON)</h2>
          <p className="text-muted-foreground text-xs">Paper / live aggregates can be stored under `live_stats`.</p>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">
            {JSON.stringify({ backtest: backtestStats, live: liveStats }, null, 2)}
          </pre>
        </div>
      </div>

      {trades.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Backtest trades (last run)</h2>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead>PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.slice(0, 100).map((t, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{String(t["session_date_ny"] ?? "")}</TableCell>
                    <TableCell>{String(t["direction"] ?? "")}</TableCell>
                    <TableCell className="font-mono text-xs">{String(t["entry_price"] ?? "")}</TableCell>
                    <TableCell className="font-mono text-xs">{String(t["exit_price"] ?? "")}</TableCell>
                    <TableCell className="font-mono text-xs">{String(t["pnl"] ?? "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {trades.length > 100 ? <p className="text-muted-foreground text-xs">Showing first 100 of {trades.length}.</p> : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Edit</h2>
        <EnvironmentFormClient
          mode="edit"
          environmentId={id}
          initialName={name}
          initialRulesetId={rulesetId}
          initialDerivedParamsJson={derivedParamsJson}
          initialNotes={notes}
          rulesets={rs}
        />
      </div>
    </div>
  );
}
