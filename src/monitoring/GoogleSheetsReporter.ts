import fs from "node:fs";

import { google } from "googleapis";
import { z } from "zod";

import { Logger } from "../core/Logger";
import { StateManager } from "../core/StateManager";
import { Bot, Position, Trade } from "../core/types";

/**
 * Scheduler interface for timed updates.
 */
export type IntervalScheduler = Readonly<{
  setInterval: (handler: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (timer: NodeJS.Timeout) => void;
}>;

/**
 * Minimal Google Sheets client interface for dependency injection.
 */
export type SheetProperties = { title?: string };
export type SheetData = { properties?: SheetProperties };
export type GetResponse = { data: { sheets?: SheetData[] } };
export type AddSheetRequest = { addSheet: { properties: { title: string } } };
export type BatchUpdateRequest = { spreadsheetId: string; requestBody: { requests: AddSheetRequest[] } };
export type UpdateRequest = { spreadsheetId: string; range: string; valueInputOption: string; requestBody: { values: string[][] } };

export type SheetsClient = {
  spreadsheets: {
    get: (args: { spreadsheetId: string }) => Promise<GetResponse>;
    batchUpdate: (args: BatchUpdateRequest) => Promise<unknown>;
    values: {
      update: (args: UpdateRequest) => Promise<unknown>;
    };
  };
};

/**
 * Google Sheets reporter configuration.
 */
export type GoogleSheetsReporterConfig = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  updateIntervalMs: number;
  tradeHistoryDays: number;
  summaryDays: number;
  maxTrades: number;
}>;

/**
 * Dependencies required to build a Google Sheets reporter.
 */
export type GoogleSheetsReporterOptions = Readonly<{
  config: GoogleSheetsReporterConfig;
  stateManager: StateManager;
  logger?: Logger;
  scheduler?: IntervalScheduler;
  sheetsClient?: SheetsClient;
}>;

const sheetsConfigSchema = z
  .object({
    sheetId: z.string().trim().min(1),
    serviceAccountKeyPath: z.string().trim().min(1),
    updateIntervalMs: z.number().int().positive().default(300_000),
    tradeHistoryDays: z.number().int().positive().default(7),
    summaryDays: z.number().int().positive().default(7),
    maxTrades: z.number().int().positive().default(200)
  })
  .strict();

const SHEET_TABS = ["Live Status", "Trade History", "Daily Summary"] as const;
type SheetTab = (typeof SHEET_TABS)[number];

/**
 * Google Sheets reporter for periodic dashboard updates.
 */
export class GoogleSheetsReporter {
  private readonly config: GoogleSheetsReporterConfig;
  private readonly stateManager: StateManager;
  private readonly logger: Logger;
  private readonly scheduler: IntervalScheduler;
  private readonly sheetsClient: SheetsClient;
  private updateTimer: NodeJS.Timeout | null = null;

  /**
   * Create a new Google Sheets reporter.
   *
   * Inputs:
   * - config: GoogleSheetsReporterConfig.
   * - stateManager: SQLite-backed state manager.
   *
   * Outputs:
   * - GoogleSheetsReporter instance.
   *
   * Error behavior:
   * - Throws on invalid configuration or missing service account key.
   */
  public constructor(options: GoogleSheetsReporterOptions) {
    // Step 1: Validate configuration.
    this.config = sheetsConfigSchema.parse(options.config);

    // Step 2: Validate service account key file.
    if (!fs.existsSync(this.config.serviceAccountKeyPath)) {
      throw new Error(
        `Google service account key not found: ${this.config.serviceAccountKeyPath}`
      );
    }

    // Step 3: Store dependencies.
    this.stateManager = options.stateManager;
    this.logger = options.logger ?? new Logger("monitoring", "logs");
    this.scheduler = options.scheduler ?? {
      setInterval,
      clearInterval
    };

    // Step 4: Initialize Google Sheets client.
    this.sheetsClient =
      options.sheetsClient ??
      google.sheets({
        version: "v4",
        auth: new google.auth.GoogleAuth({
          keyFile: this.config.serviceAccountKeyPath,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        })
      });
  }

