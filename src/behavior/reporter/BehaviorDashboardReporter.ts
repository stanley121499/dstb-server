import { google } from "googleapis";
import * as fs from "node:fs";
import type { BehaviorRow } from "../types";
import type { SheetsClient } from "./BehaviorSheetsReporter";

// ============================================================================
// Types
// ============================================================================

/** One aggregated row in the BEHAVIOR-OVERVIEW-DASHBOARD tab. */
type DashboardCluster = {
  /** e.g. "PDH" or "PDL" */
  previousDayLevel: string;
  /** e.g. "AR_SINGLE_H — AR High touched only" */
  asiaRange: string;
  /** e.g. "ASIA_TP_H1 — TP Zone 1st Half 11:00:00 – 12:29:59" */
  firstInteractionSession: string;
  /** e.g. "STD" | "DST" | "C/R" | "N/A" */
  sessionTimeMode: string;
  /** e.g. "TOUCH_REJECT" */
  twoCandleBehavior: string;
  /** Number of rows matching this exact environment combination */
  totalCount: number;
  /** e.g. "REJECTION (75%)" — most frequent resolved decision output + % */
  decisionBias: string;
  /** Numeric percentage extracted from decisionBias (for scoring / sorting) */
  decisionBiasPercent: number;
  /** e.g. "MEAN-REVERSION (75%)" — most frequent outcome direction + % */
  outcomeBias: string;
  /** Numeric percentage extracted from outcomeBias (for scoring / sorting) */
  outcomeBiasPercent: number;
  /** Average raw MoveScore across the cluster, formatted to 2 dp (e.g. "1.13") */
  avgMoveScore: string;
  /** Numeric avg MoveScore (for scoring / sorting without re-parsing the string) */
  avgMoveScoreNum: number;
  /**
   * Median MoveScore — the middle value of sorted cluster MoveScores.
   * Unlike avg, the median is not distorted by extreme outlier moves.
   * Odd count → exact middle; even count → avg of two middle values.
   * Formatted to 2 dp (e.g. "1.15").
   */
  medianMoveScore: string;
  /** Numeric median MoveScore (for display / stability calc) */
  medianMoveScoreNum: number;
  /**
   * Expansion Stability = ABS(Avg MoveScore − Median MoveScore).
   * Measures whether expansion is consistent or driven by outlier spikes.
   * Smaller value → more consistent; larger value → outlier-driven.
   * Formatted to 2 dp (e.g. "0.42").
   */
  expansionStability: string;
  /** Numeric expansion stability (for sort — ASC = more consistent) */
  expansionStabilityNum: number;
  /**
   * Environment Score = (2 × Bias Score) + MoveScore Score + Total Count Score.
   * Score range: 4 (minimum) to 12 (maximum).
   */
  envScore: number;
  /**
   * Environment Grade derived from envScore.
   *   11–12 → A  (Exceptional)
   *    9–10 → B  (Strong)
   *     7–8 → C  (Tradeable / borderline)
   *       6 → D  (Weak)
   *     4–5 → F  (No reliable edge)
   * Note: Grade is capped at C when Outcome Bias < 60% (Part 4 edge filter).
   */
  envGrade: string;
  /** Sequential rank after sorting (1 = highest priority environment) */
  rank: number;
};

export type BehaviorDashboardReporterOptions = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  /** Default: "BEHAVIOR-OVERVIEW-DASHBOARD" */
  tabName: string;
}>;

/**
 * Dashboard columns (A–N = 14 columns).
 * Order matches Darren's BEHAVIOR-ENVIRONMENT-OVERVIEW sheet spec.
 */
const DASHBOARD_HEADER: readonly string[] = [
  "Previous-Day Level",                        // A
  "Asia Range",                                // B
  "First Interaction Market Session Timing",   // C
  "First Interaction Market Session Time Mode",// D
  "Two-Candle First Interaction Behavior",     // E
  "Total Count",                               // F
  "Resolved Decision Output Bias",             // G
  "Resolved Outcome Direction Bias",           // H
  "Avg MoveScore",                             // I
  "Median MoveScore",                          // J  ← NEW
  "Expansion Stability",                       // K  ← NEW
  "Environment Score",                         // L
  "Environment Grade",                         // M
  "Rank",                                      // N
];

// ============================================================================
// BehaviorDashboardReporter
// ============================================================================

export class BehaviorDashboardReporter {
  private readonly options: BehaviorDashboardReporterOptions;
  private readonly sheetsClient: SheetsClient;

