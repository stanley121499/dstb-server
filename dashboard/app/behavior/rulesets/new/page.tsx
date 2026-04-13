import Link from "next/link";

import { BehaviorRulesetEditorClient } from "@/components/behavior-ruleset-editor-client";
import { buttonVariants } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 5 — create ruleset.
 */
export default async function NewRulesetPage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const { data: analyzers, error } = await supabase
    .from("behavior_analyzers")
    .select("id, name, slug")
    .order("name", { ascending: true });

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
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
        <h1 className="text-2xl font-semibold tracking-tight">New ruleset</h1>
        <Link href="/behavior/rulesets" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      </div>
      <BehaviorRulesetEditorClient
        initialName=""
        initialNotes=""
        initialEntries={[]}
        allAnalyzers={allAnalyzers}
        isActive={false}
      />
    </div>
  );
}
