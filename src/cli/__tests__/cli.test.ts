import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseArgv, readDaemonRecord, removeDaemonRecord, writeDaemonRecord } from "../commands/cliUtils";

describe("cliUtils.parseArgv", () => {
  it("parses command, flags, booleans, and positionals", () => {
    // Step 1: Parse a mixed argv payload.
    const result = parseArgv(
      ["start", "--config", "configs/strategies/orb.json", "--paper", "bot-123"],
      ["paper"]
    );

    // Step 2: Validate the parsed result.
    expect(result.command).toBe("start");
    expect(result.flags["config"]).toBe("configs/strategies/orb.json");
    expect(result.booleanFlags["paper"]).toBe(true);
    expect(result.positionals).toEqual(["bot-123"]);
  });

  it("parses boolean flags with explicit values", () => {
    // Step 1: Parse a boolean flag with an explicit value.
    const result = parseArgv(["stop", "--force=false"], ["force"]);
    // Step 2: Validate the boolean coercion.
    expect(result.command).toBe("stop");
    expect(result.booleanFlags["force"]).toBe(false);
  });
});

describe("cliUtils daemon record helpers", () => {
  it("writes and reads daemon records", () => {
    // Step 1: Switch to a temp workspace.
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-cli-"));

    try {
      process.chdir(tempDir);
      // Step 2: Write a daemon record to disk.
      const record = {
        botId: "bot-test",
        pid: 12345,
        startedAt: new Date().toISOString(),
        configPath: path.join(tempDir, "configs", "bot.json")
      };

      writeDaemonRecord(record);
      // Step 3: Read back and validate the record.
      const loaded = readDaemonRecord(record.botId);

      expect(loaded).not.toBeNull();
      expect(loaded?.botId).toBe(record.botId);
      expect(loaded?.pid).toBe(record.pid);
      expect(loaded?.configPath).toBe(record.configPath);
    } finally {
      // Step 4: Clean up files and restore cwd.
      removeDaemonRecord("bot-test");
      process.chdir(originalCwd);
    }
  });
});
