#!/usr/bin/env node
/**
 * Bulk import optimization results from JSON Lines file to database.
 * 
 * Usage:
 *   npm run import-results -- path/to/results.jsonl
 * 
 * This script reads the results file line by line and performs bulk database updates.
 * Much faster than individual updates during optimization runs.
 */

// Load environment variables from .env file
import "dotenv/config";

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.js";

type OptimizationResult = Readonly<{
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

async function importResults(filePath: string): Promise<void> {
  console.log(`[Import] Reading results from: ${filePath}`);
  
  // Read the entire file
  const fileContent = await readFile(filePath, "utf-8");
  const lines = fileContent.trim().split("\n");
  
  console.log(`[Import] Found ${lines.length} results to import`);
  
  // Parse all results
  const results: OptimizationResult[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const result = JSON.parse(line) as OptimizationResult;
      results.push(result);
    } catch (err) {
      console.error(`[Import] Failed to parse line: ${line.substring(0, 100)}`);
    }
  }
  
  console.log(`[Import] Parsed ${results.length} valid results`);
  
  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }
  
  const supabase = createClient<Database>(supabaseUrl, supabaseKey);
  
  // Bulk update in chunks to avoid timeouts
  const CHUNK_SIZE = 100;
  let completedCount = 0;
  let failedCount = 0;
  
  for (let i = 0; i < results.length; i += CHUNK_SIZE) {
    const chunk = results.slice(i, i + CHUNK_SIZE);
    
    // Process chunk in parallel
    const updatePromises = chunk.map(async (result) => {
      try {
        if (result.status === "completed") {
          const updateData = {
            status: "completed" as const,
            final_equity: result.finalEquity,
            total_return_pct: result.totalReturnPct,
            max_drawdown_pct: result.maxDrawdownPct,
            win_rate_pct: result.winRatePct,
            profit_factor: result.profitFactor,
            trade_count: result.tradeCount,
            data_fingerprint: result.dataFingerprint,
            error_message: null
          };
          
          const { error } = await supabase
            .from("backtest_runs")
            .update(updateData)
            .eq("id", result.runId);
          
          if (error) throw error;
          completedCount++;
        } else {
          // Failed run
          const { error } = await supabase
            .from("backtest_runs")
            .update({
              status: "failed" as const,
              error_message: result.errorMessage ?? "Unknown error"
            })
            .eq("id", result.runId);
          
          if (error) throw error;
          failedCount++;
        }
      } catch (err) {
        console.error(`[Import] Failed to update run ${result.runId}:`, err);
      }
    });
    
    await Promise.all(updatePromises);
    
    // Progress update
    const processed = Math.min(i + CHUNK_SIZE, results.length);
    console.log(`[Import] Progress: ${processed}/${results.length} (${Math.round((processed / results.length) * 100)}%)`);
  }
  
  console.log(`[Import] ✅ Import complete!`);
  console.log(`[Import]    Completed: ${completedCount}`);
  console.log(`[Import]    Failed: ${failedCount}`);
  console.log(`[Import]    Total: ${completedCount + failedCount}`);
}

// Main execution
const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run import-results -- path/to/results.jsonl");
  process.exit(1);
}

importResults(filePath)
  .then(() => {
    console.log("[Import] Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Import] Fatal error:", err);
    process.exit(1);
  });


