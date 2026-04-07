/**
 * One-shot migration: SQLite `data/bot-state.db` -> Supabase (Phase 1 tables).
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and optional SQLITE_DB path (default ./data/bot-state.db).
 *
 * Run: npm run import:sqlite
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { ConfigLoader } from "../core/ConfigLoader.js";
import type { BotConfig } from "../core/types.js";
import { botConfigToColumns } from "../core/configMapping.js";
import { createServiceRoleClient } from "../supabase/client.js";
import { loadSupabaseEnv } from "../supabase/env.js";

type SqliteBotRow = Readonly<{
  id: string;
  name: string;
  strategy: string;
  initial_balance: number;
  current_equity: number;
  status: string;
  config: string;
  created_at: number;
  last_heartbeat: number | null;
}>;

function main(): void {
  const dbPath = process.env["SQLITE_DB"] ?? path.join(process.cwd(), "data", "bot-state.db");
  const env = loadSupabaseEnv();
  const client = createServiceRoleClient(env);

  const sqlite = new Database(dbPath, { readonly: true });
  const sqliteBots = sqlite.prepare("SELECT * FROM bots").all() as SqliteBotRow[];

  const oldBotToNew = new Map<string, { botId: string; configId: string }>();

  for (const row of sqliteBots) {
    let botConfig: BotConfig;
    try {
      botConfig = ConfigLoader.validateConfig(JSON.parse(row.config) as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Skip bot ${row.id}: invalid config JSON: ${msg}`);
      continue;
    }

    const cols = botConfigToColumns(botConfig);
    const configId = randomUUID();
    const botId = randomUUID();

    const { error: cErr } = client.from("configs").insert({
      id: configId,
      ...cols,
      enabled: false,
      current_version: 1
    });
    if (cErr !== null) {
      console.error(`configs insert failed for ${row.id}: ${cErr.message}`);
      continue;
    }

    const { error: bErr } = client.from("bots").insert({
      id: botId,
      config_id: configId,
      status: "stopped",
      equity: row.current_equity,
      last_heartbeat:
        row.last_heartbeat !== null ? new Date(row.last_heartbeat).toISOString() : null,
      created_at: new Date(row.created_at).toISOString()
    });
    if (bErr !== null) {
      console.error(`bots insert failed for ${row.id}: ${bErr.message}`);
      continue;
    }

    oldBotToNew.set(row.id, { botId, configId });
    console.log(`Mapped SQLite bot ${row.id} -> config ${configId}, bot ${botId}`);
  }

  const sqlitePositions = sqlite.prepare("SELECT * FROM positions").all() as Array<Record<string, unknown>>;
  for (const p of sqlitePositions) {
    const oldBot = String(p["bot_id"]);
    const mapped = oldBotToNew.get(oldBot);
    if (mapped === undefined) {
      continue;
    }
    const newId = randomUUID();
    const { error } = client.from("positions").insert({
      id: newId,
      bot_id: mapped.botId,
      config_id: mapped.configId,
      symbol: String(p["symbol"]),
      side: String(p["side"]),
      quantity: Number(p["quantity"]),
      entry_price: Number(p["entry_price"]),
      stop_loss: p["stop_loss"],
      take_profit: p["take_profit"],
      entry_time: new Date(Number(p["entry_time"])).toISOString()
    });
    if (error !== null) {
      console.error(`position insert failed: ${error.message}`);
    }
  }

  const sqliteTrades = sqlite.prepare("SELECT * FROM trades").all() as Array<Record<string, unknown>>;
  for (const t of sqliteTrades) {
    const oldBot = String(t["bot_id"]);
    const mapped = oldBotToNew.get(oldBot);
    if (mapped === undefined) {
      continue;
    }
    const entryPx = Number(t["entry_price"]);
    const qty = Number(t["quantity"]);
    const pnl = Number(t["pnl"]);
    const notional = Math.abs(entryPx * qty);
    const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;
    const snap = sqliteBots.find((b) => b.id === oldBot);
    let snapshot: Record<string, unknown> = {};
    if (snap !== undefined) {
      try {
        snapshot = JSON.parse(snap.config) as Record<string, unknown>;
      } catch {
        snapshot = {};
      }
    }

    const { error } = client.from("trades").insert({
      id: randomUUID(),
      bot_id: mapped.botId,
      config_id: mapped.configId,
      config_version: 1,
      config_snapshot: snapshot,
      symbol: String(t["symbol"]),
      side: String(t["side"]),
      entry_price: entryPx,
      exit_price: Number(t["exit_price"]),
      quantity: qty,
      pnl,
      pnl_pct: pnlPct,
      entry_time: new Date(Number(t["entry_time"])).toISOString(),
      exit_time: new Date(Number(t["exit_time"])).toISOString(),
      exit_reason: String(t["exit_reason"] ?? "imported"),
      metadata:
        t["r_multiple"] !== null && t["r_multiple"] !== undefined
          ? { rMultiple: Number(t["r_multiple"]) }
          : {}
    });
    if (error !== null) {
      console.error(`trade insert failed: ${error.message}`);
    }
  }

  const sqliteOrders = sqlite.prepare("SELECT * FROM orders").all() as Array<Record<string, unknown>>;
  for (const o of sqliteOrders) {
    const oldBot = String(o["bot_id"]);
    const mapped = oldBotToNew.get(oldBot);
    if (mapped === undefined) {
      continue;
    }
    const statusMap: Record<string, string> = {
      NEW: "pending",
      PLACED: "pending",
      PARTIALLY_FILLED: "pending",
      FILLED: "filled",
      CANCELED: "cancelled",
      REJECTED: "failed"
    };
    const st = String(o["status"]);
    const { error } = client.from("orders").insert({
      id: randomUUID(),
      bot_id: mapped.botId,
      client_order_id: String(o["client_order_id"]),
      exchange_order_id: o["exchange_order_id"],
      symbol: String(o["symbol"]),
      side: String(o["side"]),
      order_type: "MARKET",
      quantity: Number(o["quantity"]),
      price: o["price"],
      status: statusMap[st] ?? "pending",
      filled_at:
        o["filled_at"] !== null && o["filled_at"] !== undefined
          ? new Date(Number(o["filled_at"])).toISOString()
          : null,
      created_at: new Date(Number(o["created_at"])).toISOString()
    });
    if (error !== null) {
      console.error(`order insert failed: ${error.message}`);
    }
  }

  sqlite.close();
  console.log("SQLite import finished.");
}

main();
