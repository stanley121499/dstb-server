import "dotenv/config";
import http from "node:http";

import { createStateManager, ensureDirectory, resolveBotPaths } from "../cli/commands/cliUtils.js";
import { Logger } from "../core/Logger.js";
import { GoogleSheetsReporter } from "../monitoring/GoogleSheetsReporter.js";
import { TelegramAlerter } from "../monitoring/TelegramAlerter.js";
import { BotManager } from "./BotManager.js";

const startedAtMs = Date.now();

/**
 * HTTP GET /health for Render and UptimeRobot.
 */
function startHealthServer(args: Readonly<{
  port: number;
  getHealthJson: () => Promise<string>;
  logger: Logger;
}>): http.Server {
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
    res.writeHead(404);
    res.end();
  });

  server.listen(args.port, () => {
    args.logger.info(`Health server listening on port ${String(args.port)}`, { event: "health_listen" });
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

  const healthServer = startHealthServer({
    port: healthPort,
    logger: serverLogger,
    getHealthJson: async () => {
      const running = botManager?.listRunning().length ?? 0;
      const uptimeSec = Math.floor((Date.now() - startedAtMs) / 1000);
      const errored = await store.countBotsWithStatus("error");
      const { data: hbRow } = await store.client
        .from("bots")
        .select("last_heartbeat")
        .order("last_heartbeat", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastHb =
        hbRow !== null && typeof hbRow === "object" && "last_heartbeat" in hbRow
          ? (hbRow as { last_heartbeat: string | null }).last_heartbeat
          : null;

      return JSON.stringify({
        status: "ok",
        uptimeSeconds: uptimeSec,
        botsRunning: running,
        botsErrored: errored,
        lastHeartbeat: lastHb
      });
    }
  });

  const handleSignal = async (signal: string): Promise<void> => {
    serverLogger.info(`Shutdown signal ${signal} received`, { event: "server_shutdown", signal });
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
