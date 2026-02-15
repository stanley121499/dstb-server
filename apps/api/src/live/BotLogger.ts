import { createWriteStream, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { WriteStream } from "fs";

import type { SupabaseClient } from "../supabase/client.js";

export type BotLogLevel = "debug" | "info" | "warn" | "error" | "critical";
export type BotLogCategory = "signal" | "order" | "position" | "system" | "exchange" | "strategy";

type BotLogArgs = Readonly<{
  botId: string;
  level: BotLogLevel;
  category: BotLogCategory;
  message: string;
  context?: Readonly<Record<string, unknown>>;
  positionId?: string | null;
  orderId?: string | null;
}>;

/**
 * Centralized logging for live trading bots with Supabase persistence and file logging.
 */
export class BotLogger {
  private readonly supabase: SupabaseClient;
  private readonly botId: string;
  private fileStream: WriteStream | null;
  private currentLogDate: string | null;
  private readonly logsDir: string;

  /**
   * Creates a new logger scoped to a bot id.
   */
  public constructor(args: Readonly<{ supabase: SupabaseClient; botId: string }>) {
    this.supabase = args.supabase;
    this.botId = args.botId;
    this.fileStream = null;
    this.currentLogDate = null;
    this.logsDir = join(process.cwd(), "logs");
    
    // Ensure logs directory exists
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Ensures the file stream is open for today's log file.
   * Rotates to a new file if the date has changed.
   */
  private ensureFileStream(): void {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    if (this.currentLogDate === today && this.fileStream !== null) {
      return; // Already using today's log file
    }
    
    // Close existing stream if rotating
    if (this.fileStream !== null) {
      this.fileStream.end();
    }
    
    // Create new stream for today
    const logFileName = `bot-${this.botId}-${today}.log`;
    const logFilePath = join(this.logsDir, logFileName);
    this.fileStream = createWriteStream(logFilePath, { flags: "a" }); // Append mode
    this.currentLogDate = today;
  }

  /**
   * Closes the file stream (call when bot stops).
   */
  public close(): void {
    if (this.fileStream !== null) {
      this.fileStream.end();
      this.fileStream = null;
      this.currentLogDate = null;
    }
  }

  /**
   * Logs a strategy signal event.
   */
  public async logSignal(args: Readonly<{ signal: unknown; context?: Readonly<Record<string, unknown>> }>): Promise<void> {
    await this.write({
      level: "info",
      category: "signal",
      message: "Signal evaluated",
      context: {
        signal: args.signal,
        ...args.context
      }
    });
  }

  /**
   * Logs an order placement event.
   */
  public async logOrderPlaced(args: Readonly<{ order: unknown }>): Promise<void> {
    await this.write({
      level: "info",
      category: "order",
      message: "Order placed",
      context: { order: args.order }
    });
  }

  /**
   * Logs an order fill event.
   */
  public async logOrderFilled(args: Readonly<{ order: unknown }>): Promise<void> {
    await this.write({
      level: "info",
      category: "order",
      message: "Order filled",
      context: { order: args.order }
    });
  }

  /**
   * Logs a position open event.
   */
  public async logPositionOpened(args: Readonly<{ position: unknown }>): Promise<void> {
    await this.write({
      level: "info",
      category: "position",
      message: "Position opened",
      context: { position: args.position }
    });
  }

  /**
   * Logs a position close event.
   */
  public async logPositionClosed(args: Readonly<{ trade: unknown }>): Promise<void> {
    await this.write({
      level: "info",
      category: "position",
      message: "Position closed",
      context: { trade: args.trade }
    });
  }

  /**
   * Logs an error event.
   */
  public async logError(args: Readonly<{ message: string; context?: Readonly<Record<string, unknown>> }>): Promise<void> {
    const writeArgs: Omit<BotLogArgs, "botId"> =
      args.context !== undefined
        ? {
            level: "error",
            category: "system",
            message: args.message,
            context: args.context
          }
        : {
            level: "error",
            category: "system",
            message: args.message
          };
    await this.write(writeArgs);
  }

  /**
   * Logs an informational event.
   */
  public async logInfo(args: Readonly<{ message: string; context?: Readonly<Record<string, unknown>> }>): Promise<void> {
    const writeArgs: Omit<BotLogArgs, "botId"> =
      args.context !== undefined
        ? {
            level: "info",
            category: "system",
            message: args.message,
            context: args.context
          }
        : {
            level: "info",
            category: "system",
            message: args.message
          };
    await this.write(writeArgs);
  }

  private async write(args: Omit<BotLogArgs, "botId">): Promise<void> {
    const timestamp = new Date().toISOString();
    const payload = {
      bot_id: this.botId,
      level: args.level,
      category: args.category,
      message: args.message,
      context: args.context ?? {},
      position_id: args.positionId ?? null,
      order_id: args.orderId ?? null
    };

    const line = `[bot:${this.botId}] ${args.level.toUpperCase()} ${args.category} ${args.message}`;
    if (args.level === "error" || args.level === "critical") {
      console.error(line, args.context ?? {});
    } else {
      console.log(line, args.context ?? {});
    }

    // Write to file (async, non-blocking)
    try {
      this.ensureFileStream();
      if (this.fileStream !== null) {
        // Write as JSON lines format for easy parsing
        const logEntry = JSON.stringify({
          timestamp,
          botId: this.botId,
          level: args.level,
          category: args.category,
          message: args.message,
          context: args.context ?? {},
          positionId: args.positionId ?? null,
          orderId: args.orderId ?? null
        });
        this.fileStream.write(logEntry + "\n");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown file write error";
      console.error(`[bot:${this.botId}] File logging failed`, message);
    }

    // Write to database (async, best effort)
    try {
      const result = await this.supabase.from("bot_logs").insert(payload);
      if (result.error !== null) {
        console.error(`[bot:${this.botId}] bot_logs insert failed`, result.error);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown bot log error";
      console.error(`[bot:${this.botId}] bot_logs insert exception`, message);
    }
  }
}
