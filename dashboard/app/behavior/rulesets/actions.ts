"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const EntrySchema = z.object({
  analyzer_id: z.string().uuid(),
  params: z.record(z.unknown()).default({}),
});

const RulesetUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  notes: z.string().max(5000).optional().default(""),
  analyzers_json: z.string().min(2),
});

async function requireUser(): Promise<{ supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; userId: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error !== null || user === null) {
    throw new Error("Unauthorized");
  }
  return { supabase, userId: user.id };
}

function parseAnalyzersJson(raw: string): { ok: true; entries: z.infer<typeof EntrySchema>[] } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, message: "Analyzers JSON is invalid" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: "Analyzers must be a JSON array" };
  }
  const entries: z.infer<typeof EntrySchema>[] = [];
  for (const item of parsed) {
    const r = EntrySchema.safeParse(item);
    if (!r.success) {
      return { ok: false, message: r.error.message };
    }
    entries.push(r.data);
  }
  return { ok: true, entries };
}

/**
 * Creates or updates a ruleset (`analyzers` JSON array).
 */
export async function upsertRuleset(
  form: z.infer<typeof RulesetUpsertSchema>
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const parsed = RulesetUpsertSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((e) => e.message).join("; ") };
    }
    const analyzers = parseAnalyzersJson(parsed.data.analyzers_json);
    if (!analyzers.ok) {
      return { ok: false, message: analyzers.message };
    }

    const { supabase, userId } = await requireUser();

    if (parsed.data.id !== undefined) {
      const { error } = await supabase
        .from("behavior_rulesets")
        .update({
          name: parsed.data.name,
          notes: parsed.data.notes.length > 0 ? parsed.data.notes : null,
          analyzers: analyzers.entries,
        })
        .eq("id", parsed.data.id);

      if (error !== null) {
        return { ok: false, message: error.message };
      }
      revalidatePath("/behavior/rulesets");
      revalidatePath(`/behavior/rulesets/${parsed.data.id}`);
      return { ok: true, id: parsed.data.id };
    }

    const { data, error } = await supabase
      .from("behavior_rulesets")
      .insert({
        name: parsed.data.name,
        notes: parsed.data.notes.length > 0 ? parsed.data.notes : null,
        analyzers: analyzers.entries,
        is_active: false,
        created_by: userId,
      })
      .select("id")
      .single();

    if (error !== null) {
      return { ok: false, message: error.message };
    }
    const id = (data as Record<string, unknown>)["id"];
    if (typeof id !== "string") {
      return { ok: false, message: "Insert returned no id" };
    }
    revalidatePath("/behavior/rulesets");
    return { ok: true, id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

/**
 * Sets exactly one active ruleset (others become inactive). Relies on partial unique index when migration applied.
 */
export async function setActiveRuleset(rulesetId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const idParsed = z.string().uuid().safeParse(rulesetId);
    if (!idParsed.success) {
      return { ok: false, message: "Invalid ruleset id" };
    }
    const { supabase } = await requireUser();

    const { error: offErr } = await supabase.from("behavior_rulesets").update({ is_active: false }).eq("is_active", true);
    if (offErr !== null) {
      return { ok: false, message: offErr.message };
    }

    const { error: onErr } = await supabase.from("behavior_rulesets").update({ is_active: true }).eq("id", rulesetId);
    if (onErr !== null) {
      return { ok: false, message: onErr.message };
    }

    revalidatePath("/behavior/rulesets");
    revalidatePath("/behavior");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
