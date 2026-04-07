import nodemailer from "nodemailer";
import { z } from "zod";

import { Logger } from "../core/Logger";
import type { BotStateStore } from "../core/BotStateStore.js";
import { Bot, Position, Trade } from "../core/types";

/**
 * Alert levels supported by email alerts.
 */
export type EmailAlertLevel = "CRITICAL" | "WARNING" | "INFO" | "ERROR" | "WARN";

/**
 * Minimal email transporter interface.
 */
export type EmailTransporter = Readonly<{
  sendMail: (args: Readonly<{ from: string; to: string; subject: string; text: string }>) => Promise<unknown>;
}>;

/**
 * Rate limit configuration for email alerts.
 */
export type EmailRateLimit = Readonly<{
  windowMs: number;
  maxPerWindow: number;
}>;

/**
 * Email alerter configuration.
 */
export type EmailAlerterConfig = Readonly<{
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  to: string;
  from: string;
  dailySummaryHour: number;
  rateLimit: EmailRateLimit;
}>;

/**
 * Email alerter dependencies.
 */
export type EmailAlerterOptions = Readonly<{
  config: EmailAlerterConfig;
  stateManager: BotStateStore;
  logger?: Logger;
  transporter?: EmailTransporter;
  scheduler?: Readonly<{
    setTimeout: (handler: () => void, ms: number) => NodeJS.Timeout;
    clearTimeout: (timer: NodeJS.Timeout) => void;
  }>;
}>;

const emailConfigSchema = z
  .object({
    smtpHost: z.string().trim().min(1),
    smtpPort: z.number().int().positive(),
    smtpUser: z.string().trim().min(1),
    smtpPass: z.string().trim().min(1),
    to: z.string().trim().min(1),
    from: z.string().trim().min(1),
    dailySummaryHour: z.number().int().min(0).max(23).default(8),
    rateLimit: z
      .object({
        windowMs: z.number().int().positive(),
        maxPerWindow: z.number().int().positive()
      })
      .default({ windowMs: 60_000, maxPerWindow: 5 })
  })
  .strict();

/**
 * Sliding window rate limiter to prevent email spam.
 */
class EmailRateLimiter {
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private readonly timestamps: number[] = [];

  constructor(config: EmailRateLimit) {
    this.windowMs = config.windowMs;
    this.maxPerWindow = config.maxPerWindow;
  }

  /**
   * Returns true if a new email can be sent.
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
 * Email alerter for daily summaries and critical backups.
 */
export class EmailAlerter {
  private readonly config: EmailAlerterConfig;
  private readonly stateManager: BotStateStore;
  private readonly logger: Logger;
  private readonly transporter: EmailTransporter;
  private readonly scheduler: Readonly<{
    setTimeout: (handler: () => void, ms: number) => NodeJS.Timeout;
    clearTimeout: (timer: NodeJS.Timeout) => void;
  }>;
  private readonly rateLimiter: EmailRateLimiter;
  private summaryTimer: NodeJS.Timeout | null = null;