  /**
   * Create a reporter from environment variables.
   */
  public static fromEnv(args: Readonly<{ stateManager: StateManager; logger?: Logger; scheduler?: IntervalScheduler }>): GoogleSheetsReporter {
    const config = sheetsConfigSchema.parse({
      sheetId: process.env.GOOGLE_SHEETS_ID,
      serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
      updateIntervalMs: Number(process.env.GOOGLE_SHEETS_INTERVAL_MS ?? "300000"),
      tradeHistoryDays: Number(process.env.GOOGLE_SHEETS_TRADE_DAYS ?? "7"),
      summaryDays: Number(process.env.GOOGLE_SHEETS_SUMMARY_DAYS ?? "7"),
      maxTrades: Number(process.env.GOOGLE_SHEETS_MAX_TRADES ?? "200")
    });

    return new GoogleSheetsReporter({
      config,
      stateManager: args.stateManager,
      logger: args.logger,
      scheduler: args.scheduler
    });
  }

  /**
   * Start periodic updates to Google Sheets.
   */
  public start(): void {
    if (this.updateTimer !== null) {
      return;
    }

    // Step 1: Run the first update immediately.
    void this.updateOnce();

    // Step 2: Schedule recurring updates.
    this.updateTimer = this.scheduler.setInterval(() => {
      void this.updateOnce();
    }, this.config.updateIntervalMs);
  }

  /**
   * Stop periodic updates.
   */
  public stop(): void {
    if (this.updateTimer === null) {
      return;
    }

    this.scheduler.clearInterval(this.updateTimer);
    this.updateTimer = null;
  }

  /**
   * Update all dashboard tabs once.
   */
  public async updateOnce(): Promise<void> {
    try {
      // Step 1: Ensure sheet tabs exist.
      await this.ensureSheetStructure();

      // Step 2: Update each dashboard section.
      await this.updateLiveStatus();
      await this.updateTradeHistory();
      await this.updateDailySummary();
    } catch (error) {
      this.logger.error("Google Sheets update failed", {
        event: "sheets_update_error",
        error: this.normalizeError(error)
      });
    }
  }

