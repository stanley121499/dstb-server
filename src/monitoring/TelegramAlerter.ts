import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

import type { BotStateStore } from "../core/BotStateStore.js";
import { Logger } from "../core/Logger.js";
import { Bot } from "../core/types.js";

/**
 * Alert levels supported by the monitoring system.
 */
export type AlertLevel = "CRITICAL" | "WARNING" | "INFO" | "ERROR" | "WARN";

/**
 * Telegram command kinds the bot recognizes.
 */
export type TelegramCommand =
  | Readonly<{ type: "status" }>
  | Readonly<{ type: "positions" }>
  | Readonly<{ type: "equity" }>
  | Readonly<{ type: "trades" }>
  | Readonly<{ type: "help" }>
  | Readonly<{ type: "start"; config: string }>
  | Readonly<{ type: "stop"; botId: string }>
  | Readonly<{ type: "logs"; target: string }>
  | Readonly<{ type: "tail"; target: string }>
  | Readonly<{ type: "unknown"; message: string }>;

/**
 * Telegram fetcher signature for dependency injection and testing.
 */
export type TelegramFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Rate limit configuration for Telegram alerts.
 */
export type TelegramRateLimit = Readonly<{
  windowMs: number;
  maxPerWindow: number;
}>;

/**
 * Telegram alerter configuration object.
 */
export type TelegramAlerterConfig = Readonly<{
  botToken: string;
  chatId: string;
  pollIntervalMs: number;
  rateLimit: TelegramRateLimit;
}>;

/**
 * Telegram alerter dependencies for core monitoring.
 */
export type TelegramAlerterOptions = Readonly<{
  config: TelegramAlerterConfig;
  stateManager: BotStateStore;
  logger?: Logger;
  fetcher?: TelegramFetcher;
  onStopBot?: (botId: string) => Promise<boolean>;
  onStartBot?: (configName: string) => Promise<string>;
  logDir?: string;
}>;

const telegramConfigSchema = z
  .object({
    botToken: z.string().trim().min(1),
    chatId: z.string().trim().min(1),
    pollIntervalMs: z.number().int().positive().default(5000),
    rateLimit: z
      .object({
        windowMs: z.number().int().positive(),
        maxPerWindow: z.number().int().positive()
      })
      .default({ windowMs: 60_000, maxPerWindow: 20 })
  })
  .strict();

const telegramUpdatesResponseSchema = z.object({
  ok: z.boolean(),
  result: z.array(
    z.object({
      update_id: z.number().int(),
      message: z
        .object({
          text: z.string().optional(),
          chat: z.object({
            id: z.number()
          })
        })
        .optional()
    })
  ),
  description: z.string().optional()
});

const telegramSendResponseSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.unknown()).optional(),
  description: z.string().optional()
});

type TelegramUpdate = z.infer<typeof telegramUpdatesResponseSchema>["result"][number];

/**
 * Parse a Telegram command string into a structured command.
 */
export const parseTelegramCommand = (text: string): TelegramCommand => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { type: "unknown", message: "Empty command" };
  }

  const parts = trimmed.split(/\s+/);
  // Strip @botname suffix — group chats send "/command@botname" format.
  const command = (parts[0]?.toLowerCase() ?? "").replace(/@\S+$/, "");

  if (command === "/status") return { type: "status" };
  if (command === "/positions") return { type: "positions" };
  if (command === "/equity") return { type: "equity" };
  if (command === "/trades") return { type: "trades" };
  if (command === "/help") return { type: "help" };

  if (command === "/start") {
    const configName = parts[1];
    if (configName === undefined || configName.trim().length === 0) {
      return { type: "unknown", message: "Usage: /start &lt;config-name&gt;" };
    }
    return { type: "start", config: configName.trim() };
  }

  if (command === "/stop") {
    const botId = parts[1];
    if (botId === undefined || botId.trim().length === 0) {
      return { type: "unknown", message: "Usage: /stop &lt;bot-id&gt;" };
    }
    return { type: "stop", botId: botId.trim() };
  }

  if (command === "/logs") {
    return { type: "logs", target: parts[1]?.trim() ?? "server" };
  }

  if (command === "/tail") {
    // Capture everything after "/tail" so "stop 76b7c369" arrives as one string.
    const rest = parts.slice(1).join(" ").trim();
    return { type: "tail", target: rest.length > 0 ? rest : "server" };
  }

  return { type: "unknown", message: "Unknown command. Send /help for a list of commands." };
};

