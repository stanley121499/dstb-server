"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { insertConfigAndFirstVersion, type ConfigInsertValidatedRow } from "@/lib/configInsertShared";
import {
  parseEnvironmentDerivedParamsFromUnknown,
  validateStrategyParamsForDerived,
  type EnvironmentDerivedParams
} from "@/lib/environmentDerivedParams";

const PIPELINE = ["candidate", "backtesting", "paper", "live"] as const;
type PipelineStatus = (typeof PIPELINE)[number];

function isPipelineStatus(s: string): s is PipelineStatus {
  return (PIPELINE as readonly string[]).includes(s);
}

function nextPipelineStatus(current: string): PipelineStatus | null {
  if (!isPipelineStatus(current)) {
    return null;
  }
  const i = PIPELINE.indexOf(current);
  if (i < 0 || i >= PIPELINE.length - 1) {
    return null;
  }
  return PIPELINE[i + 1] ?? null;
}

async function requireUser(): Promise<{ supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; userId: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error !== null || user === null) {
    throw new Error("Unauthorized");
  }
  return { supabase, userId: user.id };
}

function derivedToConfigRow(
  derived: EnvironmentDerivedParams,
  envName: string,
  enabled: boolean
): ConfigInsertValidatedRow {
  return {
    name: envName.trim().length > 0 ? envName.trim() : derived.name,
    strategy: derived.strategy,
    symbol: derived.symbol,
    interval: derived.interval,
    exchange: derived.exchange,
    initial_balance: derived.initial_balance,
    params: derived.params,
    riskMgmt: {
      maxDailyLossPct: derived.maxDailyLossPct,
      maxPositionSizePct: derived.maxPositionSizePct
    },
    enabled,
    changeNote: "Created from behavior environment pipeline"
  };
}

/**
 * Ensures a linked `configs` row exists when entering paper or live. Uses validated `derived_params`.
 */
async function ensureConfigForEnvironment(args: Readonly<{
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  envId: string;
  envName: string;
  derivedRaw: unknown;
  existingConfigId: string | null;
  enabledForNewConfig: boolean;
}>): Promise<{ ok: true; configId: string } | { ok: false; message: string }> {
  if (args.existingConfigId !== null && args.existingConfigId.length > 0) {
    return { ok: true, configId: args.existingConfigId };
  }

  const parsed = parseEnvironmentDerivedParamsFromUnknown(args.derivedRaw);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const strat = validateStrategyParamsForDerived(parsed.data);
  if (!strat.ok) {
    return { ok: false, message: strat.zodError };
  }

  const row = derivedToConfigRow(
    { ...parsed.data, params: strat.params },
    args.envName,
    args.enabledForNewConfig
  );

  const ins = await insertConfigAndFirstVersion({
    supabase: args.supabase,
    userId: args.userId,
    row
  });
  if (!ins.ok) {
    return ins;
  }

  const { error: upErr } = await args.supabase
    .from("behavior_environments")
    .update({ config_id: ins.configId })
    .eq("id", args.envId);

  if (upErr !== null) {
    return { ok: false, message: upErr.message };
  }

  return { ok: true, configId: ins.configId };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(300),
  rulesetId: z.string().uuid().optional().nullable(),
  derivedParamsJson: z.string().min(2),
  notes: z.string().max(5000).optional().default("")
});

export async function createEnvironmentAction(
  form: z.infer<typeof createSchema>
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const parsed = createSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((e) => e.message).join("; ") };
    }
    let derivedUnknown: unknown;
    try {
      derivedUnknown = JSON.parse(parsed.data.derivedParamsJson) as unknown;
    } catch {
      return { ok: false, message: "Derived params must be valid JSON." };
    }
    const merged = parseEnvironmentDerivedParamsFromUnknown(derivedUnknown);
    if (!merged.ok) {
      return { ok: false, message: merged.message };
    }
    const withName: EnvironmentDerivedParams = {
      ...merged.data,
      name: parsed.data.name
    };
    const strat = validateStrategyParamsForDerived(withName);
    if (!strat.ok) {
      return { ok: false, message: strat.zodError };
    }

    const { supabase, userId } = await requireUser();
    const derivedToStore = { ...withName, params: strat.params };

    const { data: row, error } = await supabase
      .from("behavior_environments")
      .insert({
        name: parsed.data.name,
        ruleset_id: parsed.data.rulesetId ?? null,
        derived_params: derivedToStore,
        notes: parsed.data.notes.length > 0 ? parsed.data.notes : null,
        status: "candidate",
        created_by: userId
      })
      .select("id")
      .single();

    if (error !== null || row === null) {
      return { ok: false, message: error?.message ?? "Insert failed." };
    }

    revalidatePath("/behavior/environments");
    return { ok: true, id: row.id as string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return { ok: false, message: msg };
  }
}

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  rulesetId: z.string().uuid().optional().nullable(),
  derivedParamsJson: z.string().min(2),
  notes: z.string().max(5000).optional().default("")
});

