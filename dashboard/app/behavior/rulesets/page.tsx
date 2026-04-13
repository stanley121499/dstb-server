import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function countAnalyzers(analyzers: unknown): number {
  if (!Array.isArray(analyzers)) {
    return 0;
  }
  return analyzers.length;
}

/**
 * Phase 5 — behavior rulesets list.
 */
export default async function BehaviorRulesetsPage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("behavior_rulesets")
    .select("id, name, analyzers, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }

  const list = (rows ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Behavior rulesets</h1>
        <div className="flex gap-2">
          <Link href="/behavior/rulesets/compare" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Compare
          </Link>
          <Link href="/behavior/rulesets/new" className={buttonVariants({ size: "sm" })}>
            New ruleset
          </Link>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">Compose analyzers, run batch analysis on the bot server, and set the live active ruleset.</p>

      {list.length === 0 ? (
        <p className="text-muted-foreground text-sm">No rulesets yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Analyzers</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => {
              const id = typeof r["id"] === "string" ? r["id"] : "";
              const name = typeof r["name"] === "string" ? r["name"] : "";
              const active = r["is_active"] === true;
              const created = typeof r["created_at"] === "string" ? r["created_at"] : "";
              const n = countAnalyzers(r["analyzers"]);
              return (
                <TableRow key={id}>
                  <TableCell>
                    <Link href={`/behavior/rulesets/${id}`} className="text-primary font-medium underline">
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell>{String(n)}</TableCell>
                  <TableCell>{active ? "yes" : "no"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{created}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
