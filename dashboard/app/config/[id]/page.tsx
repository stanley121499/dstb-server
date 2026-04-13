import { notFound } from "next/navigation";

import { ConfigEditorForm, type ConfigEditorInitial, type VersionRow } from "@/components/config-editor-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = Readonly<{ params: Promise<{ id: string }> }>;

/**
 * Edit existing config + version sidebar.
 */
export default async function EditConfigPage(props: PageProps): Promise<React.ReactElement> {
  const { id } = await props.params;
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase.from("configs").select("*").eq("id", id).maybeSingle();

  if (error !== null) {
    return <div className="text-destructive text-sm">Error: {error.message}</div>;
  }
  if (row === null) {
    notFound();
  }

  const r = row as Record<string, unknown>;
  const risk = r["risk_mgmt"];
  const rm = risk !== null && typeof risk === "object" && !Array.isArray(risk) ? (risk as Record<string, unknown>) : {};
  const maxDailyLossPct = Number(rm["maxDailyLossPct"]);
  const maxPositionSizePct = Number(rm["maxPositionSizePct"]);
  const params = r["params"];
  const paramsJson =
    params !== null && typeof params === "object" ? JSON.stringify(params, null, 2) : "{}";

  const initial: ConfigEditorInitial = {
    name: String(r["name"] ?? ""),
    strategy: String(r["strategy"] ?? ""),
    symbol: String(r["symbol"] ?? ""),
    interval: String(r["interval"] ?? ""),
    exchange: String(r["exchange"] ?? "paper"),
    initial_balance: Number(r["initial_balance"] ?? 0),
    maxDailyLossPct: Number.isFinite(maxDailyLossPct) ? maxDailyLossPct : 5,
    maxPositionSizePct: Number.isFinite(maxPositionSizePct) ? maxPositionSizePct : 100,
    paramsJson
  };

  const { data: versions } = await supabase
    .from("config_versions")
    .select("id, version, created_at, change_note, params, risk_mgmt")
    .eq("config_id", id)
    .order("version", { ascending: false });

  const vrows = (versions ?? []) as unknown as VersionRow[];

  return <ConfigEditorForm mode="edit" configId={id} initial={initial} versions={vrows} />;
}
