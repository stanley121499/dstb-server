import Link from "next/link";

import { EnvironmentFormClient, type RulesetOption } from "@/components/environment-form-client";
import { buttonVariants } from "@/components/ui/button";
import { defaultDerivedParamsJson } from "@/lib/environmentDerivedParams";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 6 — create behavior environment.
 */
export default async function NewEnvironmentPage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const { data: rulesets, error } = await supabase
    .from("behavior_rulesets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }

  const rs: RulesetOption[] = (rulesets ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    return { id: String(o["id"] ?? ""), name: String(o["name"] ?? "") };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">New environment</h1>
        <Link href="/behavior/environments" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      </div>
      <EnvironmentFormClient
        mode="create"
        initialName=""
        initialRulesetId=""
        initialDerivedParamsJson={defaultDerivedParamsJson}
        initialNotes=""
        rulesets={rs}
      />
    </div>
  );
}
