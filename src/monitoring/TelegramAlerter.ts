import { z } from "zod";

import { Logger } from "../core/Logger";
import { StateManager } from "../core/StateManager";
import { Bot } from "../core/types";

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
  | Readonly<{ type: "stop"; botId: string }>
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
  stateManager: StateManager;
  logger?: Logger;
  fetcher?: TelegramFetcher;
  onStopBot?: (botId: string) => Promise<boolean>;
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
  const command = parts[0]?.toLowerCase() ?? "";

  if (command === "/status") {
    return { type: "status" };
  }

  if (command === "/positions") {
    return { type: "positions" };
  }

  if (command === "/stop") {
    const botId = parts[1];
    if (botId === undefined || botId.trim().length === 0) {
      return { type: "unknown", message: "Usage: /stop <bot-id>" };
    }
    return { type: "stop", botId: botId.trim() };
  }

  return { type: "unknown", message: "Unknown command. Try /status or /positions." };
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
  private readonly stateManager: StateManager;
  private readonly logger: Logger;
  private readonly fetcher: TelegramFetcher;
  private readonly onStopBot?: (botId: string) => Promise<boolean>;
  private readonly rateLimiter: SlidingWindowLimiter;
  private offset: number | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

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
    if (options.onStopBot !== undefined) {
      this.onStopBot = options.onStopBot;
    }

    // Step 3: Initialize rate limiter.
    this.rateLimiter = new SlidingWindowLimiter(this.config.rateLimit);
  }

  /**
   * Create Telegram alerter from environment variables.
   */
  public static fromEnv(args: Readonly<{ stateManager: StateManager; logger?: Logger; fetcher?: TelegramFetcher; onStopBot?: (botId: string) => Promise<boolean> }>): TelegramAlerter {
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
      logger: args.logger,
      fetcher: args.fetcher,
      onStopBot: args.onStopBot
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
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
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
    const parsed = telegramUpdatesResponseSchema.parse(payload);

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
      const status = await this.buildStatusMessage();
      await this.sendMessage(status);
      return;
    }

    if (command.type === "positions") {
      const positions = await this.buildPositionsMessage();
      await this.sendMessage(positions);
      return;
    }

    if (command.type === "stop") {
      if (this.onStopBot === undefined) {
        await this.sendMessage("Stop command is not configured.");
        return;
      }

      const stopped = await this.onStopBot(command.botId);
      const message = stopped
        ? `Bot stopped: ${command.botId}`
        : `Failed to stop bot: ${command.botId}`;
      await this.sendMessage(message);
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
      return "No bots found.";
    }

    const lines = bots.map((bot) => this.formatBotStatus(bot));
    return ["Bot Status", ...lines].join("\n");
  }

  /**
   * Build a positions report message across all bots.
   */
  private async buildPositionsMessage(): Promise<string> {
    const positions = await this.stateManager.getAllOpenPositions();
    if (positions.length === 0) {
      return "No open positions.";
    }

    const lines = positions.map((position) => {
      const side = position.side;
      const qty = position.quantity;
      const price = position.entryPrice;
      return [`${position.botId}:`, side, `${qty}`, `@ ${price}`].join(" ");
    });

    return ["Open Positions", ...lines].join("\n");
  }

  /**
   * Format a bot status line.
   */
  private formatBotStatus(bot: Bot): string {
    const heartbeat = bot.lastHeartbeat ?? 0;
    const minutesAgo =
      heartbeat > 0 ? Math.floor((Date.now() - heartbeat) / 60000) : null;
    const heartbeatText = minutesAgo === null ? "heartbeat=unknown" : `heartbeat=${minutesAgo}m`;

    return [
      `${bot.name}`,
      `(${bot.id})`,
      `status=${bot.status}`,
      `equity=${bot.currentEquity.toFixed(2)}`,
      heartbeatText
    ].join(" ");
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
   * Format alert message text for Telegram.
   */
  private formatAlertText(level: "CRITICAL" | "WARNING" | "INFO", message: string, botId: string): string {
    const icon = level === "CRITICAL" ? "🔴" : level === "WARNING" ? "🟡" : "🟢";
    return [icon, level, `Bot: ${botId}`, message].join("\n");
  }

  /**
   * Send a raw message to Telegram.
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
        text
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
