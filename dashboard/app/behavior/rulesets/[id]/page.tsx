import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BehaviorRulesetEditorClient, type RulesetEntry } from "@/components/behavior-ruleset-editor-client";
import { buttonVariants } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EntrySchema = z.object({
  analyzer_id: z.string().uuid(),
  params: z.record(z.unknown()).optional().default({}),
});

type PageProps = Readonly<{ params: Promise<{ id: string }> }>;

/**
 * Phase 5 — edit ruleset.
 */
export default async function RulesetDetailPage(props: PageProps): Promise<React.ReactElement> {
  const { id } = await props.params;
  const supabase = await createSupabaseServerClient();

  const { data: rs, error } = await supabase.from("behavior_rulesets").select("*").eq("id", id).maybeSingle();

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }
  if (rs === null) {
    notFound();
  }

  const row = rs as Record<string, unknown>;
  const name = typeof row["name"] === "string" ? row["name"] : "";
  const notes = typeof row["notes"] === "string" ? row["notes"] : "";
  const isActive = row["is_active"] === true;
  const analyzersJson = row["analyzers"];
  let initialEntries: RulesetEntry[] = [];
  if (Array.isArray(analyzersJson)) {
    for (const item of analyzersJson) {
      const p = EntrySchema.safeParse(item);
      if (p.success) {
        initialEntries.push({ analyzer_id: p.data.analyzer_id, params: p.data.params });
      }
    }
  }

  const { data: analyzers, error: aErr } = await supabase
    .from("behavior_analyzers")
    .select("id, name, slug")
    .order("name", { ascending: true });

  if (aErr !== null) {
    return <div className="text-destructive text-sm">Error: {aErr.message}</div>;
  }

  const allAnalyzers = (analyzers ?? []).map((a) => {
    const o = a as Record<string, unknown>;
    return {
      id: String(o["id"] ?? ""),
      name: String(o["name"] ?? ""),
      slug: String(o["slug"] ?? ""),
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <Link href="/behavior/rulesets" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      </div>
      <BehaviorRulesetEditorClient
        rulesetId={id}
        initialName={name}
        initialNotes={notes}
        initialEntries={initialEntries}
        allAnalyzers={allAnalyzers}
        isActive={isActive}
      />
    </div>
  );
}
