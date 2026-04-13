import Link from "next/link";

import { LogsPageClient } from "@/components/logs-page-client";
import { buttonVariants } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LogRowView } from "@/app/logs/types";

type Search = Readonly<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  if (v === undefined) {
    return "";
  }
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export type { LogRowView } from "@/app/logs/types";

/**
 * Phase 6 — filterable bot log viewer with optional Realtime inserts.
 */
export default async function LogsPage(props: Readonly<{ searchParams: Promise<Search> }>): Promise<React.ReactElement> {
  const sp = await props.searchParams;
  const botId = first(sp["bot"]);
  const level = first(sp["level"]);
  const from = first(sp["from"]);
  const to = first(sp["to"]);

  const supabase = await createSupabaseServerClient();

  const { data: botRows, error: botErr } = await supabase
    .from("bots")
    .select("id, config_id, configs(name)")
    .order("created_at", { ascending: false });

  if (botErr !== null) {
    return <div className="text-destructive text-sm">Error loading bots: {botErr.message}</div>;
  }

  const botOptions = (botRows ?? []).map((b) => {
    const o = b as Record<string, unknown>;
    const id = typeof o["id"] === "string" ? o["id"] : "";
    const cfg = o["configs"];
    let name = "";
    if (typeof cfg === "object" && cfg !== null && !Array.isArray(cfg)) {
      const n = (cfg as Record<string, unknown>)["name"];
      if (typeof n === "string") {
        name = n;
      }
    }
    return { id, label: name.length > 0 ? `${name} (${id.slice(0, 8)}…)` : id };
  });

  let q = supabase
    .from("bot_logs")
    .select("id, bot_id, level, event, message, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(400);

  if (botId.length > 0) {
    q = q.eq("bot_id", botId);
  }
  if (level.length > 0) {
    q = q.eq("level", level);
  }
  if (from.length > 0) {
    q = q.gte("created_at", `${from}T00:00:00.000Z`);
  }
  if (to.length > 0) {
    q = q.lte("created_at", `${to}T23:59:59.999Z`);
  }

  const { data: logRows, error: logErr } = await q;

  if (logErr !== null) {
    return <div className="text-destructive text-sm">Error loading logs: {logErr.message}</div>;
  }

  const labelByBot = new Map<string, string>();
  for (const o of botOptions) {
    labelByBot.set(o.id, o.label);
  }

  const initial: LogRowView[] = (logRows ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    const bid = typeof o["bot_id"] === "string" ? o["bot_id"] : null;
    const meta =
      typeof o["metadata"] === "object" && o["metadata"] !== null && !Array.isArray(o["metadata"])
        ? (o["metadata"] as Record<string, unknown>)
        : {};
    return {
      id: Number(o["id"]),
      bot_id: bid,
      level: String(o["level"] ?? ""),
      event: String(o["event"] ?? ""),
      message: String(o["message"] ?? ""),
      metadata: meta,
      created_at: String(o["created_at"] ?? ""),
      bot_label: bid !== null ? (labelByBot.get(bid) ?? bid) : "—"
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Bot logs</h1>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Bots
        </Link>
      </div>
      <p className="text-muted-foreground text-sm max-w-2xl">
        Filter by bot, level, and date. New rows stream when Realtime includes <code className="text-xs">bot_logs</code> (Phase 6
        migration).
      </p>
      <LogsPageClient
        initialRows={initial}
        botOptions={botOptions}
        initialBot={botId}
        initialLevel={level}
        initialFrom={from}
        initialTo={to}
      />
    </div>
  );
}
