import { google } from "googleapis";
import * as fs from "node:fs";
import { BehaviorRow } from "../types";

export type BehaviorSheetsReporterOptions = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  tabName: string;   // default "S2-BO-BEHAVIOR-BTC"
}>;

const HEADER_ROW = [
  "TradingView Link", "Pair", "Day",
  "Day Owner\n(Which trading day's behavior does this belong to)",
  "Date \n(dd/mm/yyyy)",
  "Date Owner\n(Which date should this be counted under)",
  "Asia Range \n(Which side of Asia range liquidity was first interacted)",
  "Previous-Day Level\n (First interaction decision level)",
  "Two-Candle First Interaction Behavior\n(First two 15M candles closed after PDH/PDL interaction at decision level, 2nd candle more important)",
  "First Interaction Time\n(Time of the first 15M candle closed only that interacts with PDH/PDL)",
  "First Interaction Market Session Timing\n(Market session and phase at the time of first PDH/PDL decision level interaction)",
  "First Interaction Market Session Time Mode\n(Identifies the time standard condition at the moment of the first PDH/PDL interaction)",
  "Entry Price ($)", "Leverage (X)", "Margin Used ($)", "Position Size (Units)",
  "Account Risk", "Stop Loss Price ($)", "Take Profit Price ($)", "R", "Fees ($)",
  "Exit Price ($)",
  "Exit date and time\n(dd/mm/yyyy hh:mm:ss)",
  "Gross P/L (before fees)", "Net P/L (after fees)",
  "Decision Attempt #1 Begin Type \n(How the market initiated the decision process at PDH/PDL)",
  "Decision Attempt #1 Begin Time\n(This is the first structural directional intent)",
  "Decision Attempt #1 Output\n(This is fully aligned with your 2-consecutive-candle closed rule and PDH/PDL structure)",
  "Decision Attempt #1 Confirm Time\n(Based on Decision Attempt #1 Output)",
  "Decision Attempt #1 Failed Status\n(Measures durability of the confirmed first attempt + c3-c6)",
  "Resolved Decision Output \n(Represents the true decision outcome, not the initial attempt #1 + c3-c6 candle cosed)",
  "Resolved Decision Strength\n(Strength and quality of the market's decision attempt at PDH/PDL)",
  "Resolved Outcome Direction\n(Actual price response CONTINUATION, MEAN-REVERSION or STALL, after a resolved decision)",
  "Resolved Outcome MoveScore\n(Value represents how far price moved relative to the Decision Level, expressed in ATR units)",
  "Resolved Outcome Quality\n(How quality the resolved-decision move was measured by Move Score)",
  "Resolved Outcome Begin Time\n(Marks the start of post-confirmation commitment)",
  "Outcome Peak Time\n(Time of Maximum Expansion Before Exhaustion)",
  "HTF 4H Edge\n (4H Structural Context at the moment the Decision is confirmed)",
  "HTF 4H Edge Link\n(Manual input time being)",
  "Lifecycle Crossed Day Boundary\n(Captures how far the behavioral lifecycle extends relative to the daily reset (08:00:00)"
];

// Reusing types from GoogleSheetsReporter where applicable
export type SheetProperties = { title?: string; sheetId?: number };
export type SheetGridRange = {
  sheetId?: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
};
/** Basic (toolbar) filter — UI-only; Values API still sees all rows. */
export type BasicFilter = {
  range?: SheetGridRange;
  sortSpecs?: ReadonlyArray<Record<string, unknown>>;
  filterSpecs?: ReadonlyArray<Record<string, unknown>>;
};
export type SheetData = { properties?: SheetProperties; basicFilter?: BasicFilter };
export type GetResponse = { data: { sheets?: SheetData[] } };
export type AddSheetRequest = { addSheet: { properties: { title: string; gridProperties?: { frozenRowCount?: number } } } };
export type ClearBasicFilterRequest = { clearBasicFilter: { sheetId: number } };
export type SetBasicFilterRequest = { setBasicFilter: { filter: BasicFilter } };
export type BatchUpdateBodyRequest = AddSheetRequest | ClearBasicFilterRequest | SetBasicFilterRequest;
export type BatchUpdateRequest = { spreadsheetId: string; requestBody: { requests: BatchUpdateBodyRequest[] } };
export type UpdateRequest = { spreadsheetId: string; range: string; valueInputOption: string; requestBody: { values: string[][] } };

