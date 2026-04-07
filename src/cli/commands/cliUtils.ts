import fs from "node:fs";
import path from "node:path";

import { Logger } from "../../core/Logger.js";
import { SupabaseStateStore } from "../../core/SupabaseStateStore.js";
import type { RawCliArgs } from "./cliTypes.js";

/**
 * Daemon registry record persisted to disk.
 */
export type DaemonRecord = Readonly<{
  botId: string;
  pid: number;
  startedAt: string;
  configPath: string;
}>;

/**
 * Supported date units for duration parsing.
 */
const durationUnitMs: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000
};

/**
 * Resolve the project root based on the current working directory.
 */
export function resolveProjectRoot(): string {
  return process.cwd();
}

/**
 * Resolve key filesystem paths for bot state and logs.
 */
export function resolveBotPaths(): Readonly<{
  dataDir: string;
  logDir: string;
  daemonDir: string;
}> {
  // Step 1: Resolve base directories from project root.
  const root = resolveProjectRoot();
  const dataDir = path.join(root, "data");
  const logDir = path.join(root, "logs");
  const daemonDir = path.join(dataDir, "daemon");

  return {
    dataDir,
    logDir,
    daemonDir
  };
}

/**
 * Create a Supabase-backed state store (requires SUPABASE_* env vars).
 */
export function createStateManager(loggerId: string): SupabaseStateStore {
  const paths = resolveBotPaths();
  ensureDirectory(paths.dataDir);
  ensureDirectory(paths.logDir);
  const logger = new Logger(loggerId, paths.logDir);
  return SupabaseStateStore.fromEnv(logger);
}

/**
 * Create a bot-specific logger instance.
 */
export function createBotLogger(botId: string): Logger {
  const paths = resolveBotPaths();
  ensureDirectory(paths.logDir);
  return new Logger(botId, paths.logDir);
}

/**
 * Parse argv tokens into flags, boolean flags, and positional args.
 */
