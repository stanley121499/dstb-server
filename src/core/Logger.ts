import fs from "node:fs";
import path from "node:path";

import { LogLevel } from "./types";

/**
 * Structured logger that writes daily log files with rotation.
 */
export class Logger {
  private readonly botId: string;
  private readonly logDir: string;
  private readonly retentionDays: number;
  private lastRotationDate: string | null = null;

  /**
   * Create a new Logger instance.
   *
   * Inputs:
   * - botId: Bot identifier for log tagging.
   * - logDir: Directory to write log files.
   *
   * Outputs:
   * - Logger instance.
   *
   * Error behavior:
   * - Ensures log directory exists; throws if creation fails.
   */
  constructor(botId: string, logDir: string) {
    this.botId = botId;
    this.logDir = logDir;
    this.retentionDays = 30;

    this.ensureDirectory(this.logDir);
  }

  /**
   * Write a DEBUG log entry.
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.write("DEBUG", message, context);
  }

  /**
   * Write an INFO log entry.
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.write("INFO", message, context);
  }

  /**
   * Write a WARN log entry.
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.write("WARN", message, context);
  }

  /**
   * Write an ERROR log entry.
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.write("ERROR", message, context);
  }

  /**
   * Write a CRITICAL log entry.
   */
  critical(message: string, context?: Record<string, unknown>): void {
    this.write("CRITICAL", message, context);
  }

  /**
   * Get current log file path for this bot.
   */
  getCurrentLogFile(): string {
    const date = this.formatDate(new Date());
    return path.join(this.logDir, `bot-${this.botId}-${date}.log`);
  }

  /**
   * Append a log entry with rotation and formatting.
   */
  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const now = new Date();
    const date = this.formatDate(now);

    // Rotate logs once per day to enforce retention.
    if (this.lastRotationDate !== date) {
      this.pruneOldLogs();
      this.lastRotationDate = date;
    }

    const timestamp = this.formatTimestamp(now);
    const base = `[${timestamp}] ${level} [${this.botId}] ${message}`;
    const contextParts = context ? this.formatContext(context) : "";
    const jsonContext = context ? ` | context=${JSON.stringify(context)}` : "";
    const line = `${base}${contextParts}${jsonContext}`;

    fs.appendFileSync(this.getCurrentLogFile(), `${line}\n`, "utf8");
  }

  /**
   * Format context as human-readable key/value pairs.
   */
  private formatContext(context: Record<string, unknown>): string {
    const entries = Object.entries(context);
    if (entries.length === 0) {
      return "";
    }

    const pairs = entries.map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}=${value}`;
      }

      return `${key}=${JSON.stringify(value)}`;
    });

    return ` | ${pairs.join(" ")}`;
  }

  /**
   * Format timestamp as YYYY-MM-DD HH:mm:ss.
   */
  private formatTimestamp(date: Date): string {
    const datePart = this.formatDate(date);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${datePart} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Format date as YYYY-MM-DD.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  /**
   * Ensure a directory exists.
   */
  private ensureDirectory(directoryPath: string): void {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }

  /**
   * Remove log files older than retention window.
   */
  private pruneOldLogs(): void {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(this.logDir);

    entries.forEach((entry) => {
      if (!entry.startsWith(`bot-${this.botId}-`) || !entry.endsWith(".log")) {
        return;
      }

      const filePath = path.join(this.logDir, entry);
      const stats = fs.statSync(filePath);

      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    });
  }
}
