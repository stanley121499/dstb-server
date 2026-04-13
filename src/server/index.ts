import "dotenv/config";
import http from "node:http";

import { createStateManager, ensureDirectory, resolveBotPaths } from "../cli/commands/cliUtils.js";
import { Logger } from "../core/Logger.js";
import { GoogleSheetsReporter } from "../monitoring/GoogleSheetsReporter.js";
import { TelegramAlerter } from "../monitoring/TelegramAlerter.js";
import { BotManager } from "./BotManager.js";
import { tryHandleBehaviorApi } from "./behaviorHttpHandlers.js";
import { startEquityDropAlertLoop } from "./equityAlertJob.js";
import type { SupabaseStateStore } from "../core/SupabaseStateStore.js";

const startedAtMs = Date.now();

/**
 * HTTP GET /health plus Phase 5–6 POST /behavior/* (when BEHAVIOR_API_SECRET is set).
 */
function startHttpServer(args: Readonly<{
  port: number;
  getHealthJson: () => Promise<string>;
  logger: Logger;
  store: SupabaseStateStore;
}>): http.Server {
  const behaviorApiSecret =
    typeof process.env["BEHAVIOR_API_SECRET"] === "string" ? process.env["BEHAVIOR_API_SECRET"].trim() : "";

  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      void (async () => {
        try {
          const body = await args.getHealthJson();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(body);
        } catch {
          res.writeHead(500);
          res.end();
        }
      })();
      return;
    }

    void (async () => {
      const handled = await tryHandleBehaviorApi(req, res, {
        store: args.store,
        logger: args.logger,
        behaviorApiSecret,
      });
      if (handled) {
        return;
      }
      res.writeHead(404);
      res.end();
    })();
  });

  server.listen(args.port, () => {
    args.logger.info(`HTTP server listening on port ${String(args.port)}`, { event: "health_listen" });
  });

  return server;
}

/**
 * Entry point for the long-running server process.
 */
async function startServer(): Promise<void> {
  const paths = resolveBotPaths();
  ensureDirectory(paths.dataDir);
  ensureDirectory(paths.logDir);

  const serverLogger = new Logger("server", paths.logDir);
  const store = createStateManager("server");

  serverLogger.info("Initializing background server process...", { event: "server_start" });

  let telegram: TelegramAlerter | null = null;
  let sheets: GoogleSheetsReporter | null = null;
  let botManager: BotManager | null = null;
  let equityAlertHandle: ReturnType<typeof setInterval> | null = null;

  const portRaw = process.env["PORT"];
  const port =
    typeof portRaw === "string" && portRaw.trim().length > 0 ? Number.parseInt(portRaw, 10) : 8787;
  const healthPort = Number.isFinite(port) && port > 0 ? port : 8787;

  try {
    telegram = TelegramAlerter.fromEnv({
      stateManager: store,
      logger: new Logger("telegram", paths.logDir),
      logDir: paths.logDir,
      onStopBot: async (botId) => {
        if (!botManager) return false;
        return await botManager.stopBot(botId);
      },
      onStartBot: async (configName) => {
        if (!botManager) throw new Error("BotManager not initialized");
        return await botManager.startBotByConfigName(configName);
      }
    });
    serverLogger.info("Telegram alerting configured", { event: "telegram_init" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    serverLogger.warn(`Telegram alerting disabled: ${msg}`, { event: "telegram_skip" });
  }

  try {
    sheets = GoogleSheetsReporter.fromEnv({
      stateManager: store,
      logger: new Logger("sheets", paths.logDir)
    });
    serverLogger.info("Google Sheets reporting configured", { event: "sheets_init" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    serverLogger.warn(`Google Sheets reporting disabled: ${msg}`, { event: "sheets_skip" });
  }

  botManager = new BotManager({
    store,
    logger: serverLogger,
    ...(telegram !== null ? { alerting: telegram } : {})
  });

  botManager.subscribeConfigRealtime();

  const healthServer = startHttpServer({
    port: healthPort,
    logger: serverLogger,
    store,
    getHealthJson: async () => {
      const running = botManager?.listRunning().length ?? 0;
      const uptimeSec = Math.floor((Date.now() - startedAtMs) / 1000);

      /**
       * Liveness: always answer quickly with 200 so Render health checks do not SIGTERM
       * the box when Supabase is slow or unreachable. DB fields are best-effort.
       */
      const healthDbTimeoutMs = 2500;
      let errored = 0;
      let lastHb: string | null = null;
      let dbReachable = true;
      try {
        const fromDb = (async (): Promise<{ errored: number; lastHb: string | null }> => {
          const errCount = await store.countBotsWithStatus("error");
          const { data: hbRow } = await store.client
            .from("bots")
            .select("last_heartbeat")
            .order("last_heartbeat", { ascending: false })
            .limit(1)
            .maybeSingle();
          const last =
            hbRow !== null && typeof hbRow === "object" && "last_heartbeat" in hbRow
              ? (hbRow as { last_heartbeat: string | null }).last_heartbeat
              : null;
          return { errored: errCount, lastHb: last };
        })();

        const timedOut = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("health_db_timeout"));
          }, healthDbTimeoutMs);
        });

        const row = await Promise.race([fromDb, timedOut]);
        errored = row.errored;
        lastHb = row.lastHb;
      } catch (err: unknown) {
        dbReachable = false;
        const msg = err instanceof Error ? err.message : String(err);
        serverLogger.warn(`Health DB snapshot skipped: ${msg}`, { event: "health_db_skip" });
      }

      return JSON.stringify({
        status: "ok",
        uptimeSeconds: uptimeSec,
        botsRunning: running,
        botsErrored: errored,
        lastHeartbeat: lastHb,
        db: dbReachable ? "ok" : "degraded"
      });
    }
  });

  const handleSignal = async (signal: string): Promise<void> => {
    serverLogger.info(`Shutdown signal ${signal} received`, { event: "server_shutdown", signal });
    if (equityAlertHandle !== null) {
      clearInterval(equityAlertHandle);
      equityAlertHandle = null;
    }
    telegram?.stopPolling();
    sheets?.stop();
    healthServer.close();
    if (botManager) {
      await botManager.stopAll();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });

  telegram?.startPolling();
  sheets?.start();

  await botManager.startAll();

  if (telegram !== null) {
    equityAlertHandle = startEquityDropAlertLoop({
      store,
      logger: serverLogger,
      telegram
    });
  }

  if (telegram !== null) {
    const names = await botManager.listAvailableConfigNames();
    const active = botManager.listRunning();
    await telegram.sendAlert({
      level: "INFO",
      message: [
        "🤖 <b>DSTB Server Started</b>",
        "",
        `✅ ${String(active.length)} bots auto-started`,
        `📂 ${String(names.length)} configs in Supabase`,
        "",
        "Send /help for commands."
      ].join("\n"),
      botId: "server"
    });
  }

  serverLogger.info("Server initialization complete. Running.", { event: "server_ready" });
}

void startServer().catch((err: unknown) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