/**
 * Sliding window rate limiter to prevent Telegram spam.
 */
class SlidingWindowLimiter {
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private readonly timestamps: number[] = [];

  constructor(config: TelegramRateLimit) {
    this.windowMs = config.windowMs;
    this.maxPerWindow = config.maxPerWindow;
  }

  /**
   * Returns true if a new event is allowed in the current window.
   */
  public allow(nowMs: number): boolean {
    const cutoff = nowMs - this.windowMs;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) < cutoff) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxPerWindow) {
      return false;
    }

    this.timestamps.push(nowMs);
    return true;
  }
}

/**
 * Telegram alerter for instant notifications and command handling.
 */
export class TelegramAlerter {
  private readonly config: TelegramAlerterConfig;
  private readonly stateManager: BotStateStore;
  private readonly logger: Logger;
  private readonly fetcher: TelegramFetcher;
  private readonly onStopBot?: (botId: string) => Promise<boolean>;
  private readonly onStartBot?: (configName: string) => Promise<string>;
  private readonly logDir: string;
  private readonly rateLimiter: SlidingWindowLimiter;
  private offset: number | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  /** Active tail watchers keyed by target label (e.g. "server" or "76b7c369"). */
  private readonly tails: Map<string, { timer: NodeJS.Timeout; file: string; offset: number }> = new Map();

  /**
   * Create a new Telegram alerter.
   *
   * Inputs:
   * - config: TelegramAlerterConfig.
   * - stateManager: SQLite-backed state manager.
   *
   * Outputs:
   * - TelegramAlerter instance.
   *
   * Error behavior:
   * - Throws on invalid configuration.
   */
  public constructor(options: TelegramAlerterOptions) {
    // Step 1: Validate configuration.
    this.config = telegramConfigSchema.parse(options.config);

    // Step 2: Store dependencies with fallbacks.
    this.stateManager = options.stateManager;
    this.logger = options.logger ?? new Logger("monitoring", "logs");
    this.fetcher = options.fetcher ?? fetch;
    this.logDir = options.logDir ?? "logs";
    if (options.onStopBot !== undefined) {
      this.onStopBot = options.onStopBot;
    }

    // Step 3: Initialize rate limiter.
    this.rateLimiter = new SlidingWindowLimiter(this.config.rateLimit);
  }

  /**
   * Create Telegram alerter from environment variables.
   */
  public static fromEnv(args: Readonly<{ stateManager: BotStateStore; logger?: Logger; fetcher?: TelegramFetcher; logDir?: string; onStopBot?: (botId: string) => Promise<boolean>; onStartBot?: (configName: string) => Promise<string> }>): TelegramAlerter {
    const config = telegramConfigSchema.parse({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      pollIntervalMs: Number(process.env.TELEGRAM_POLL_INTERVAL_MS ?? "5000"),
      rateLimit: {
        windowMs: Number(process.env.TELEGRAM_RATE_WINDOW_MS ?? "60000"),
        maxPerWindow: Number(process.env.TELEGRAM_RATE_MAX ?? "20")
      }
    });

    return new TelegramAlerter({
      config,
      stateManager: args.stateManager,
      ...(args.logger !== undefined ? { logger: args.logger } : {}),
      ...(args.fetcher !== undefined ? { fetcher: args.fetcher } : {}),
      ...(args.logDir !== undefined ? { logDir: args.logDir } : {}),
      ...(args.onStopBot !== undefined ? { onStopBot: args.onStopBot } : {}),
      ...(args.onStartBot !== undefined ? { onStartBot: args.onStartBot } : {})
    });
  }

