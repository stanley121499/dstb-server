import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Logger } from "../Logger";

/**
 * Format date for log filename.
 */
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

describe("Logger", () => {
  it("writes structured log lines to daily files", () => {
    // Freeze time for deterministic log output.
    vi.useFakeTimers();
    const now = new Date("2026-02-04T10:30:45");
    vi.setSystemTime(now);

    // Prepare a temporary log directory.
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-logs-"));
    const logger = new Logger("bot-abc123", logDir);

    // Write a log entry with structured context.
    logger.info("Trade executed", {
      side: "LONG",
      price: 45000,
      qty: 0.1,
      pnl: 234.5
    });

    // Read the log file and verify formatting.
    const logFile = path.join(logDir, `bot-bot-abc123-${formatDate(now)}.log`);
    const content = fs.readFileSync(logFile, "utf8");

    expect(content).toContain("[2026-02-04 10:30:45] INFO [bot-abc123] Trade executed");
    expect(content).toContain("side=LONG");
    expect(content).toContain("context=");

    vi.useRealTimers();
  });

  it("rotates logs by pruning files older than 30 days", () => {
    // Freeze time for predictable retention behavior.
    vi.useFakeTimers();
    const now = new Date("2026-02-04T10:30:45");
    vi.setSystemTime(now);

    // Prepare a temporary log directory with an old log file.
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-logs-"));
    const oldFile = path.join(logDir, "bot-bot-abc123-2025-12-15.log");
    fs.writeFileSync(oldFile, "old log", "utf8");
    fs.utimesSync(oldFile, new Date("2025-12-15T00:00:00"), new Date("2025-12-15T00:00:00"));

    // Trigger rotation by writing a new log entry.
    const logger = new Logger("bot-abc123", logDir);
    logger.info("Rotation check");

    // Ensure the old file has been pruned.
    expect(fs.existsSync(oldFile)).toBe(false);

    vi.useRealTimers();
  });
});
