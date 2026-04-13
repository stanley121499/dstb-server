import type { Logger } from "../core/Logger.js";
import type { SupabaseStateStore } from "../core/SupabaseStateStore.js";
import type { TelegramAlerter } from "../monitoring/TelegramAlerter.js";

type Row = Readonly<{
  id: string;
  equity: string | number | null;
  configs: { initial_balance: string | number; name: string } | null;
}>;

const lastAlertByBotMs = new Map<string, number>();

/**
 * Periodically alerts (Telegram) when reported equity falls below a fraction of configured initial balance.
 * Env: `BOT_EQUITY_ALERT_INTERVAL_MS` (default 300_000), `BOT_EQUITY_DROP_ALERT_PCT` (default 15), `BOT_EQUITY_ALERT_COOLDOWN_MS` (default 21_600_000).
 */
export function startEquityDropAlertLoop(args: Readonly<{
  store: SupabaseStateStore;
  logger: Logger;
  telegram: TelegramAlerter;
}>): ReturnType<typeof setInterval> {
  const intervalMsRaw = process.env["BOT_EQUITY_ALERT_INTERVAL_MS"];
  const intervalMs =
    typeof intervalMsRaw === "string" && intervalMsRaw.trim().length > 0
      ? Math.max(60_000, parseInt(intervalMsRaw, 10) || 300_000)
      : 300_000;

  const dropPctRaw = process.env["BOT_EQUITY_DROP_ALERT_PCT"];
  const dropPct =
    typeof dropPctRaw === "string" && dropPctRaw.trim().length > 0
      ? Math.min(95, Math.max(1, parseFloat(dropPctRaw) || 15))
      : 15;

  const cooldownMsRaw = process.env["BOT_EQUITY_ALERT_COOLDOWN_MS"];
  const cooldownMs =
    typeof cooldownMsRaw === "string" && cooldownMsRaw.trim().length > 0
      ? Math.max(300_000, parseInt(cooldownMsRaw, 10) || 21_600_000)
      : 21_600_000;

  const thresholdFactor = 1 - dropPct / 100;

  const tick = (): void => {
    void (async () => {
      try {
        const { data, error } = await args.store.client
          .from("bots")
          .select("id, equity, configs(initial_balance, name)")
          .eq("status", "running");

        if (error !== null) {
          args.logger.warn(`Equity alert query failed: ${error.message}`, { event: "equity_alert_query" });
          return;
        }

        const rows = (data ?? []) as Row[];
        const now = Date.now();

        for (const r of rows) {
          const equityNum = typeof r.equity === "number" ? r.equity : Number(r.equity);
          const cfg = r.configs;
          if (cfg === null || typeof cfg !== "object") {
            continue;
          }
          const initialNum =
            typeof cfg.initial_balance === "number" ? cfg.initial_balance : Number(cfg.initial_balance);
          if (!Number.isFinite(equityNum) || !Number.isFinite(initialNum) || initialNum <= 0) {
            continue;
          }
          const floor = initialNum * thresholdFactor;
          if (equityNum >= floor) {
            continue;
          }

          const last = lastAlertByBotMs.get(r.id) ?? 0;
          if (now - last < cooldownMs) {
            continue;
          }
          lastAlertByBotMs.set(r.id, now);

          const name = typeof cfg.name === "string" ? cfg.name : r.id;
          await args.telegram.sendAlert({
            level: "WARN",
            message: [
              "⚠️ <b>Equity below threshold</b>",
              `Bot: <code>${name}</code>`,
              `Equity: <code>${equityNum.toFixed(2)}</code>`,
              `Floor (${String(dropPct)}% drop vs initial): <code>${floor.toFixed(2)}</code>`
            ].join("\n"),
            botId: r.id
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        args.logger.warn(`Equity alert tick error: ${msg}`, { event: "equity_alert_tick" });
      }
    })();
  };

  const handle = setInterval(tick, intervalMs);
  tick();
  return handle;
}
