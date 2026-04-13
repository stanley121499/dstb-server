import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BotGrid, type BotGridRow } from "@/components/bot-grid";

/**
 * Home: bot grid with today P&amp;L (UTC) per bot.
 */
export default async function HomePage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const { data: configs, error } = await supabase
    .from("configs")
    .select("id, name, strategy, symbol, interval, exchange, enabled, bots ( id, status, equity, last_heartbeat )")
    .order("name", { ascending: true });

  if (error !== null) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
        Failed to load configs: {error.message}
      </div>
    );
  }

  const rows = (configs ?? []) as unknown as BotGridRow[];

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: tradesToday } = await supabase
    .from("trades")
    .select("bot_id, pnl")
    .gte("exit_time", dayStart.toISOString());

  const todayPnlByBotId: Record<string, number> = {};
  for (const t of tradesToday ?? []) {
    const rec = t as { bot_id: string; pnl: string | number };
    const id = rec.bot_id;
    const p = typeof rec.pnl === "string" ? Number(rec.pnl) : rec.pnl;
    if (!Number.isFinite(p)) {
      continue;
    }
    todayPnlByBotId[id] = (todayPnlByBotId[id] ?? 0) + p;
  }

  return <BotGrid rows={rows} todayPnlByBotId={todayPnlByBotId} />;
}