export async function updateEnvironmentAction(
  form: z.infer<typeof updateSchema>
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const parsed = updateSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((e) => e.message).join("; ") };
    }
    let derivedUnknown: unknown;
    try {
      derivedUnknown = JSON.parse(parsed.data.derivedParamsJson) as unknown;
    } catch {
      return { ok: false, message: "Derived params must be valid JSON." };
    }
    const merged = parseEnvironmentDerivedParamsFromUnknown(derivedUnknown);
    if (!merged.ok) {
      return { ok: false, message: merged.message };
    }
    const withName: EnvironmentDerivedParams = {
      ...merged.data,
      name: parsed.data.name
    };
    const strat = validateStrategyParamsForDerived(withName);
    if (!strat.ok) {
      return { ok: false, message: strat.zodError };
    }

    const { supabase } = await requireUser();
    const derivedToStore = { ...withName, params: strat.params };

    const { error } = await supabase
      .from("behavior_environments")
      .update({
        name: parsed.data.name,
        ruleset_id: parsed.data.rulesetId ?? null,
        derived_params: derivedToStore,
        notes: parsed.data.notes.length > 0 ? parsed.data.notes : null
      })
      .eq("id", parsed.data.id);

    if (error !== null) {
      return { ok: false, message: error.message };
    }

    revalidatePath("/behavior/environments");
    revalidatePath(`/behavior/environments/${parsed.data.id}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return { ok: false, message: msg };
  }
}

const idSchema = z.object({ id: z.string().uuid() });

export async function promoteEnvironmentAction(
  form: z.infer<typeof idSchema>
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const parsed = idSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message };
    }

    const { supabase, userId } = await requireUser();

    const { data: env, error: selErr } = await supabase
      .from("behavior_environments")
      .select("id, name, status, derived_params, config_id")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (selErr !== null) {
      return { ok: false, message: selErr.message };
    }
    if (env === null) {
      return { ok: false, message: "Environment not found." };
    }

    const status = typeof env.status === "string" ? env.status : "";
    if (status === "retired") {
      return { ok: false, message: "Cannot promote a retired environment." };
    }

    const nxt = nextPipelineStatus(status);
    if (nxt === null) {
      return { ok: false, message: "Already at live stage; use Retire to finish the pipeline." };
    }

    const existingConfigId: string | null = typeof env.config_id === "string" ? env.config_id : null;

    if (nxt === "paper" || nxt === "live") {
      const ensured = await ensureConfigForEnvironment({
        supabase,
        userId,
        envId: parsed.data.id,
        envName: typeof env.name === "string" ? env.name : "",
        derivedRaw: env.derived_params,
        existingConfigId,
        enabledForNewConfig: false
      });
      if (!ensured.ok) {
        return ensured;
      }
    }

    const { error: upErr } = await supabase
      .from("behavior_environments")
      .update({ status: nxt })
      .eq("id", parsed.data.id);

    if (upErr !== null) {
      return { ok: false, message: upErr.message };
    }

    revalidatePath("/behavior/environments");
    revalidatePath(`/behavior/environments/${parsed.data.id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return { ok: false, message: msg };
  }
}

export async function retireEnvironmentAction(
  form: z.infer<typeof idSchema>
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const parsed = idSchema.safeParse(form);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message };
    }

    const { supabase } = await requireUser();

    const { data: env, error: selErr } = await supabase
      .from("behavior_environments")
      .select("id, config_id")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (selErr !== null) {
      return { ok: false, message: selErr.message };
    }
    if (env === null) {
      return { ok: false, message: "Environment not found." };
    }

    const configId = typeof env.config_id === "string" ? env.config_id : null;

    if (configId !== null) {
      const { error: cfgErr } = await supabase.from("configs").update({ enabled: false }).eq("id", configId);
      if (cfgErr !== null) {
        return { ok: false, message: cfgErr.message };
      }
    }

    const { error: upErr } = await supabase
      .from("behavior_environments")
      .update({ status: "retired" })
      .eq("id", parsed.data.id);

    if (upErr !== null) {
      return { ok: false, message: upErr.message };
    }

    revalidatePath("/behavior/environments");
    revalidatePath(`/behavior/environments/${parsed.data.id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return { ok: false, message: msg };
  }
}
