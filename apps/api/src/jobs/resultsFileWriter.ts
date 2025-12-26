import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Optimization results that will be bulk imported later.
 */
export type OptimizationResult = Readonly<{
  runId: string;
  status: "completed" | "failed";
  finalEquity?: number;
  totalReturnPct?: number;
  maxDrawdownPct?: number;
  winRatePct?: number;
  profitFactor?: number;
  tradeCount?: number;
  dataFingerprint?: Record<string, unknown>;
  errorMessage?: string;
}>;

/**
 * Appends optimization results to a JSON Lines file for bulk import.
 * 
 * Why JSON Lines?
 * - Append-only (no file locking needed)
 * - Each line is a complete JSON object
 * - Easy to parse and import in chunks
 * - Can resume if interrupted
 */
export class ResultsFileWriter {
  private readonly filePath: string;
  private writeCount = 0;

  public constructor(sessionId: string) {
    const resultsDir = join(process.cwd(), "optimization-results");
    this.filePath = join(resultsDir, `results-${sessionId}.jsonl`);
    
    // Create directory if it doesn't exist (async, but we don't await here)
    void mkdir(resultsDir, { recursive: true });
  }

  /**
   * Appends a result to the JSON Lines file.
   * Non-blocking and thread-safe (append-only).
   */
  public async writeResult(result: OptimizationResult): Promise<void> {
    const line = JSON.stringify(result) + "\n";
    await appendFile(this.filePath, line, "utf-8");
    this.writeCount++;
    
    // Log progress every 100 results
    if (this.writeCount % 100 === 0) {
      console.log(`[ResultsFileWriter] Written ${this.writeCount} results to ${this.filePath}`);
    }
  }

  /**
   * Gets the file path for the results file.
   */
  public getFilePath(): string {
    return this.filePath;
  }

  /**
   * Gets the total number of results written.
   */
  public getWriteCount(): number {
    return this.writeCount;
  }
}


