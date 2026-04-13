"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "Slug: lowercase letters, digits, _ and -");

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

const InsertSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  code: z.string().min(1),
  execution_mode: z.enum(["sandbox", "native_s2"]),
  param_defaults_json: z.string().default("{}"),
  param_schema_json: z.string().default("{}"),
});

/**
 * Creates a new behavior analyzer row.
 */
export async function createAnalyzer(form: z.infer<typeof InsertSchema>): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const parsed = InsertSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((e) => e.message).join("; ") };
    }
    const { supabase, userId } = await requireUser();

    let param_defaults: Record<string, unknown>;
    let param_schema: Record<string, unknown>;
    try {
      param_defaults = JSON.parse(parsed.data.param_defaults_json) as Record<string, unknown>;
      param_schema = JSON.parse(parsed.data.param_schema_json) as Record<string, unknown>;
    } catch {
      return { ok: false, message: "param_defaults or param_schema is not valid JSON" };
    }

    const { data, error } = await supabase
      .from("behavior_analyzers")
      .insert({
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description.length > 0 ? parsed.data.description : null,
        code: parsed.data.code,
        execution_mode: parsed.data.execution_mode,
        param_defaults,
        param_schema,
        version: 1,
        tested: false,
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
    revalidatePath("/behavior/analyzers");
    return { ok: true, id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  code: z.string().min(1),
  execution_mode: z.enum(["sandbox", "native_s2"]),
  param_defaults_json: z.string().default("{}"),
  param_schema_json: z.string().default("{}"),
});

/**
 * Updates analyzer fields and bumps `version` by 1.
 */
export async function updateAnalyzer(form: z.infer<typeof UpdateSchema>): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const parsed = UpdateSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((e) => e.message).join("; ") };
    }
    const { supabase } = await requireUser();

    const { data: cur, error: curErr } = await supabase
      .from("behavior_analyzers")
      .select("version")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (curErr !== null) {
      return { ok: false, message: curErr.message };
    }
    const v = (cur as Record<string, unknown> | null)?.["version"];
    const nextVersion = typeof v === "number" ? v + 1 : 1;

    let param_defaults: Record<string, unknown>;
    let param_schema: Record<string, unknown>;
    try {
      param_defaults = JSON.parse(parsed.data.param_defaults_json) as Record<string, unknown>;
      param_schema = JSON.parse(parsed.data.param_schema_json) as Record<string, unknown>;
    } catch {
      return { ok: false, message: "param_defaults or param_schema is not valid JSON" };
    }

    const { error } = await supabase
      .from("behavior_analyzers")
      .update({
        name: parsed.data.name,
        description: parsed.data.description.length > 0 ? parsed.data.description : null,
        code: parsed.data.code,
        execution_mode: parsed.data.execution_mode,
        param_defaults,
        param_schema,
        version: nextVersion,
        tested: false,
      })
      .eq("id", parsed.data.id);

    if (error !== null) {
      return { ok: false, message: error.message };
    }
    revalidatePath("/behavior/analyzers");
    revalidatePath(`/behavior/analyzers/${parsed.data.id}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

const CloneSchema = z.object({
  sourceId: z.string().uuid(),
  slug: SlugSchema,
  name: z.string().min(1).max(200),
});

/**
 * Clones an analyzer with a new slug and `version` 1.
 */
export async function cloneAnalyzer(form: z.infer<typeof CloneSchema>): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const parsed = CloneSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((e) => e.message).join("; ") };
    }
    const { supabase, userId } = await requireUser();

    const { data: src, error: srcErr } = await supabase.from("behavior_analyzers").select("*").eq("id", parsed.data.sourceId).maybeSingle();

    if (srcErr !== null) {
      return { ok: false, message: srcErr.message };
    }
    if (src === null) {
      return { ok: false, message: "Source analyzer not found" };
    }

    const row = src as Record<string, unknown>;
    const { data, error } = await supabase
      .from("behavior_analyzers")
      .insert({
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: row["description"],
        code: row["code"],
        execution_mode: row["execution_mode"],
        param_defaults: row["param_defaults"],
        param_schema: row["param_schema"],
        version: 1,
        tested: false,
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
    revalidatePath("/behavior/analyzers");
    return { ok: true, id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
