import fs from "node:fs";
import path from "node:path";

import type { ParsedCliArgs } from "./cliTypes";
import { parseSinceDuration, parseTimestamp, resolveBotPaths, sleep } from "./cliUtils";

/**
 * Run the logs command to print or follow bot logs.
 */
export async function runLogs(args: ParsedCliArgs): Promise<void> {
  // Step 1: Validate required args and parse options.
  const botId = args.flags["bot-id"] ?? args.positionals[0];
  if (botId === undefined) {
    throw new Error("Missing bot id. Usage: bot logs <bot-id> [options]");
  }

  const levelFilter = args.flags["level"]?.toUpperCase();
  const tail = parseTail(args.flags["tail"], 100);
  const follow = args.booleanFlags["follow"] === true;
  const since = resolveSince(args.flags["since"]);

  // Step 2: Resolve log files and print initial tail.
  const files = resolveLogFiles(botId);
  if (files.length === 0) {
    console.log(`No logs found for bot ${botId}.`);
    return;
  }

  const lines = readTailLines(files, tail, levelFilter, since);
  for (const line of lines) {
    console.log(line);
  }

  // Step 3: Exit early unless follow mode is enabled.
  if (!follow) {
    return;
  }

  // Step 4: Stream new log lines for follow mode.
  await followLogs(files, levelFilter, since);
}

/**
 * Parse the tail option into a positive integer.
 */
function parseTail(value: string | undefined, fallback: number): number {
  // Step 1: Return fallback when undefined.
  if (value === undefined) {
    return fallback;
  }
  // Step 2: Parse and validate numeric value.
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --tail value "${value}".`);
  }
  return Math.floor(parsed);
}

/**
 * Resolve a --since value into a timestamp.
 */
function resolveSince(value: string | undefined): number | null {
  // Step 1: Return null when no since filter provided.
  if (value === undefined) {
    return null;
  }
  // Step 2: Attempt duration parsing, fallback to timestamp parsing.
  const duration = parseSinceDuration(value);
  if (duration !== null) {
    return duration;
  }
  const parsed = parseTimestamp(value);
  if (parsed !== null) {
    return parsed;
  }
  throw new Error(`Invalid --since value "${value}".`);
}

/**
 * Resolve log file paths for a given bot id.
 */
function resolveLogFiles(botId: string): string[] {
  // Step 1: Scan the log directory for bot-specific files.
  const paths = resolveBotPaths();
  const entries = fs.readdirSync(paths.logDir);
  const files = entries
    .filter((entry) => entry.startsWith(`bot-${botId}-`) && entry.endsWith(".log"))
    .map((entry) => path.join(paths.logDir, entry))
    .sort();
  return files;
}

/**
 * Read last N lines across log files with optional filters.
 */
function readTailLines(
  files: readonly string[],
  tail: number,
  levelFilter: string | undefined,
  since: number | null
): string[] {
  // Step 1: Read and filter all lines across log files.
  const lines: string[] = [];
  for (const filePath of files) {
    const fileLines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of fileLines) {
      if (line.trim().length === 0) {
        continue;
      }
      if (!matchesFilters(line, levelFilter, since)) {
        continue;
      }
      lines.push(line);
    }
  }

  // Step 2: Return only the last N lines when needed.
  if (lines.length <= tail) {
    return lines;
  }
  return lines.slice(lines.length - tail);
}

/**
 * Follow the latest log file and stream new entries.
 */
async function followLogs(
  files: readonly string[],
  levelFilter: string | undefined,
  since: number | null
): Promise<void> {
  // Step 1: Track the latest log file and file offset.
  let currentFile = files[files.length - 1] ?? null;
  let offset = 0;

  while (true) {
    // Step 2: Detect file rotation and update current file.
    const latestFiles = resolveLogFilesFromCurrent(currentFile);
    const latestFile = latestFiles[latestFiles.length - 1] ?? currentFile;
    if (latestFile !== null && latestFile !== currentFile) {
      currentFile = latestFile;
      offset = 0;
    }

    // Step 3: Read and print newly appended lines.
    if (currentFile !== null && fs.existsSync(currentFile)) {
      const stats = fs.statSync(currentFile);
      if (stats.size > offset) {
        const stream = fs.createReadStream(currentFile, {
          encoding: "utf8",
          start: offset,
          end: stats.size
        });
        const chunk = await readStream(stream);
        offset = stats.size;
        const newLines = chunk.split(/\r?\n/).filter((line) => line.trim().length > 0);
        for (const line of newLines) {
          if (!matchesFilters(line, levelFilter, since)) {
            continue;
          }
          console.log(line);
        }
      }
    }

    // Step 4: Sleep between polling iterations.
    await sleep(2_000);
  }
}

/**
 * Resolve log files in the same directory as the current file.
 */
function resolveLogFilesFromCurrent(currentFile: string | null): string[] {
  // Step 1: Resolve log directory from the current file path.
  if (currentFile === null) {
    return [];
  }
  const logDir = path.dirname(currentFile);
  const currentName = path.basename(currentFile);
  const match = /^bot-(.+)-\d{4}-\d{2}-\d{2}\.log$/.exec(currentName);
  if (match === null) {
    return [currentFile];
  }
  const botId = match[1];
  if (botId === undefined) {
    return [currentFile];
  }
  const entries = fs.readdirSync(logDir);
  return entries
    .filter((entry) => entry.startsWith(`bot-${botId}-`) && entry.endsWith(".log"))
    .map((entry) => path.join(logDir, entry))
    .sort();
}

/**
 * Check whether a log line matches filter criteria.
 */
function matchesFilters(line: string, levelFilter: string | undefined, since: number | null): boolean {
  // Step 1: Apply level filter when provided.
  if (levelFilter !== undefined && !line.includes(` ${levelFilter} `)) {
    return false;
  }
  // Step 2: Apply since filter when provided.
  if (since === null) {
    return true;
  }
  const timestamp = extractTimestamp(line);
  return timestamp === null ? true : timestamp >= since;
}

/**
 * Extract a timestamp from a log line if possible.
 */
function extractTimestamp(line: string): number | null {
  // Step 1: Extract timestamp from the log line prefix.
  const match = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/.exec(line);
  if (match === null) {
    return null;
  }
  const datePart = match[1];
  const timePart = match[2];
  if (datePart === undefined || timePart === undefined) {
    return null;
  }
  const timestamp = Date.parse(`${datePart}T${timePart}`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Read a stream into a string.
 */
async function readStream(stream: fs.ReadStream): Promise<string> {
  // Step 1: Accumulate all chunks into a string payload.
  const chunks: string[] = [];
  for await (const chunk of stream) {
    const value = typeof chunk === "string" ? chunk : chunk.toString();
    chunks.push(value);
  }
  return chunks.join("");
}