  constructor(options: BehaviorDashboardReporterOptions) {
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

  /** Reads GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, BEHAVIOR_DASHBOARD_TAB from env. */
  static fromEnv(): BehaviorDashboardReporter {
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const tabName = process.env.BEHAVIOR_DASHBOARD_TAB ?? "BEHAVIOR-OVERVIEW-DASHBOARD";

    if (!sheetId || !serviceAccountKeyPath) {
      throw new Error("GOOGLE_SHEETS_ID or GOOGLE_SERVICE_ACCOUNT_KEY missing from env");
    }

    return new BehaviorDashboardReporter({ sheetId, serviceAccountKeyPath, tabName });
  }

  // --------------------------------------------------------------------------
  // Environment Quality Scoring Helpers (per Darren's framework)
  // --------------------------------------------------------------------------

  /**
   * Directional Bias Score — based solely on Resolved Outcome Direction Bias.
   * Per Darren's framework: Directional Bias = Resolved Outcome Direction Bias.
   *   ≥70% → 3  |  60–69% → 2  |  <60% → 1
   */
  private scoreBias(outcomePct: number): number {
    if (outcomePct >= 70) return 3;
    if (outcomePct >= 60) return 2;
    return 1;
  }

  /**
   * MoveScore Score — expansion potential after the decision.
   *   ≥2.0 → 3  |  1.0–1.99 → 2  |  <1.0 → 1
   */
  private scoreMoveScore(avgMove: number): number {
    if (avgMove >= 2.0) return 3;
    if (avgMove >= 1.0) return 2;
    return 1;
  }

  /**
   * Total Count Score — statistical confidence.
   *   ≥15 → 3  |  10–14 → 2  |  <10 → 1
   */
  private scoreCount(count: number): number {
    if (count >= 15) return 3;
    if (count >= 10) return 2;
    return 1;
  }

  /**
   * Converts Environment Score (4–12) to a letter grade.
   * Formula: (2 × Bias Score) + MoveScore Score + Total Count Score
   *   11–12 → A  (Exceptional environment)
   *    9–10 → B  (Strong environment)
   *     7–8 → C  (Tradeable / borderline)
   *       6 → D  (Weak environment)
   *     4–5 → F  (No reliable edge)
   *
   * Part 4 — Directional Edge Filter (Darren's spec):
   *   If Outcome Bias < 60% → maximum grade is capped at C.
   */
  private scoreToGrade(score: number, outcomePct: number): string {
    let grade: string;
    if (score >= 11) grade = "A";
    else if (score >= 9)  grade = "B";
    else if (score >= 7)  grade = "C";
    else if (score === 6) grade = "D";
    else grade = "F";

    // Cap at C when outcome bias is below 60% — prevents high MoveScore
    // environments with low directional consistency from appearing as A or B.
    if (outcomePct < 60 && (grade === "A" || grade === "B")) {
      grade = "C";
    }

    return grade;
  }

  /**
   * Calculates the Median MoveScore from a sorted array of numeric values.
   *
   *   Odd  count → exact middle value                (e.g. 7 values → position 4)
   *   Even count → average of two middle values      (e.g. 8 values → avg of pos 4 & 5)
   *
   * Returns 0 for an empty array.
   */
  private computeMedian(sortedValues: readonly number[]): number {
    const n = sortedValues.length;
    if (n === 0) return 0;
    if (n % 2 === 1) {
      // Odd: pick the middle element
      return sortedValues[Math.floor(n / 2)] ?? 0;
    }
    // Even: average the two central elements
    const lo = sortedValues[(n / 2) - 1] ?? 0;
    const hi = sortedValues[n / 2] ?? 0;
    return (lo + hi) / 2;
  }

  /**
   * Computes cluster statistics from a set of BehaviorRows.
   * Filters out PD_NONE and NO_INTERACTION rows (not useful for pattern analysis).
   *
   * Grouping key: previousDayLevel | asiaRange | session | sessionTimeMode | behavior
   * (5 dimensions — sessionTimeMode separates STD vs DST regimes per Darren's requirement)
   *
   * Ranking (per Darren's Priority Ranking spec — Part 5):
   *   All environments sorted by envScore DESC, then within same score:
   *     1. Avg MoveScore DESC  (payoff potential)
   *     2. Outcome Bias % DESC (win probability)
   *     3. Total Count DESC    (statistical reliability)
   */
  computeDashboard(rows: readonly BehaviorRow[]): DashboardCluster[] {
    // Step 1: Filter to rows that have a real interaction
    const interactive = rows.filter(
      r => r.previousDayLevel !== "PD_NONE" && r.twoCandleBehavior !== "NO_INTERACTION"
    );

    // Step 2: Group by 5-part composite environment key
    // Key = "pdLevel|asiaRange|session|timeMode|behavior"
    const grouped = new Map<string, BehaviorRow[]>();
    for (const row of interactive) {
      const key = [
        row.previousDayLevel,
        row.asiaRange,
        row.firstInteractionSession,
        row.firstInteractionSessionTimeMode,
        row.twoCandleBehavior,
      ].join("|");
      const existing = grouped.get(key);
      if (existing !== undefined) {
        existing.push(row);
      } else {
        grouped.set(key, [row]);
      }
    }

    // Step 3: Compute statistics for each cluster
    const clusters: DashboardCluster[] = [];
    for (const [key, clusterRows] of grouped) {
      const parts = key.split("|");
      const totalCount = clusterRows.length;

      // --- Decision bias: dominant resolvedDecisionOutput + percentage ---
      const decisionCounts: Record<string, number> = {};
      for (const r of clusterRows) {
        decisionCounts[r.resolvedDecisionOutput] = (decisionCounts[r.resolvedDecisionOutput] ?? 0) + 1;
      }
      const dominantDecision = Object.entries(decisionCounts).sort((a, b) => b[1] - a[1])[0];
      const decisionBiasPercent = dominantDecision !== undefined
        ? Math.round((dominantDecision[1] / totalCount) * 100)
        : 0;
      const decisionBias = dominantDecision !== undefined
        ? `${dominantDecision[0]} (${decisionBiasPercent}%)`
        : "N/A";

      // --- Outcome bias: dominant resolvedOutcomeDirection + percentage ---
      const outcomeCounts: Record<string, number> = {};
      for (const r of clusterRows) {
        outcomeCounts[r.resolvedOutcomeDirection] = (outcomeCounts[r.resolvedOutcomeDirection] ?? 0) + 1;
      }
      const dominantOutcome = Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1])[0];
      const outcomeBiasPercent = dominantOutcome !== undefined
        ? Math.round((dominantOutcome[1] / totalCount) * 100)
        : 0;
      const outcomeBias = dominantOutcome !== undefined
        ? `${dominantOutcome[0]} (${outcomeBiasPercent}%)`
        : "N/A";

      // --- Avg MoveScore: strip "MS" suffix before parsing (e.g. "1.82MS" → 1.82, "0" → 0) ---
      const moveScores = clusterRows
        .map(r => parseFloat(r.moveScoreValue.replace("MS", "")))
        .filter(n => !isNaN(n));
      const avgMoveNum =
        moveScores.length > 0
          ? moveScores.reduce((sum, v) => sum + v, 0) / moveScores.length
          : 0;

      // --- Median MoveScore (per Darren's PDF calculation guide) ---
      // Sort ascending first, then apply odd/even middle-value rule.
      const sortedMoveScores = [...moveScores].sort((a, b) => a - b);
      const medianMoveNum = this.computeMedian(sortedMoveScores);

      // --- Expansion Stability = ABS(Avg − Median) ---
      // Absolute gap: small value → consistent expansion; large value → outlier-driven avg.
      const expansionStabilityNum = Math.abs(avgMoveNum - medianMoveNum);

      // --- Environment Score = (2 × Bias Score) + MoveScore Score + Total Count Score ---
      // Range: 4 (minimum) to 12 (maximum).
      // All environments receive a score and grade — no N/Q filtering.
      const envScore = (2 * this.scoreBias(outcomeBiasPercent))
        + this.scoreMoveScore(avgMoveNum)
        + this.scoreCount(totalCount);
      const envGrade = this.scoreToGrade(envScore, outcomeBiasPercent);

      clusters.push({
        previousDayLevel:        parts[0] ?? "",
        asiaRange:               parts[1] ?? "",
        firstInteractionSession: parts[2] ?? "",
        sessionTimeMode:         parts[3] ?? "",
        twoCandleBehavior:       parts[4] ?? "",
        totalCount,
        decisionBias,
        decisionBiasPercent,
        outcomeBias,
        outcomeBiasPercent,
        avgMoveScore:        avgMoveNum.toFixed(2),
        avgMoveScoreNum:     avgMoveNum,
        medianMoveScore:     medianMoveNum.toFixed(2),
        medianMoveScoreNum:  medianMoveNum,
        expansionStability:    expansionStabilityNum.toFixed(2),
        expansionStabilityNum: expansionStabilityNum,
        envScore,
        envGrade,
        rank: 0, // assigned after sorting in Step 5
      });
    }

