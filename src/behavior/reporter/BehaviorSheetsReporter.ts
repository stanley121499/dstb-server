import { google } from "googleapis";
import * as fs from "node:fs";
import { BehaviorRow } from "../types";

export type BehaviorSheetsReporterOptions = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  tabName: string;   // default "S2-BO-BEHAVIOR-BTC"
}>;

const HEADER_ROW = [
  "Entry Date", "UID", "TradingView Link", "Pair", "Day",
  "Day Owner", "Date (dd/mm/yyyy)", "Date Owner",
  "Asia Range", "Previous-Day Level", "Two-Candle First Interaction Behavior",
  "First Interaction Time", "First Interaction Market Session",
  "First Interaction Market Session Time Mode",
  "Entry Price ($)", "Leverage (X)", "Margin Used ($)", "Position Size (Units)",
  "Account Risk", "Stop Loss Price ($)", "Take Profit Price ($)", "R", "Fees ($)",
  "Exit Price ($)", "Exit Date & Time", "Gross P/L", "Net P/L",
  "Decision Attempt #1 Begin Type", "Decision Attempt #1 Begin Time",
  "Decision Attempt #1 Output", "Decision Attempt #1 Confirm Time",
  "Decision Attempt #1 Failed Status",
  "Resolved Decision Output", "Resolved Decision Strength",
  "Resolved Outcome Direction", "Resolved Outcome MoveScore", "Resolved Outcome Quality",
  "Resolved Outcome Begin Time", "Outcome Peak Time",
  "HTF 4H Edge", "HTF 4H Edge Link",
  "Lifecycle Crossed Day Boundary",
  "Notes",
  "Win", "Loss", "Win$", "Loss$", "In Use", "Month",
  "Consecutive Wins", "Consecutive Losses", "UID Link"
];

// Reusing types from GoogleSheetsReporter where applicable
export type SheetProperties = { title?: string };
export type SheetData = { properties?: SheetProperties };
export type GetResponse = { data: { sheets?: SheetData[] } };
export type AddSheetRequest = { addSheet: { properties: { title: string; gridProperties?: { frozenRowCount?: number } } } };
export type BatchUpdateRequest = { spreadsheetId: string; requestBody: { requests: AddSheetRequest[] } };
export type UpdateRequest = { spreadsheetId: string; range: string; valueInputOption: string; requestBody: { values: string[][] } };

export type SheetsClient = {
  spreadsheets: {
    get: (params: any, options?: any) => Promise<GetResponse>;
    batchUpdate: (params: any, options?: any) => Promise<unknown>;
    values: {
      update: (params: any, options?: any) => Promise<unknown>;
      clear: (params: any, options?: any) => Promise<unknown>;
      append: (params: any, options?: any) => Promise<unknown>;
    };
  };
};

export class BehaviorSheetsReporter {
  private readonly options: BehaviorSheetsReporterOptions;
  private readonly sheetsClient: SheetsClient;

  constructor(options: BehaviorSheetsReporterOptions) {
    this.options = options;

    if (!fs.existsSync(this.options.serviceAccountKeyPath)) {
      throw new Error(`Google service account key not found: ${this.options.serviceAccountKeyPath}`);
    }

    this.sheetsClient = google.sheets({
      version: "v4",
      auth: new google.auth.GoogleAuth({
        keyFile: this.options.serviceAccountKeyPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
      })
    }) as unknown as SheetsClient;
  }

  /** Reads GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, BEHAVIOR_SHEET_TAB from env. */
  static fromEnv(): BehaviorSheetsReporter {
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const tabName = process.env.BEHAVIOR_SHEET_TAB ?? "S2-BO-BEHAVIOR-BTC";

    if (!sheetId || !serviceAccountKeyPath) {
      throw new Error("GOOGLE_SHEETS_ID or GOOGLE_SERVICE_ACCOUNT_KEY missing from env");
    }

    return new BehaviorSheetsReporter({
      sheetId,
      serviceAccountKeyPath,
      tabName
    });
  }

  /** Creates tab if missing; freezes row 1. Safe to call multiple times. */
  async ensureTab(): Promise<void> {
    try {
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.options.sheetId
      });

      const existing = response.data.sheets?.map((sheet) => sheet.properties?.title ?? "") ?? [];

      if (!existing.includes(this.options.tabName)) {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.options.sheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.options.tabName,
                    gridProperties: { frozenRowCount: 1 }
                  }
                }
              }
            ]
          }
        });
      }
    } catch (error) {
      console.error("[BehaviorSheetsReporter] ensureTab error:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Clear → header → rows in batches of 50 (1s delay each batch). Calls ensureTab() first. */
  async bulkWrite(rows: readonly BehaviorRow[]): Promise<void> {
    try {
      await this.ensureTab();

      // Clear the sheet
      await this.sheetsClient.spreadsheets.values.clear({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A:AZ`
      });

      // Write header (52 columns: A → AZ)
      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A1:AZ1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADER_ROW] }
      });

      const chunkedRows: string[][][] = [];
      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize).map(r => this.rowToArray(r));
        chunkedRows.push(chunk);
      }

      for (let i = 0; i < chunkedRows.length; i++) {
        const batch = chunkedRows[i];
        if (!batch || batch.length === 0) continue;

        await this.sheetsClient.spreadsheets.values.append({
          spreadsheetId: this.options.sheetId,
          range: `${this.options.tabName}!A2:AZ`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: batch }
        });

        if (i < chunkedRows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error("[BehaviorSheetsReporter] bulkWrite error:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Append one row. Calls ensureTab() first (idempotent). */
  async appendRow(row: BehaviorRow): Promise<void> {
    try {
      await this.ensureTab();

      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A:AZ`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [this.rowToArray(row)] }
      });
    } catch (error) {
      console.error("[BehaviorSheetsReporter] appendRow error:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private rowToArray(row: BehaviorRow): string[] {
    return [
      row.entryDate, row.uid, row.tradingViewLink, row.pair, row.day,
      row.dayOwner, row.date, row.dateOwner, row.asiaRange, row.previousDayLevel,
      row.twoCandleBehavior, row.firstInteractionTime, row.firstInteractionSession,
      row.firstInteractionSessionTimeMode,
      row.entryPrice, row.leverage, row.marginUsed, row.positionSize,
      row.accountRisk, row.stopLossPrice, row.takeProfitPrice, row.r, row.fees,
      row.exitPrice, row.exitDateTime, row.grossPnl, row.netPnl,
      row.decisionBeginType, row.decisionBeginTime, row.decisionOutput, row.decisionConfirmTime,
      row.failedStatus, row.resolvedDecisionOutput, row.resolvedDecisionStrength,
      row.resolvedOutcomeDirection, row.moveScoreValue, row.resolvedOutcomeQuality, row.resolvedOutcomeBeginTime,
      row.outcomePeakTime, row.htf4hEdge, row.htf4hEdgeLink,
      row.lifecycleCrossedDayBoundary, row.notes,
      row.win, row.loss, row.winDollar, row.lossDollar, row.inUse, row.month,
      row.consecutiveWins, row.consecutiveLosses, row.uidLink
    ];
  }
}