export type SheetsValuesGetResponse = { data: { values?: string[][] } };

export type SheetsClient = {
  spreadsheets: {
    get: (params: {
      spreadsheetId: string;
      fields?: string;
    }) => Promise<GetResponse>;
    batchUpdate: (params: BatchUpdateRequest) => Promise<unknown>;
    values: {
      get: (params: {
        spreadsheetId: string;
        range: string;
        majorDimension?: string;
      }) => Promise<SheetsValuesGetResponse>;
      update: (params: UpdateRequest) => Promise<unknown>;
      clear: (params: { spreadsheetId: string; range: string }) => Promise<unknown>;
      append: (params: {
        spreadsheetId: string;
        range: string;
        valueInputOption: string;
        insertDataOption?: string;
        requestBody: { values: string[][] };
      }) => Promise<unknown>;
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

      // Write at explicit rows (avoid values.append table-detection with empty col A).
      const batchSize = 50;
      let nextRow = 2;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize).map((r) => this.rowToArray(r));
        if (batch.length === 0) continue;
        const endRow = nextRow + batch.length - 1;
        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.options.sheetId,
          range: `${this.options.tabName}!A${nextRow}:AZ${endRow}`,
          valueInputOption: "RAW",
          requestBody: { values: batch },
        });
        nextRow = endRow + 1;
        if (i + batchSize < rows.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error("[BehaviorSheetsReporter] bulkWrite error:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Short id for logs so we can confirm which spreadsheet Render is writing to. */
  describeTarget(): string {
    const id = this.options.sheetId;
    const tail = id.length > 8 ? id.slice(-8) : id;
    return `sheet …${tail} tab "${this.options.tabName}"`;
  }

  /**
   * Reads column E (the "Date (dd/mm/yyyy)" field) and returns the last data row's date
   * as a "YYYY-MM-DD" string, or null if the sheet has no data rows yet.
   * Used to determine the start date for incremental backfill runs.
   */
  async readLastRowDate(): Promise<string | null> {
    const meta = await this.readLastDataRowMeta();
    return meta === null ? null : meta.isoDate;
  }

  /**
   * Last non-empty column-E cell: 1-based sheet row + parsed ISO date.
   * Row 1 is the header; data starts at row 2.
   */
  async readLastDataRowMeta(): Promise<{ rowNumber: number; isoDate: string } | null> {
    try {
      await this.ensureTab();
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.options.sheetId,
        // Column E = date field (dd/mm/yyyy). Skip row 1 (header).
        range: `${this.options.tabName}!E2:E`,
        majorDimension: "COLUMNS",
      });
      const col = response.data.values?.[0];
      if (col === undefined || col.length === 0) {
        return null;
      }
      // Find the last non-empty cell.
      let lastVal: string | undefined;
      let lastIndex = -1;
      for (let i = col.length - 1; i >= 0; i--) {
        const v = col[i];
        if (typeof v === "string" && v.trim().length > 0) {
          lastVal = v.trim().replace(/^'/, "");
          lastIndex = i;
          break;
        }
      }
      if (lastVal === undefined || lastIndex < 0) {
        return null;
      }
      // Parse "dd/mm/yyyy" → "YYYY-MM-DD".
      const parts = lastVal.split("/");
      if (parts.length !== 3) {
        return null;
      }
      const [dd, mm, yyyy] = parts;
      if (dd === undefined || mm === undefined || yyyy === undefined) {
        return null;
      }
      return {
        rowNumber: lastIndex + 2,
        isoDate: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`,
      };
    } catch (err) {
      console.error("[BehaviorSheetsReporter] readLastDataRowMeta error:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Writes rows at the true bottom of the tab via values.update (not values.append).
   *
   * Why not append:
   * - Empty column A + active basic filters make Sheets "table detection" insert
   *   mid-sheet (API still returns success; last date never advances).
   * - values.get / values.update use the full grid and ignore filter visibility.
   */
  async appendRows(rows: readonly BehaviorRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.ensureTab();
      const tabState = await this.readTabState();
      if (tabState !== null && tabState.basicFilter !== undefined) {
        console.log(
          `[BehaviorSheetsReporter] Basic filter is ON (${this.describeTarget()}) — writing by absolute row (filter does not hide data from the API).`
        );
      }

      const meta = await this.readLastDataRowMeta();
      let nextRow = meta === null ? 2 : meta.rowNumber + 1;
      const batchSize = 50;
      let lastWrittenRow = nextRow - 1;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize).map((r) => this.rowToArray(r));
        const endRow = nextRow + chunk.length - 1;
        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.options.sheetId,
          range: `${this.options.tabName}!A${nextRow}:AZ${endRow}`,
          valueInputOption: "RAW",
          requestBody: { values: chunk },
        });
        console.log(
          `[BehaviorSheetsReporter] Wrote ${chunk.length} row(s) at A${nextRow} (${this.describeTarget()})`
        );
        lastWrittenRow = endRow;
        nextRow = endRow + 1;
        if (i + batchSize < rows.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Keep Darren's filter criteria, but expand its range to include new rows.
      if (tabState !== null && tabState.basicFilter !== undefined && lastWrittenRow >= 2) {
        await this.expandBasicFilterToRow(tabState, lastWrittenRow);
      }
    } catch (error) {
      console.error("[BehaviorSheetsReporter] appendRows error:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Append one row at the true bottom of the tab. */
  async appendRow(row: BehaviorRow): Promise<void> {
    await this.appendRows([row]);
  }

  /** Numeric sheetId + optional basic filter for the configured tab. */
  private async readTabState(): Promise<{
    sheetId: number;
    basicFilter: BasicFilter | undefined;
  } | null> {
    const response = await this.sheetsClient.spreadsheets.get({
      spreadsheetId: this.options.sheetId,
      fields: "sheets(properties(sheetId,title),basicFilter)",
    });
    const match = response.data.sheets?.find(
      (sheet) => (sheet.properties?.title ?? "") === this.options.tabName
    );
    const sheetId = match?.properties?.sheetId;
    if (typeof sheetId !== "number") {
      return null;
    }
    return { sheetId, basicFilter: match.basicFilter };
  }

  /**
   * Re-applies the existing basic filter with endRowIndex covering lastDataRow (1-based).
   * Does not clear filter criteria — only grows the range so new rows stay in-filter.
   */
  private async expandBasicFilterToRow(
    tabState: { sheetId: number; basicFilter: BasicFilter },
    lastDataRow1Based: number
  ): Promise<void> {
    const existing = tabState.basicFilter;
    const prevEnd = existing.range?.endRowIndex ?? 0;
    // endRowIndex is exclusive; row N (1-based) => index N.
    const neededEnd = lastDataRow1Based;
    if (prevEnd >= neededEnd) {
      return;
    }
    const nextFilter: BasicFilter = {
      ...existing,
      range: {
        sheetId: tabState.sheetId,
        startRowIndex: existing.range?.startRowIndex ?? 0,
        endRowIndex: neededEnd,
        startColumnIndex: existing.range?.startColumnIndex ?? 0,
        endColumnIndex: existing.range?.endColumnIndex ?? 52,
      },
    };
    await this.sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: this.options.sheetId,
      requestBody: {
        requests: [{ setBasicFilter: { filter: nextFilter } }],
      },
    });
    console.log(
      `[BehaviorSheetsReporter] Expanded basic filter through row ${lastDataRow1Based} (${this.describeTarget()})`
    );
  }

  private rowToArray(row: BehaviorRow): string[] {
    return [
      row.tradingViewLink, row.pair, row.day,
      row.dayOwner, row.date, row.dateOwner,
      row.asiaRange, row.previousDayLevel,
      row.twoCandleBehavior, row.firstInteractionTime,
      row.firstInteractionSession, row.firstInteractionSessionTimeMode,
      row.entryPrice, row.leverage, row.marginUsed, row.positionSize,
      row.accountRisk, row.stopLossPrice, row.takeProfitPrice, row.r, row.fees,
      row.exitPrice, row.exitDateTime, row.grossPnl, row.netPnl,
      row.decisionBeginType, row.decisionBeginTime, row.decisionOutput, row.decisionConfirmTime,
      row.failedStatus, row.resolvedDecisionOutput, row.resolvedDecisionStrength,
      row.resolvedOutcomeDirection, row.moveScoreValue, row.resolvedOutcomeQuality,
      row.resolvedOutcomeBeginTime, row.outcomePeakTime,
      row.htf4hEdge, row.htf4hEdgeLink,
      row.lifecycleCrossedDayBoundary
    ];
  }
}