  /**
   * Ensure required sheet tabs exist.
   */
  private async ensureSheetStructure(): Promise<void> {
    const response = await this.sheetsClient.spreadsheets.get({
      spreadsheetId: this.config.sheetId
    });

    const existing =
      response.data.sheets?.map((sheet) => sheet.properties?.title ?? "") ?? [];

    const missing = SHEET_TABS.filter((tab) => !existing.includes(tab));
    if (missing.length === 0) {
      return;
    }

    await this.sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: this.config.sheetId,
      requestBody: {
        requests: missing.map((tab) => ({
          addSheet: { properties: { title: tab } }
        }))
      }
    });
  }

  /**
   * Update the Live Status tab with current bot snapshot data.
   */
  private async updateLiveStatus(): Promise<void> {
    const bots = await this.stateManager.getAllBots();
    const positions = await this.stateManager.getAllOpenPositions();

    const today = this.formatDate(new Date());
    const rows = await Promise.all(
      bots.map(async (bot) => {
        const botPositions = positions.filter((position) => position.botId === bot.id);
        const positionText = this.formatPositions(botPositions);
        const dailyPnl = await this.stateManager.getDailyPnL(bot.id, today);
        return [
          new Date().toISOString(),
          bot.name,
          bot.strategy,
          bot.currentEquity.toFixed(2),
          dailyPnl.toFixed(2),
          positionText,
          bot.status,
          this.formatHeartbeat(bot.lastHeartbeat)
        ];
      })
    );

    const values = [
      ["Time", "Bot Name", "Strategy", "Equity", "Today P&L", "Position", "Status", "Heartbeat"],
      ...rows
    ];

    await this.writeValues("Live Status", "A1:H", values);
  }

  /**
   * Update the Trade History tab with recent trades.
   */
  private async updateTradeHistory(): Promise<void> {
    const bots = await this.stateManager.getAllBots();
    const tradeLists = await Promise.all(
      bots.map((bot) => this.stateManager.getTrades(bot.id, this.config.tradeHistoryDays))
    );

    const trades = tradeLists.flat().sort((a, b) => b.exitTime - a.exitTime);
    const trimmed = trades.slice(0, this.config.maxTrades);

    const rows = trimmed.map((trade) => [
      this.formatDate(new Date(trade.exitTime)),
      trade.botId,
      trade.side,
      trade.entryPrice.toFixed(2),
      trade.exitPrice.toFixed(2),
      trade.pnl.toFixed(2),
      trade.rMultiple !== undefined ? trade.rMultiple.toFixed(2) : ""
    ]);

    const values = [
      ["Date", "Bot", "Side", "Entry", "Exit", "PnL", "R-Mult"],
      ...rows
    ];

    await this.writeValues("Trade History", "A1:G", values);
  }

  /**
   * Update the Daily Summary tab with aggregated results.
   */
  private async updateDailySummary(): Promise<void> {
    const bots = await this.stateManager.getAllBots();
    const dates = this.getRecentDates(this.config.summaryDays);
    const totalEquity = bots.reduce((sum, bot) => sum + bot.currentEquity, 0);

    const allTrades = await this.getTradesForBots(bots, this.config.summaryDays);

    const rows = dates.map((date) => {
      const range = this.getDateRange(date);
      const trades = allTrades.filter((trade) => trade.exitTime >= range.start && trade.exitTime < range.end);
      const wins = trades.filter((trade) => trade.pnl > 0);
      const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
      const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

      return [
        date,
        date === this.formatDate(new Date()) ? totalEquity.toFixed(2) : "",
        totalPnl.toFixed(2),
        String(trades.length),
        trades.length > 0 ? `${winRate.toFixed(1)}%` : ""
      ];
    });

    const values = [
      ["Date", "Total Equity", "Day PnL", "Trades", "Win Rate"],
      ...rows
    ];

    await this.writeValues("Daily Summary", "A1:E", values);
  }

  /**
   * Write values to a target sheet range.
   */
  private async writeValues(tab: SheetTab, range: string, values: string[][]): Promise<void> {
    await this.sheetsClient.spreadsheets.values.update({
      spreadsheetId: this.config.sheetId,
      range: `${tab}!${range}`,
      valueInputOption: "RAW",
      requestBody: { values }
    });
  }

  /**
   * Fetch trades for bots within the requested time window.
   */
  private async getTradesForBots(bots: Bot[], days: number): Promise<Trade[]> {
    const tradeLists = await Promise.all(bots.map((bot) => this.stateManager.getTrades(bot.id, days)));
    return tradeLists.flat();
  }

  /**
   * Format open positions into a concise string.
   */
  private formatPositions(positions: Position[]): string {
    if (positions.length === 0) {
      return "None";
    }

    return positions
      .map((position) => `${position.side} ${position.quantity} ${position.symbol}`)
      .join(" | ");
  }

  /**
   * Format heartbeat timestamp as relative minutes ago.
   */
  private formatHeartbeat(heartbeat?: number): string {
    if (heartbeat === undefined || heartbeat <= 0) {
      return "unknown";
    }
    const minutes = Math.floor((Date.now() - heartbeat) / 60000);
    return `${minutes}m ago`;
  }

  /**
   * Return recent date strings in YYYY-MM-DD format.
   */
  private getRecentDates(days: number): string[] {
    const results: string[] = [];
    const now = new Date();

    for (let i = 0; i < days; i += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      results.push(this.formatDate(date));
    }

    return results;
  }

  /**
   * Build date range boundaries for a local date string.
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
   * Normalize unknown errors to a string.
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