  /**
   * Create a new EmailAlerter instance.
   *
   * Inputs:
   * - config: EmailAlerterConfig.
   * - stateManager: SQLite-backed state manager.
   *
   * Outputs:
   * - EmailAlerter instance.
   *
   * Error behavior:
   * - Throws on invalid configuration.
   */
  public constructor(options: EmailAlerterOptions) {
    // Step 1: Validate configuration.
    this.config = emailConfigSchema.parse(options.config);

    // Step 2: Store dependencies.
    this.stateManager = options.stateManager;
    this.logger = options.logger ?? new Logger("monitoring", "logs");
    this.scheduler = options.scheduler ?? {
      setTimeout,
      clearTimeout
    };
    this.rateLimiter = new EmailRateLimiter(this.config.rateLimit);

    // Step 3: Initialize transporter when not injected.
    if (options.transporter !== undefined) {
      this.transporter = options.transporter;
    } else {
      const transport = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpPort === 465,
        auth: {
          user: this.config.smtpUser,
          pass: this.config.smtpPass
        }
      });
      this.transporter = {
        sendMail: async (args) => transport.sendMail(args)
      };
    }
  }

  /**
   * Create an EmailAlerter instance from environment variables.
   */
  public static fromEnv(args: Readonly<{ stateManager: BotStateStore; logger?: Logger; transporter?: EmailTransporter }>): EmailAlerter {
    const config = emailConfigSchema.parse({
      smtpHost: process.env.SMTP_HOST,
      smtpPort: Number(process.env.SMTP_PORT ?? "587"),
      smtpUser: process.env.SMTP_USER,
      smtpPass: process.env.SMTP_PASS,
      to: process.env.ALERT_EMAIL_TO,
      from: process.env.ALERT_EMAIL_FROM ?? process.env.SMTP_USER,
      dailySummaryHour: Number(process.env.ALERT_DAILY_HOUR ?? "8"),
      rateLimit: {
        windowMs: Number(process.env.ALERT_EMAIL_RATE_WINDOW_MS ?? "60000"),
        maxPerWindow: Number(process.env.ALERT_EMAIL_RATE_MAX ?? "5")
      }
    });

    return new EmailAlerter({
      config,
      stateManager: args.stateManager,
      ...(args.logger !== undefined ? { logger: args.logger } : {}),
      ...(args.transporter !== undefined ? { transporter: args.transporter } : {})
    });
  }

  /**
   * Start daily summary scheduling.
   */
  public start(): void {
    if (this.summaryTimer !== null) {
      return;
    }

    this.scheduleNextSummary();
  }

  /**
   * Stop daily summary scheduling.
   */
  public stop(): void {
    if (this.summaryTimer === null) {
      return;
    }

    this.scheduler.clearTimeout(this.summaryTimer);
    this.summaryTimer = null;
  }

  /**
   * Send an alert email for CRITICAL events.
   */
  public async sendAlert(args: Readonly<{ level: EmailAlertLevel; message: string; botId: string }>): Promise<void> {
    const normalized = this.normalizeLevel(args.level);
    if (normalized !== "CRITICAL") {
      return;
    }

    if (!this.rateLimiter.allow(Date.now())) {
      this.logger.warn("Email alert suppressed by rate limiter", {
        event: "email_rate_limit",
        level: normalized,
        botId: args.botId
      });
      return;
    }

    const subject = `DSTB Trading Bot - Critical Alert (${this.formatDate(new Date())})`;
    const body = [
      "CRITICAL alert received.",
      "",
      `Bot: ${args.botId}`,
      `Message: ${args.message}`,
      "",
      "Please investigate immediately."
    ].join("\n");

    await this.sendEmail(subject, body);
  }

  /**
   * Send the daily summary email now.
   */
  public async sendDailySummary(): Promise<void> {
    try {
      const summary = await this.buildDailySummary();
      const subject = `DSTB Trading Bot - Daily Summary (${this.formatDate(new Date())})`;
      await this.sendEmail(subject, summary);
    } catch (error) {
      this.logger.error("Failed to send daily summary email", {
        event: "email_summary_error",
        error: this.normalizeError(error)
      });
    }
  }

  /**
   * Schedule the next daily summary based on the configured hour.
   */
  private scheduleNextSummary(): void {
    const now = new Date();
    const next = new Date(now);
    next.setHours(this.config.dailySummaryHour, 0, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const delayMs = next.getTime() - now.getTime();
    this.summaryTimer = this.scheduler.setTimeout(() => {
      void this.sendDailySummary().finally(() => {
        this.summaryTimer = null;
        this.scheduleNextSummary();
      });
    }, delayMs);
  }

  /**
   * Build a daily summary email body.
   */
  private async buildDailySummary(): Promise<string> {
    const bots = await this.stateManager.getAllBots();
    const positions = await this.stateManager.getAllOpenPositions();
    const today = this.formatDate(new Date());

    const pnlByBot = await Promise.all(
      bots.map(async (bot) => {
        const pnl = await this.stateManager.getDailyPnL(bot.id, today);
        return { bot, pnl };
      })
    );

    const trades = await this.getTradesForBots(bots, 1);
    const todayRange = this.getDateRange(today);
    const todaysTrades = trades.filter(
      (trade) => trade.exitTime >= todayRange.start && trade.exitTime < todayRange.end
    );

    const totalPnl = pnlByBot.reduce((sum, entry) => sum + entry.pnl, 0);
    const wins = todaysTrades.filter((trade) => trade.pnl > 0);
    const winRate = todaysTrades.length > 0 ? (wins.length / todaysTrades.length) * 100 : 0;

    const botLines = pnlByBot.map((entry) => {
      const status = entry.pnl >= 0 ? "✅" : "❌";
      return `${status} ${entry.bot.name}: ${entry.pnl.toFixed(2)}`;
    });

    const positionLines = positions.length === 0 ? ["None"] : positions.map((position) => this.formatPosition(position));

    return [
      "Hi,",
      "",
      "Here's your daily trading summary:",
      "",
      `Performance (${today}):`,
      `  Total P&L: ${totalPnl.toFixed(2)}`,
      `  Trades: ${todaysTrades.length} (${wins.length} winners, ${todaysTrades.length - wins.length} losers)`,
      `  Win Rate: ${todaysTrades.length > 0 ? winRate.toFixed(1) : "0.0"}%`,
      "",
      `Bots Running: ${bots.length}`,
      ...botLines,
      "",
      "Current Positions:",
      ...positionLines,
      "",
      "System Health: Review Telegram for alerts.",
      "",
      "DSTB Trading Bot"
    ].join("\n");
  }

  /**
   * Send an email using the configured transporter.
   */
  private async sendEmail(subject: string, text: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: this.config.to,
      subject,
      text
    });
  }

  /**
   * Fetch trades across all bots for a recent window.
   */
  private async getTradesForBots(bots: Bot[], days: number): Promise<Trade[]> {
    const tradeLists = await Promise.all(bots.map((bot) => this.stateManager.getTrades(bot.id, days)));
    return tradeLists.flat();
  }

  /**
   * Format a position line for email summaries.
   */
  private formatPosition(position: Position): string {
    return `${position.botId}: ${position.side} ${position.quantity} ${position.symbol} @ ${position.entryPrice.toFixed(2)}`;
  }

  /**
   * Normalize alert levels to monitoring tiers.
   */
  private normalizeLevel(level: EmailAlertLevel): "CRITICAL" | "WARNING" | "INFO" {
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
   * Build a local date range for a YYYY-MM-DD string.
   */
  private getDateRange(date: string): { start: number; end: number } {
    const parts = date.split("-");
    const [yearPart, monthPart, dayPart] = parts;
    if (yearPart === undefined || monthPart === undefined || dayPart === undefined) {
      return { start: 0, end: 0 };
    }

    const year = Number(yearPart);
    const month = Number(monthPart);
    const day = Number(dayPart);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return { start: 0, end: 0 };
    }
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime();
    return { start, end };
  }

  /**
   * Format a date as YYYY-MM-DD.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Normalize unknown errors to strings.
   */
  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    return "Unknown error";
  }
}