    // Step 4: Sort
    //   Primary   — envScore DESC (highest grade group first)
    //   Within each envScore group, ranked by performance sequence:
    //     1. Median MoveScore DESC  (consistency-adjusted payoff)
    //     2. Expansion Stability ASC (smaller gap = more consistent)
    //     3. Avg MoveScore DESC     (raw expansion potential)
    //     4. Outcome Bias % DESC    (directional reliability)
    //     5. Total Count DESC       (statistical confidence)
    clusters.sort((a, b) => {
      // Primary: envScore group (A environments before B, etc.)
      if (b.envScore !== a.envScore) return b.envScore - a.envScore;

      // Within same envScore — performance-based sequence:

      // 1. Median MoveScore DESC
      if (b.medianMoveScoreNum !== a.medianMoveScoreNum) return b.medianMoveScoreNum - a.medianMoveScoreNum;

      // 2. Expansion Stability ASC (smaller gap = more consistent)
      if (a.expansionStabilityNum !== b.expansionStabilityNum) return a.expansionStabilityNum - b.expansionStabilityNum;

      // 3. Avg MoveScore DESC
      if (b.avgMoveScoreNum !== a.avgMoveScoreNum) return b.avgMoveScoreNum - a.avgMoveScoreNum;

      // 4. Outcome Bias % DESC
      if (b.outcomeBiasPercent !== a.outcomeBiasPercent) return b.outcomeBiasPercent - a.outcomeBiasPercent;

      // 5. Total Count DESC
      return b.totalCount - a.totalCount;
    });

