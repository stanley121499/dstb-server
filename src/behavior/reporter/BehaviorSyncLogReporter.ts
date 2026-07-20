import { google } from "googleapis";
import * as fs from "node:fs";
import { toUtc8 } from "../utils";
import type { SheetsClient } from "./BehaviorSheetsReporter";

/** Backtest path recorded on each sync-log row. */
export type BehaviorSyncLogMode = "incremental" | "full" | "up_to_date";

/** One append-only audit row for the BEHAVIOR-SYNC-LOG tab. */
export type BehaviorSyncLogEntry = Readonly<{
  /** Run mode for this job invocation. */
  mode: BehaviorSyncLogMode;
  /** Number of raw behavior rows written this run (0 for up_to_date heal). */
  rowsWritten: number;
  /** Whether BEHAVIOR-OVERVIEW-DASHBOARD was recomputed. */
  dashboardRefreshed: boolean;
  /** Last raw sheet date as dd/mm/yyyy, or "" if unknown. */
  lastRawDate: string;
  /** Total data rows on the raw behavior tab after this run. */
  rawRowCount: number;
  /** Short human-readable status for Darren's cross-check. */
  notes: string;
}>;

export type BehaviorSyncLogReporterOptions = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  /** Default: "BEHAVIOR-SYNC-LOG" */
  tabName: string;
}>;

/** Sync-log columns A–G. */
const SYNC_LOG_HEADER: readonly string[] = [
  "Ran At (GMT+8)",
  "Mode",
  "Rows Written",
  "Dashboard Refreshed",
  "Last Raw Date",
  "Raw Row Count",
  "Notes",
];

/**
 * Append-only run audit tab so operators can see when the nightly backtest last
 * succeeded and whether the overview dashboard was refreshed.
 */
export class BehaviorSyncLogReporter {
  private readonly options: BehaviorSyncLogReporterOptions;
  private readonly sheetsClient: SheetsClient;

  constructor(options: BehaviorSyncLogReporterOptions) {
    this.options = options;

    if (!fs.existsSync(this.options.serviceAccountKeyPath)) {
      throw new Error(`Google service account key not found: ${this.options.serviceAccountKeyPath}`);
    }

    this.sheetsClient = google.sheets({
      version: "v4",
      auth: new google.auth.GoogleAuth({
        keyFile: this.options.serviceAccountKeyPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      }),
    }) as unknown as SheetsClient;
  }

  /** Reads GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, BEHAVIOR_SYNC_LOG_TAB from env. */
  static fromEnv(): BehaviorSyncLogReporter {
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const tabName = process.env.BEHAVIOR_SYNC_LOG_TAB ?? "BEHAVIOR-SYNC-LOG";

    if (!sheetId || !serviceAccountKeyPath) {
      throw new Error("GOOGLE_SHEETS_ID or GOOGLE_SERVICE_ACCOUNT_KEY missing from env");
    }

    return new BehaviorSyncLogReporter({ sheetId, serviceAccountKeyPath, tabName });
  }

  /** Creates the tab with a frozen header if it does not exist yet. */
  async ensureTab(): Promise<void> {
    try {
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.options.sheetId,
      });

      const existing =
        response.data.sheets?.map((sheet) => sheet.properties?.title ?? "") ?? [];

      if (!existing.includes(this.options.tabName)) {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.options.sheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.options.tabName,
                    gridProperties: { frozenRowCount: 1 },
                  },
                },
              },
            ],
          },
        });

        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.options.sheetId,
          range: `${this.options.tabName}!A1:G1`,
          valueInputOption: "RAW",
          requestBody: { values: [SYNC_LOG_HEADER as string[]] },
        });
      } else {
        // Ensure header exists even if the tab was created empty by a human.
        const headerRes = await this.sheetsClient.spreadsheets.values.get({
          spreadsheetId: this.options.sheetId,
          range: `${this.options.tabName}!A1:G1`,
        });
        const headerRow = headerRes.data.values?.[0];
        const headerEmpty =
          headerRow === undefined ||
          headerRow.every((cell) => typeof cell !== "string" || cell.trim().length === 0);
        if (headerEmpty) {
          await this.sheetsClient.spreadsheets.values.update({
            spreadsheetId: this.options.sheetId,
            range: `${this.options.tabName}!A1:G1`,
            valueInputOption: "RAW",
            requestBody: { values: [SYNC_LOG_HEADER as string[]] },
          });
        }
      }
    } catch (error) {
      console.error(
        "[BehaviorSyncLogReporter] ensureTab error:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Appends one audit row at the true bottom of the tab via values.update
   * (not values.append — avoids Sheets table-detection mid-sheet inserts).
   */
  async appendRow(entry: BehaviorSyncLogEntry): Promise<void> {
    try {
      await this.ensureTab();
      const nextRow = await this.readNextDataRowNumber();
      const ranAt = toUtc8(Date.now()).toFormat("dd/MM/yyyy HH:mm:ss");
      const values: string[] = [
        ranAt,
        entry.mode,
        String(entry.rowsWritten),
        entry.dashboardRefreshed ? "YES" : "NO",
        entry.lastRawDate,
        String(entry.rawRowCount),
        entry.notes,
      ];

      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A${nextRow}:G${nextRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [values] },
      });

      console.log(
        `[BehaviorSyncLogReporter] Logged ${entry.mode} run at row ${nextRow} (${ranAt} GMT+8).`
      );
    } catch (error) {
      console.error(
        "[BehaviorSyncLogReporter] appendRow error:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Returns the 1-based sheet row where the next data row should be written.
   * Row 1 is the header; data starts at row 2.
   */
  private async readNextDataRowNumber(): Promise<number> {
    const response = await this.sheetsClient.spreadsheets.values.get({
      spreadsheetId: this.options.sheetId,
      range: `${this.options.tabName}!A2:A`,
      majorDimension: "COLUMNS",
    });
    const col = response.data.values?.[0];
    if (col === undefined || col.length === 0) {
      return 2;
    }
    let lastIndex = -1;
    for (let i = col.length - 1; i >= 0; i--) {
      const v = col[i];
      if (typeof v === "string" && v.trim().length > 0) {
        lastIndex = i;
        break;
      }
    }
    if (lastIndex < 0) {
      return 2;
    }
    return lastIndex + 3; // A2 is index 0 → sheet row 2; next = lastIndex + 3
  }
}
