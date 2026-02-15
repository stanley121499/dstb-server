#!/usr/bin/env node
/**
 * @file JSONL → CSV converter for optimization results.
 *
 * Purpose:
 * - Convert `optimization-results/results-*.jsonl` into a CSV that imports cleanly into Google Sheets.
 *
 * Usage (from apps/api):
 *   node scripts/jsonl-to-csv.js optimization-results/results-2025-12-25T08-59-35-981Z.jsonl > results.csv
 *
 * Output columns:
 *   runId, symbol, interval, finalEquity, totalReturnPct, maxDrawdownPct, winRatePct, profitFactor, tradeCount,
 *   openingRangeMinutes, breakoutBufferBps, directionMode, riskPctPerTrade, atrStopMultiple, tpRMultiple, atrTrailMultiple
 *
 * Notes:
 * - The JSONL file is append-only; each line is one JSON object.
 * - We tolerate blank lines and parse failures (they are skipped with a warning).
 */

import { readFile } from "node:fs/promises";

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  // Escape if it contains comma, quote, or newline.
  if (/[",\r\n]/.test(str)) {
    return `"${str.replaceAll("\"", "\"\"")}"`;
  }
  return str;
}

function pickSymbolAndInterval(resultObj) {
  // First try top-level fields (batch results format)
  if (resultObj && typeof resultObj === "object") {
    if (typeof resultObj.symbol === "string" && typeof resultObj.interval === "string") {
      return { symbol: resultObj.symbol, interval: resultObj.interval };
    }
  }
  
  // Fallback to dataFingerprint.data (old format compatibility)
  const df = resultObj && typeof resultObj === "object" ? resultObj.dataFingerprint : null;
  if (!df || typeof df !== "object") {
    return { symbol: "", interval: "" };
  }

  const data = df.data && typeof df.data === "object" ? df.data : null;
  const symbol = data && typeof data.symbol === "string" ? data.symbol : "";
  const interval = data && typeof data.interval === "string" ? data.interval : "";
  return { symbol, interval };
}

function pickFlattenedParams(resultObj) {
  const p = resultObj && typeof resultObj === "object" ? resultObj.params : null;
  if (!p || typeof p !== "object") {
    return {
      openingRangeMinutes: "",
      breakoutBufferBps: "",
      directionMode: "",
      riskPctPerTrade: "",
      atrStopMultiple: "",
      tpRMultiple: "",
      atrTrailMultiple: ""
    };
  }

  const session = p.session && typeof p.session === "object" ? p.session : null;
  const entry = p.entry && typeof p.entry === "object" ? p.entry : null;
  const risk = p.risk && typeof p.risk === "object" ? p.risk : null;

  const openingRangeMinutes =
    session && typeof session.openingRangeMinutes === "number" ? session.openingRangeMinutes : "";
  const breakoutBufferBps = entry && typeof entry.breakoutBufferBps === "number" ? entry.breakoutBufferBps : "";
  const directionMode = entry && typeof entry.directionMode === "string" ? entry.directionMode : "";
  const riskPctPerTrade = risk && typeof risk.riskPctPerTrade === "number" ? risk.riskPctPerTrade : "";
  const atrStopMultiple = risk && typeof risk.atrStopMultiple === "number" ? risk.atrStopMultiple : "";
  const tpRMultiple = risk && typeof risk.tpRMultiple === "number" ? risk.tpRMultiple : "";
  const atrTrailMultiple = risk && typeof risk.atrTrailMultiple === "number" ? risk.atrTrailMultiple : "";

  return {
    openingRangeMinutes,
    breakoutBufferBps,
    directionMode,
    riskPctPerTrade,
    atrStopMultiple,
    tpRMultiple,
    atrTrailMultiple
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/jsonl-to-csv.js optimization-results/results-*.jsonl > results.csv");
    process.exitCode = 1;
    return;
  }

  const fileContent = await readFile(filePath, "utf-8");
  const lines = fileContent.split("\n");

  const header = [
    "runId",
    "symbol",
    "interval",
    "finalEquity",
    "totalReturnPct",
    "maxDrawdownPct",
    "winRatePct",
    "profitFactor",
    "tradeCount",
    "openingRangeMinutes",
    "breakoutBufferBps",
    "directionMode",
    "riskPctPerTrade",
    "atrStopMultiple",
    "tpRMultiple",
    "atrTrailMultiple"
  ];
  process.stdout.write(`${header.join(",")}\n`);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: skipping invalid JSONL line (${msg}): ${trimmed.slice(0, 120)}`);
      continue;
    }

    const runId = obj && typeof obj.runId === "string" ? obj.runId : "";
    const { symbol, interval } = pickSymbolAndInterval(obj);
    const flat = pickFlattenedParams(obj);

    const finalEquity = obj && typeof obj.finalEquity === "number" ? obj.finalEquity : "";
    const totalReturnPct = obj && typeof obj.totalReturnPct === "number" ? obj.totalReturnPct : "";
    const maxDrawdownPct = obj && typeof obj.maxDrawdownPct === "number" ? obj.maxDrawdownPct : "";
    const winRatePct = obj && typeof obj.winRatePct === "number" ? obj.winRatePct : "";
    const profitFactor = obj && typeof obj.profitFactor === "number" ? obj.profitFactor : "";
    const tradeCount = obj && typeof obj.tradeCount === "number" ? obj.tradeCount : "";

    const row = [
      runId,
      symbol,
      interval,
      finalEquity,
      totalReturnPct,
      maxDrawdownPct,
      winRatePct,
      profitFactor,
      tradeCount,
      flat.openingRangeMinutes,
      flat.breakoutBufferBps,
      flat.directionMode,
      flat.riskPctPerTrade,
      flat.atrStopMultiple,
      flat.tpRMultiple,
      flat.atrTrailMultiple
    ].map(csvEscape);

    process.stdout.write(`${row.join(",")}\n`);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`Fatal: ${message}`);
  if (stack) {
    console.error(stack);
  }
  process.exitCode = 1;
});

