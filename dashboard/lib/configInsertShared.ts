import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConfigInsertValidatedRow = Readonly<{
  name: string;
  strategy: string;
  symbol: string;
  interval: string;
  exchange: "paper" | "bitunix";
  initial_balance: number;
  params: Record<string, unknown>;
  riskMgmt: Readonly<{
    maxDailyLossPct: number;
    maxPositionSizePct: number;
  }>;
  enabled: boolean;
  changeNote: string;
}>;

type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Inserts `configs` row (version 1) plus matching `config_versions` row.
 * Used by config editor and environment promote flows.
 */
export async function insertConfigAndFirstVersion(args: Readonly<{
  supabase: SupabaseServer;
  userId: string;
  row: ConfigInsertValidatedRow;
}>): Promise<{ ok: true; configId: string } | { ok: false; message: string }> {
  const { supabase, userId, row } = args;

  const { data: inserted, error: insErr } = await supabase
    .from("configs")
    .insert({
      name: row.name,
      strategy: row.strategy,
      symbol: row.symbol,
      interval: row.interval,
      exchange: row.exchange,
      initial_balance: row.initial_balance,
      params: row.params,
      risk_mgmt: row.riskMgmt,
      credentials_ref: {},
      enabled: row.enabled,
      current_version: 1,
      created_by: userId
    })
    .select("id")
    .single();

  if (insErr !== null || inserted === null) {
    return { ok: false, message: insErr?.message ?? "Insert failed." };
  }

  const configId = inserted.id as string;

  const { error: verErr } = await supabase.from("config_versions").insert({
    config_id: configId,
    version: 1,
    params: row.params,
    risk_mgmt: row.riskMgmt,
    change_note: row.changeNote,
    created_by: userId
  });

  if (verErr !== null) {
    return { ok: false, message: verErr.message };
  }

  return { ok: true, configId };
}
