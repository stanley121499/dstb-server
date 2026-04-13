import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS_ORDER = ["candidate", "backtesting", "paper", "live", "retired"] as const;

type EnvRow = Readonly<{
  id: string;
  name: string;
  status: string;
  ruleset_id: string | null;
  config_id: string | null;
  updated_at: string;
}>;

/**
 * Phase 6 — environment pipeline board.
 */
export default async function BehaviorEnvironmentsPage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("behavior_environments")
    .select("id, name, status, ruleset_id, config_id, updated_at")
    .order("updated_at", { ascending: false });

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }

  const list = (rows ?? []) as EnvRow[];
  const byStatus = new Map<string, EnvRow[]>();
  for (const s of STATUS_ORDER) {
    byStatus.set(s, []);
  }
  for (const e of list) {
    const stRaw = e.status;
    const st = (STATUS_ORDER as readonly string[]).includes(stRaw) ? stRaw : "candidate";
    const bucket = byStatus.get(st);
    if (bucket !== undefined) {
      bucket.push(e);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Behavior environments</h1>
        <Link href="/behavior/environments/new" className={buttonVariants({ size: "sm" })}>
          New environment
        </Link>
      </div>
      <p className="text-muted-foreground text-sm max-w-3xl">
        Pipeline: candidate → backtesting → paper → live → retired. Promoting to paper or live creates a linked bot config from derived params. Retire disables the linked config.
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="space-y-2">
            <h2 className="text-sm font-semibold capitalize text-muted-foreground">{status}</h2>
            <div className="flex flex-col gap-2">
              {(byStatus.get(status) ?? []).map((e) => (
                <Card key={e.id} className="text-sm">
                  <CardHeader className="p-3 pb-0">
                    <CardTitle className="text-base leading-tight">
                      <Link href={`/behavior/environments/${e.id}`} className="text-primary hover:underline">
                        {e.name}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-1 text-xs text-muted-foreground space-y-1">
                    {e.config_id !== null ? (
                      <div>
                        Config:{" "}
                        <Link href={`/config/${e.config_id}`} className="text-primary underline">
                          view
                        </Link>
                      </div>
                    ) : (
                      <div>No config yet</div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {(byStatus.get(status) ?? []).length === 0 ? (
                <p className="text-muted-foreground text-xs">—</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