export function parseArgv(argv: readonly string[], booleanFlagNames: readonly string[]): RawCliArgs {
  // Step 1: Initialize collectors and boolean lookup.
  const flags: Record<string, string> = {};
  const booleanFlags: Record<string, boolean> = {};
  const positionals: string[] = [];
  const booleanSet = new Set(booleanFlagNames);

  // Step 2: Walk argv tokens and categorize them.
  let command: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) {
      i += 1;
      continue;
    }

    if (token === "--") {
      // Step 2a: Treat remaining tokens as positionals.
      const rest = argv.slice(i + 1).filter((value) => value !== undefined) as string[];
      positionals.push(...rest);
      break;
    }

    if (token.startsWith("--")) {
      // Step 2b: Parse flags and boolean switches.
      const flagToken = token.slice(2);
      const [rawKey, rawValue] = splitFlagToken(flagToken);
      const key = rawKey.trim();
      if (key.length === 0) {
        throw new Error(`Invalid flag "${token}".`);
      }

      if (booleanSet.has(key)) {
        const parsed = rawValue === undefined ? true : parseBooleanValue(rawValue);
        booleanFlags[key] = parsed;
        i += 1;
        continue;
      }

      if (rawValue !== undefined) {
        flags[key] = rawValue;
        i += 1;
        continue;
      }

      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for flag "--${key}".`);
      }
      flags[key] = next;
      i += 2;
      continue;
    }

    if (command === null) {
      // Step 2c: Capture the command token.
      command = token;
      i += 1;
      continue;
    }

    // Step 2d: Capture positional arguments.
    positionals.push(token);
    i += 1;
  }

  return {
    command,
    flags,
    booleanFlags,
    positionals
  };
}

/**
 * Parse a boolean value from a string.
 */
export function parseBooleanValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`Expected a boolean value (true/false), received "${value}".`);
}

/**
 * Validate a non-empty string input.
 */
export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

/**
 * Validate a positive integer input.
 */
export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

/**
 * Determine whether an unknown value is a plain record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read and parse a JSON file.
 */
export function readJsonFile(pathValue: string): unknown {
  // Step 1: Resolve the absolute path and read the file.
  const absolutePath = path.resolve(resolveProjectRoot(), pathValue);
  const raw = fs.readFileSync(absolutePath, "utf8");
  // Step 2: Parse JSON into an unknown payload.
  return JSON.parse(raw) as unknown;
}

/**
 * Try to read a JSON file, returning null when missing.
 */
export function tryReadJsonFile(pathValue: string): unknown | null {
  // Step 1: Resolve the path and return null when missing.
  const absolutePath = path.resolve(resolveProjectRoot(), pathValue);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  // Step 2: Parse JSON payload when present.
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as unknown;
}

/**
 * Write a JSON file with pretty formatting.
 */
export function writeJsonFile(pathValue: string, payload: unknown): void {
  // Step 1: Resolve output path and ensure directory exists.
  const absolutePath = path.resolve(resolveProjectRoot(), pathValue);
  const directory = path.dirname(absolutePath);
  ensureDirectory(directory);
  // Step 2: Serialize JSON with stable formatting.
  fs.writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Ensure a directory exists.
 */
export function ensureDirectory(directoryPath: string): void {
  // Step 1: Create the directory when missing.
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

/**
 * Format a number with fixed decimals, returning "n/a" on invalid input.
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  // Step 1: Return "n/a" for missing or invalid numbers.
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  // Step 2: Render the number with fixed decimals.
  return value.toFixed(decimals);
}

/**
 * Format a table with headers and rows for console output.
 */
export function formatTable(headers: readonly string[], rows: readonly string[][]): string {
  // Step 1: Calculate column widths from headers and rows.
  const widths = headers.map((header, idx) => {
    const maxCell = rows.reduce((max, row) => Math.max(max, row[idx]?.length ?? 0), 0);
    return Math.max(header.length, maxCell);
  });

  // Step 2: Render header, separator, and row lines.
  const headerLine = headers
    .map((header, idx) => padRight(header, widths[idx] ?? header.length))
    .join(" | ");
  const separator = widths.map((width) => "-".repeat(width)).join("-|-");
  const rowLines = rows.map((row) =>
    row.map((cell, idx) => padRight(cell, widths[idx] ?? cell.length)).join(" | ")
  );

  return [headerLine, separator, ...rowLines].join("\n");
}

/**
 * Parse a duration string like "30m", "2h", "1d" into a timestamp cutoff.
 */
export function parseSinceDuration(value: string): number | null {
  // Step 1: Match a supported duration pattern.
  const trimmed = value.trim();
  const match = /^(\d+)([mhd])$/.exec(trimmed);
  if (match === null) {
    return null;
  }
  // Step 2: Convert to milliseconds using unit map.
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit !== undefined ? durationUnitMs[unit] : undefined;
  if (!Number.isFinite(amount) || multiplier === undefined) {
    return null;
  }
  return Date.now() - amount * multiplier;
}

/**
 * Parse a timestamp string into epoch milliseconds.
 */
export function parseTimestamp(value: string): number | null {
  // Step 1: Parse as a date string and validate.
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convert a Date to YYYY-MM-DD in local time.
 */
export function toLocalDateString(date: Date): string {
  // Step 1: Format date components using local time.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolve the CLI entry path for spawning daemon processes.
 */
export function resolveCliEntryPath(): string {
  return path.resolve(resolveProjectRoot(), "src", "cli", "index.ts");
}

/**
 * Resolve the daemon registry path for a bot id.
 */
export function resolveDaemonRecordPath(botId: string): string {
  // Step 1: Build the daemon record path for a bot id.
  const paths = resolveBotPaths();
  ensureDirectory(paths.daemonDir);
  return path.join(paths.daemonDir, `bot-${botId}.json`);
}

/**
 * Write a daemon registry record to disk.
 */
export function writeDaemonRecord(record: DaemonRecord): void {
  // Step 1: Write the daemon record JSON to disk.
  const recordPath = resolveDaemonRecordPath(record.botId);
  writeJsonFile(recordPath, record);
}

/**
 * Read a daemon registry record from disk.
 */
export function readDaemonRecord(botId: string): DaemonRecord | null {
  // Step 1: Load raw JSON and validate required fields.
  const recordPath = resolveDaemonRecordPath(botId);
  const raw = tryReadJsonFile(recordPath);
  if (!isRecord(raw)) {
    return null;
  }
  const pid = typeof raw.pid === "number" ? raw.pid : Number.NaN;
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : "";
  const configPath = typeof raw.configPath === "string" ? raw.configPath : "";
  if (!Number.isFinite(pid) || startedAt.length === 0 || configPath.length === 0) {
    return null;
  }
  return {
    botId,
    pid,
    startedAt,
    configPath
  };
}

/**
 * List all daemon registry records on disk.
 */
export function listDaemonRecords(): DaemonRecord[] {
  // Step 1: Scan daemon registry directory for records.
  const paths = resolveBotPaths();
  ensureDirectory(paths.daemonDir);
  const entries = fs.readdirSync(paths.daemonDir);
  const records: DaemonRecord[] = [];

  // Step 2: Parse record files into daemon records.
  for (const entry of entries) {
    if (!entry.startsWith("bot-") || !entry.endsWith(".json")) {
      continue;
    }
    const botId = entry.slice("bot-".length, entry.length - ".json".length);
    const record = readDaemonRecord(botId);
    if (record !== null) {
      records.push(record);
    }
  }

  return records;
}

/**
 * Remove a daemon registry record from disk.
 */
export function removeDaemonRecord(botId: string): void {
  // Step 1: Delete the daemon record file if it exists.
  const recordPath = resolveDaemonRecordPath(botId);
  if (fs.existsSync(recordPath)) {
    fs.unlinkSync(recordPath);
  }
}

/**
 * Sleep helper for async polling.
 */
export async function sleep(durationMs: number): Promise<void> {
  // Step 1: Resolve after a timeout for polling loops.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

/**
 * Determine whether a process id appears to be alive.
 */
export function isProcessAlive(pid: number): boolean {
  // Step 1: Validate pid value before probing.
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    // Step 2: Signal 0 checks for existence without killing.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Step 3: Treat ESRCH as not alive, other errors as potentially alive.
    const message = error instanceof Error ? error.message : String(error);
    return !message.includes("ESRCH");
  }
}

/**
 * Split a flag token into key/value when using "--key=value" format.
 */
function splitFlagToken(token: string): [string, string | undefined] {
  const index = token.indexOf("=");
  if (index === -1) {
    return [token, undefined];
  }
  const key = token.slice(0, index);
  const value = token.slice(index + 1);
  return [key, value];
}

/**
 * Pad a string to the right with spaces.
 */
function padRight(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, " ");
}