    // Step 5: Assign rank — only clusters with totalCount ≥ 10 are eligible.
    // Ineligible clusters (count < 10) receive rank 0 (written as blank in the sheet).
    let rankCounter = 1;
    clusters.forEach(c => {
      if (c.totalCount >= 10) {
        c.rank = rankCounter++;
      } else {
        c.rank = 0; // 0 = ineligible, written as blank
      }
    });

    return clusters;
  }

  /** Ensures the dashboard tab exists with a frozen header row. */
  async ensureTab(): Promise<void> {
    try {
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.options.sheetId,
      });

      const existing =
        response.data.sheets?.map(sheet => sheet.properties?.title ?? "") ?? [];

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
      }
    } catch (error) {
      console.error(
        "[BehaviorDashboardReporter] ensureTab error:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Recomputes the full dashboard from a set of BehaviorRows and overwrites the sheet tab.
   * Call this after every backtest run or daily cycle finalisation.
   *
   * Sheet columns: A–N (14 columns total)
   */
  async write(rows: readonly BehaviorRow[]): Promise<void> {
    try {
      await this.ensureTab();

      // Clear the entire tab first (14 columns: A–N)
      await this.sheetsClient.spreadsheets.values.clear({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A:N`,
      });

      // Write header row
      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A1:N1`,
        valueInputOption: "RAW",
        requestBody: { values: [DASHBOARD_HEADER as string[]] },
      });

      // Compute clusters
      const clusters = this.computeDashboard(rows);
      if (clusters.length === 0) {
        console.log("[BehaviorDashboardReporter] No interactive clusters found — header only written.");
        return;
      }

      // Convert clusters to 2D array for the Sheets API (14 columns: A–N)
      const dataRows: string[][] = clusters.map(c => [
        c.previousDayLevel,           // A
        c.asiaRange,                  // B
        c.firstInteractionSession,    // C
        c.sessionTimeMode,            // D
        c.twoCandleBehavior,          // E
        c.totalCount.toString(),      // F
        c.decisionBias,               // G
        c.outcomeBias,                // H
        c.avgMoveScore,               // I
        c.medianMoveScore,            // J  ← NEW
        c.expansionStability,         // K  ← NEW
        c.envScore.toString(),        // L
        c.envGrade,                   // M
        c.rank > 0 ? c.rank.toString() : "",  // N — blank if ineligible (count < 10)
      ]);

      // Append all data rows in one call (clusters fit comfortably in a single request)
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.options.sheetId,
        range: `${this.options.tabName}!A2:N`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: dataRows },
      });

      console.log(
        `[BehaviorDashboardReporter] Dashboard written: ${clusters.length} clusters from ${rows.length} rows.`
      );
    } catch (error) {
      console.error(
        "[BehaviorDashboardReporter] write error:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}
