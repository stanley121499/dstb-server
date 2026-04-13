import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 5 — list registered behavior analyzers.
 */
export default async function BehaviorAnalyzersPage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("behavior_analyzers")
    .select("id, slug, name, version, tested, updated_at")
    .order("updated_at", { ascending: false });

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }

  const list = (rows ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Behavior analyzers</h1>
        <Link href="/behavior/analyzers/new" className={buttonVariants({ size: "sm" })}>
          New analyzer
        </Link>
      </div>
      <p className="text-muted-foreground text-sm">
        Manage sandbox and native analyzers. Use Test Run on a detail page before promoting to a ruleset.
      </p>

      {list.length === 0 ? (
        <p className="text-muted-foreground text-sm">No analyzers yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Tested</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => {
              const id = typeof r["id"] === "string" ? r["id"] : "";
              const name = typeof r["name"] === "string" ? r["name"] : "";
              const slug = typeof r["slug"] === "string" ? r["slug"] : "";
              const version = typeof r["version"] === "number" ? r["version"] : 0;
              const tested = r["tested"] === true;
              const updated = typeof r["updated_at"] === "string" ? r["updated_at"] : "";
              return (
                <TableRow key={id}>
                  <TableCell>
                    <Link href={`/behavior/analyzers/${id}`} className="text-primary font-medium underline">
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{slug}</TableCell>
                  <TableCell>{String(version)}</TableCell>
                  <TableCell>{tested ? "yes" : "no"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{updated}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
