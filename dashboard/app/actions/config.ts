"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dashboardConfigFieldsSchema, parseAndValidateParams } from "@/lib/configFormValidation";
import { insertConfigAndFirstVersion } from "@/lib/configInsertShared";

export type ConfigActionState = Readonly<{
  ok: boolean;
  message?: string;
  warning?: string;
}>;

const updatePayloadSchema = dashboardConfigFieldsSchema.extend({
  configId: z.string().uuid()
});

/**
 * Updates a config row, appends `config_versions`, preserves `credentials_ref`.
 */
export async function updateConfigAction(payload: unknown): Promise<ConfigActionState> {
  const parsed = updatePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const row = parsed.data;
  const pv = parseAndValidateParams({ strategy: row.strategy, paramsJson: row.paramsJson });
  if (!pv.ok) {
    return { ok: false, message: pv.zodError };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user === null) {
    return { ok: false, message: "Not authenticated." };
  }

  const { data: existing, error: selErr } = await supabase
    .from("configs")
    .select("id, current_version, credentials_ref")
    .eq("id", row.configId)
    .maybeSingle();

  if (selErr !== null) {
    return { ok: false, message: selErr.message };
  }
  if (existing === null) {
    return { ok: false, message: "Config not found." };
  }

  const currentVersion = Number(existing.current_version);
  const nextVersion = currentVersion + 1;
  const riskMgmt = {
    maxDailyLossPct: row.maxDailyLossPct,
    maxPositionSizePct: row.maxPositionSizePct
  };

  const { error: verErr } = await supabase.from("config_versions").insert({
    config_id: row.configId,
    version: nextVersion,
    params: pv.params,
    risk_mgmt: riskMgmt,
    change_note: row.changeNote ?? null,
    created_by: user.id
  });

  if (verErr !== null) {
    return { ok: false, message: verErr.message };
  }

  const creds = existing.credentials_ref;
  const credentialsRef =
    creds !== null && typeof creds === "object" && !Array.isArray(creds) ? (creds as Record<string, unknown>) : {};

  const { error: upErr } = await supabase
    .from("configs")
    .update({
      name: row.name,
      strategy: row.strategy,
      symbol: row.symbol,
      interval: row.interval,
      exchange: row.exchange,
      initial_balance: row.initial_balance,
      params: pv.params,
      risk_mgmt: riskMgmt,
      credentials_ref: credentialsRef,
      current_version: nextVersion
    })
    .eq("id", row.configId);

  if (upErr !== null) {
    return { ok: false, message: upErr.message };
  }

  revalidatePath("/");
  revalidatePath(`/config/${row.configId}`);
  return { ok: true, warning: pv.warning ?? undefined };
}

/**
 * Creates a new config with `enabled: false`, `current_version: 1`, and an initial version row.
 */
export async function createConfigAction(payload: unknown): Promise<ConfigActionState & { configId?: string }> {
  const parsed = dashboardConfigFieldsSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const row = parsed.data;
  const pv = parseAndValidateParams({ strategy: row.strategy, paramsJson: row.paramsJson });
  if (!pv.ok) {
    return { ok: false, message: pv.zodError };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user === null) {
    return { ok: false, message: "Not authenticated." };
  }

  const riskMgmt = {
    maxDailyLossPct: row.maxDailyLossPct,
    maxPositionSizePct: row.maxPositionSizePct
  };

  const inserted = await insertConfigAndFirstVersion({
    supabase,
    userId: user.id,
    row: {
      name: row.name,
      strategy: row.strategy,
      symbol: row.symbol,
      interval: row.interval,
      exchange: row.exchange,
      initial_balance: row.initial_balance,
      params: pv.params,
      riskMgmt,
      enabled: false,
      changeNote: row.changeNote ?? "Initial version"
    }
  });

  if (!inserted.ok) {
    return { ok: false, message: inserted.message };
  }

  revalidatePath("/");
  return { ok: true, configId: inserted.configId, warning: pv.warning ?? undefined };
}