  /**
   * Send a formatted Telegram alert with rate limiting.
   */
  public async sendAlert(args: Readonly<{ level: AlertLevel; message: string; botId: string }>): Promise<void> {
    // Step 1: Normalize alert level to monitoring tiers.
    const normalized = this.normalizeLevel(args.level);

    // Step 2: Enforce rate limiting to prevent spam.
    if (!this.rateLimiter.allow(Date.now())) {
      this.logger.warn("Telegram alert suppressed by rate limiter", {
        event: "telegram_rate_limit",
        level: normalized,
        botId: args.botId
      });
      return;
    }

    // Step 3: Format and send message.
    const text = this.formatAlertText(normalized, args.message, args.botId);
    await this.sendMessage(text);
  }

  /**
   * Start polling Telegram for commands.
   */
  public startPolling(): void {
    if (this.pollTimer !== null) {
      return;
    }

    // Step 1: Poll on a fixed interval.
    // Errors are caught here so a transient network failure (ETIMEDOUT, ENETUNREACH, etc.)
    // does not produce an unhandled rejection that crashes the Node.js process.
    this.pollTimer = setInterval(() => {
      void this.pollOnce().catch((err: unknown) => {
        this.logger.warn("Telegram poll failed (network or API error)", {
          event: "telegram_poll_failed",
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop polling Telegram for commands.
   */
  public stopPolling(): void {
    if (this.pollTimer === null) {
      return;
    }

    clearInterval(this.pollTimer);
    this.pollTimer = null;
    // Stop all active tails on shutdown.
    for (const label of this.tails.keys()) {
      this.stopTail(label);
    }
  }

  /**
   * Poll once for new Telegram updates.
   */
  public async pollOnce(): Promise<void> {
    // Step 1: Build updates URL with offset.
    const params = new URLSearchParams();
    if (this.offset !== null) {
      params.set("offset", String(this.offset));
    }
    params.set("limit", "50");

    const url = this.buildApiUrl("getUpdates", params);
    const response = await this.fetcher(url, { method: "GET" });
    const payload = await response.json();

    // Guard against unexpected Telegram responses (e.g. rate limits, server errors).
    let parsed;
    try {
      parsed = telegramUpdatesResponseSchema.parse(payload);
    } catch {
      this.logger.warn("Telegram getUpdates returned unexpected shape", {
        event: "telegram_poll_bad_response"
      });
      return;
    }

    if (!parsed.ok) {
      this.logger.warn("Telegram getUpdates returned not ok", {
        event: "telegram_poll_error",
        description: parsed.description ?? ""
      });
      return;
    }

    // Step 2: Process each update.
    for (const update of parsed.result) {
      this.offset = Math.max(this.offset ?? 0, update.update_id + 1);
      await this.handleUpdate(update);
    }
  }

  /**
   * Handle a single Telegram update payload.
   */
  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (message === undefined || message.text === undefined) {
      return;
    }

    const chatId = String(message.chat.id);
    if (chatId !== this.config.chatId) {
      return;
    }

    const command = parseTelegramCommand(message.text);
    await this.handleCommand(command);
  }

  /**
   * Handle parsed Telegram commands.
   */
  private async handleCommand(command: TelegramCommand): Promise<void> {
    if (command.type === "status") {
      await this.sendMessage(await this.buildStatusMessage());
      return;
    }
    if (command.type === "positions") {
      await this.sendMessage(await this.buildPositionsMessage());
      return;
    }
    if (command.type === "equity") {
      await this.sendMessage(await this.buildEquityMessage());
      return;
    }
    if (command.type === "trades") {
      await this.sendMessage(await this.buildTradesMessage());
      return;
    }
    if (command.type === "help") {
      await this.sendMessage(this.buildHelpMessage());
      return;
    }
    if (command.type === "start") {
      if (this.onStartBot === undefined) {
        await this.sendMessage("⚠️ Start command is not configured on this server.");
        return;
      }
      try {
        const newBotId = await this.onStartBot(command.config);
        await this.sendMessage(`✅ Started new bot from <code>${command.config}.json</code>! ID: <code>${newBotId.slice(0, 8)}</code>`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.sendMessage(`❌ Failed to start bot: ${msg}`);
      }
      return;
    }
    if (command.type === "stop") {
      if (this.onStopBot === undefined) {
        await this.sendMessage("⚠️ Stop command is not configured.");
        return;
      }
      const stopped = await this.onStopBot(command.botId);
      await this.sendMessage(
        stopped
          ? `✅ Bot <code>${command.botId.slice(0, 8)}</code> stopped.`
          : `❌ Failed to stop bot <code>${command.botId.slice(0, 8)}</code>.`
      );
      return;
    }
    if (command.type === "logs") {
      const msg = this.buildLogsMessage(command.target, 30);
      await this.sendMessage(msg);
      return;
    }
    if (command.type === "tail") {
      if (command.target === "stop") {
        // /tail stop  — stop ALL active tails
        if (this.tails.size === 0) {
          await this.sendMessage("⚠️ No active tails to stop.");
          return;
        }
        const labels = [...this.tails.keys()];
        for (const label of labels) this.stopTail(label);
        await this.sendMessage(`⏹ Stopped ${labels.length} tail(s): ${labels.map((l) => `<code>${l}</code>`).join(", ")}`);
        return;
      }
      // Check if the target is "stop <label>" (already parsed as target "stop 76b7c369")
      // Actually target already has the value after /tail — "stop 76b7c369" would be two words.
      // The command parser splits on whitespace, so parts[1]=="stop" parts[2]=="<id>" won't arrive here.
      // Users do: /tail stop <id>  — but parseTelegramCommand only grabs parts[1] as target.
      // We handle the multi-word case by checking if target starts with "stop ".
      if (command.target.startsWith("stop ")) {
        const label = command.target.slice(5).trim();
        if (this.tails.has(label)) {
          this.stopTail(label);
          await this.sendMessage(`⏹ Tail stopped for <code>${label}</code>.`);
        } else {
          await this.sendMessage(`⚠️ No active tail for <code>${label}</code>.`);
        }
        return;
      }
      const logFile = this.findLogFile(command.target);
      if (logFile === null) {
        await this.sendMessage(`❌ No log file found for: <code>${command.target}</code>`);
        return;
      }
      this.startTail(logFile, command.target);
      await this.sendMessage(`📡 Live tail started for <code>${command.target}</code>\nSend /tail stop ${command.target} to cancel.`);
      return;
    }
    await this.sendMessage(command.message);
  }

  /**
   * Build a status report message across all bots.
   */
  private async buildStatusMessage(): Promise<string> {
    const bots = await this.stateManager.getAllBots();
    if (bots.length === 0) {
      return "❌ No bots found.";
    }
    const lines = bots.map((bot) => this.formatBotStatus(bot));
    return ["<b>📊 Bot Status</b>", ...lines].join("\n\n");
  }

  /**
   * Build positions message.
   */
  private async buildPositionsMessage(): Promise<string> {
    const positions = await this.stateManager.getAllOpenPositions();
    if (positions.length === 0) {
      return "<b>📭 Open Positions</b>\n\nNo open positions.";
    }
    const lines = positions.map((position) => {
      const sideIcon = position.side === "LONG" ? "🟢" : "🔴";
      const shortId = position.botId.slice(0, 8);
      return [
        `${sideIcon} <b>${position.side}</b>`,
        `Qty: <code>${position.quantity}</code>`,
        `Entry: <code>${position.entryPrice.toFixed(2)}</code>`,
        `Bot: <code>${shortId}</code>`
      ].join("  |  ");
    });
    return ["<b>📈 Open Positions</b>", ...lines].join("\n");
  }

  /**
   * Build total equity summary across all bots.
   */
  private async buildEquityMessage(): Promise<string> {
    const bots = await this.stateManager.getAllBots();
    if (bots.length === 0) {
      return "❌ No bots found.";
    }
    const total = bots.reduce((sum, b) => sum + b.currentEquity, 0);
    const lines = bots.map((bot) => {
      const icon = bot.status === "running" ? "✅" : "⏸";
      return `  ${icon} ${bot.name}: <b>$${bot.currentEquity.toFixed(2)}</b>`;
    });
    return [
      "<b>💰 Equity Summary</b>",
      ...lines,
      "",
      `<b>Total: $${total.toFixed(2)}</b>`
    ].join("\n");
  }

  /**
   * Build recent trades message.
   */
  private async buildTradesMessage(): Promise<string> {
    const bots = await this.stateManager.getAllBots();
    if (bots.length === 0) {
      return "❌ No bots found.";
    }
    const tradeLists = await Promise.all(
      bots.map((bot) => this.stateManager.getTrades(bot.id, 1))
    );
    const trades = tradeLists.flat().sort((a, b) => b.exitTime - a.exitTime).slice(0, 5);
    if (trades.length === 0) {
      return "<b>📋 Recent Trades</b>\n\nNo trades in the last 24h.";
    }
    const lines = trades.map((trade) => {
      const pnlIcon = trade.pnl >= 0 ? "🟢" : "🔴";
      const pnlStr = trade.pnl >= 0 ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`;
      const date = new Date(trade.exitTime).toISOString().slice(0, 16).replace("T", " ");
      return [
        `${pnlIcon} <b>${trade.side}</b>  ${pnlStr}`,
        `  Entry: <code>${trade.entryPrice.toFixed(2)}</code>  Exit: <code>${trade.exitPrice.toFixed(2)}</code>`,
        `  <i>${date} UTC</i>`
      ].join("\n");
    });
    return ["<b>📋 Recent Trades (last 5)</b>", ...lines].join("\n\n");
  }

  /**
   * Build help message listing all available commands.
   */
  private buildHelpMessage(): string {
    return [
      "<b>🤖 DSTB Bot Commands</b>",
      "",
      "<b>Monitoring</b>",
      "  /status — All bots: status, equity, heartbeat",
      "  /equity — Total equity summary across all bots",
      "  /positions — Current open positions",
      "  /trades — Last 5 closed trades",
      "",
      "<b>Logs</b>",
      "  /logs — Last 30 lines of the server log",
      "  /logs &lt;bot-id&gt; — Last 30 lines of a bot's log",
      "  /tail &lt;bot-id|server&gt; — Live log stream (updates every 15s)",
      "  /tail stop — Stop live stream",
      "",
      "<b>Control</b>",
      "  /start &lt;config-name&gt; — Start a new bot",
      "  /stop &lt;bot-id&gt; — Stop a specific bot",
      "",
      "<b>Info</b>",
      "  /help — Show this message"
    ].join("\n");
  }

  /**
   * Find the most recent log file matching a target ("server" or bot short-id).
   */
  private findLogFile(target: string): string | null {
    if (!fs.existsSync(this.logDir)) return null;
    const files = fs.readdirSync(this.logDir).filter((f) => f.endsWith(".log"));
    const needle = target === "server" ? "bot-server-" : `bot-${target}`;
    // Sort descending so the most recent date comes first.
    const match = files.sort().reverse().find((f) => f.startsWith(needle));
    return match !== undefined ? path.join(this.logDir, match) : null;
  }

  /**
   * Read the last `lines` lines of a log file and format for Telegram.
   */
  private buildLogsMessage(target: string, lines: number): string {
    const logFile = this.findLogFile(target);
    if (logFile === null) {
      return `❌ No log file found for: <code>${target}</code>`;
    }
    const content = fs.readFileSync(logFile, "utf8");
    const allLines = content.split("\n").filter((l) => l.trim().length > 0);
    const tail = allLines.slice(-lines).join("\n");
    // Enforce Telegram 4096 char limit (reserve ~100 for header).
    const trimmed = tail.length > 3900 ? tail.slice(tail.length - 3900) : tail;
    return [
      `<b>📋 Log: ${target}</b>`,
      `<pre>${trimmed}</pre>`
    ].join("\n");
  }

  /**
   * Start live-tailing a log file for a given label. Sends new lines every 15 seconds.
   * Multiple tails for different labels run independently.
   */
  private startTail(logFile: string, label: string): void {
    // Stop any existing tail for this label before starting a new one.
    this.stopTail(label);
    let offset = 0;
    try {
      offset = fs.statSync(logFile).size;
    } catch {
      offset = 0;
    }

    const timer = setInterval(() => {
      void this.pushTailUpdate(label);
    }, 15_000);

    this.tails.set(label, { timer, file: logFile, offset });
  }

  /**
   * Stop tailing the log file for a specific label.
   */
  private stopTail(label: string): void {
    const entry = this.tails.get(label);
    if (entry !== undefined) {
      clearInterval(entry.timer);
      this.tails.delete(label);
    }
  }

  /**
   * Read new log content since last send and push to Telegram.
   */
  private async pushTailUpdate(label: string): Promise<void> {
    const entry = this.tails.get(label);
    if (entry === undefined) return;
    try {
      const stat = fs.statSync(entry.file);
      if (stat.size <= entry.offset) return; // No new content.

      const fd = fs.openSync(entry.file, "r");
      const bytesToRead = stat.size - entry.offset;
      const buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, entry.offset);
      fs.closeSync(fd);
      // Update offset in-place.
      this.tails.set(label, { ...entry, offset: stat.size });

      const newContent = buf.toString("utf8").trim();
      if (newContent.length === 0) return;

      const trimmed = newContent.length > 3900 ? newContent.slice(newContent.length - 3900) : newContent;
      await this.sendMessage([
        `<b>📡 Tail [${label}]</b>`,
        `<pre>${trimmed}</pre>`
      ].join("\n"));
    } catch {
      // File rotated or disappeared — stop this tail.
      this.stopTail(label);
    }
  }

  /**
   * Format a single bot status block with HTML.
   */
  private formatBotStatus(bot: Bot): string {
    const heartbeat = bot.lastHeartbeat ?? 0;
    const minutesAgo =
      heartbeat > 0 ? Math.floor((Date.now() - heartbeat) / 60000) : null;
    const heartbeatText = minutesAgo === null ? "unknown" : `${minutesAgo}m ago`;

    const statusIcon =
      bot.status === "running" ? "✅" : bot.status === "stopped" ? "⏸" : "🔴";
    const shortId = bot.id.slice(0, 8);
    const exchangeBadge = bot.config.exchange.toUpperCase();

    return [
      `${statusIcon} <b>${bot.name}</b>  <code>${shortId}</code>`,
      `  Exchange: [${exchangeBadge}]`,
      `  Status: ${bot.status}`,
      `  Equity: <b>$${bot.currentEquity.toFixed(2)}</b>`,
      `  Heartbeat: ${heartbeatText}`
    ].join("\n");
  }

  /**
   * Normalize alert levels to monitoring tiers.
   */
  private normalizeLevel(level: AlertLevel): "CRITICAL" | "WARNING" | "INFO" {
    if (level === "CRITICAL") {
      return "CRITICAL";
    }
    if (level === "WARNING" || level === "WARN") {
      return "WARNING";
    }
    if (level === "ERROR") {
      return "CRITICAL";
    }
    return "INFO";
  }

  /**
   * Format alert message text for Telegram using HTML.
   */
  private formatAlertText(level: "CRITICAL" | "WARNING" | "INFO", message: string, botId: string): string {
    const icon = level === "CRITICAL" ? "🔴" : level === "WARNING" ? "🟡" : "🟢";
    const shortId = botId.slice(0, 8);
    return [
      `${icon} <b>${level}</b>`,
      `<code>${shortId}</code>`,
      "",
      message
    ].join("\n");
  }

  /**
   * Send an HTML-formatted message to Telegram.
   */
  private async sendMessage(text: string): Promise<void> {
    const url = this.buildApiUrl("sendMessage");
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text,
        parse_mode: "HTML"
      })
    });

    const payload = await response.json();
    const parsed = telegramSendResponseSchema.parse(payload);

    if (!parsed.ok) {
      throw new Error(`Telegram sendMessage failed: ${parsed.description ?? "unknown error"}`);
    }
  }

  /**
   * Build a Telegram API URL with the bot token.
   */
  private buildApiUrl(method: string, params?: URLSearchParams): string {
    const base = `https://api.telegram.org/bot${this.config.botToken}/${method}`;
    if (params === undefined) {
      return base;
    }
    const query = params.toString();
    return query.length > 0 ? `${base}?${query}` : base;
  }
}
