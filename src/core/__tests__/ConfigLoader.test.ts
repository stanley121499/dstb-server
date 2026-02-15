import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigLoader } from "../ConfigLoader";
import { BotConfig } from "../types";

/**
 * Build a minimal valid bot config.
 */
const buildConfig = (overrides: Partial<BotConfig> = {}): BotConfig => {
  return {
    name: "Test Bot",
    strategy: "test-strategy",
    exchange: "paper",
    symbol: "BTCUSDT",
    interval: "15m",
    initialBalance: 1000,
    riskManagement: {
      maxDailyLossPct: 5,
      maxPositionSizePct: 20
    },
    params: {},
    ...overrides
  };
};

describe("ConfigLoader", () => {
  it("loads config and substitutes env vars", () => {
    // Create a temporary config file for the test.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-config-"));
    const filePath = path.join(tempDir, "bot.json");

    // Set required environment variables for substitution.
    const original = process.env.DSTB_TEST_KEY;
    process.env.DSTB_TEST_KEY = "secret-value";

    // Build a config that references the env variable.
    const config = buildConfig({
      bitunix: {
        apiKey: "${DSTB_TEST_KEY}",
        secretKey: "${DSTB_TEST_KEY}",
        testMode: true,
        marketType: "futures"
      }
    });

    // Persist the test config to disk.
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");

    // Load and validate the config with substitution.
    try {
      const loaded = ConfigLoader.loadBotConfig(filePath);
      expect(loaded.bitunix?.apiKey).toBe("secret-value");
    } finally {
      // Restore original env var to avoid test leakage.
      if (original === undefined) {
        delete process.env.DSTB_TEST_KEY;
      } else {
        process.env.DSTB_TEST_KEY = original;
      }
    }
  });

  it("throws a clear error when env vars are missing", () => {
    // Create a temporary config file for the test.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-config-"));
    const filePath = path.join(tempDir, "bot.json");

    // Build a config referencing a missing environment variable.
    const config = buildConfig({
      bitunix: {
        apiKey: "${MISSING_KEY}",
        secretKey: "${MISSING_KEY}",
        testMode: true,
        marketType: "futures"
      }
    });

    // Persist the invalid config to disk.
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");

    // Expect a descriptive error when substitution fails.
    expect(() => ConfigLoader.loadBotConfig(filePath)).toThrow("Missing environment variables");
  });

  it("validates config and reports schema errors", () => {
    // Build a deliberately invalid config payload.
    const invalidConfig = { strategy: "test" };

    // Expect validation errors to include the missing field name.
    expect(() => ConfigLoader.validateConfig(invalidConfig)).toThrow("name");
  });
});
