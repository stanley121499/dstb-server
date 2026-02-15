import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Logger } from "../../core/Logger";
import { StateManager } from "../../core/StateManager";
import { BotConfig } from "../../core/types";
import { EmailAlerter, EmailTransporter } from "../EmailAlerter";
import { GoogleSheetsReporter, SheetsClient } from "../GoogleSheetsReporter";
import { parseTelegramCommand, TelegramAlerter, TelegramFetcher } from "../TelegramAlerter";

/**
 * Build a temporary StateManager instance for tests.
 */
const createStateManager = (): StateManager => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-state-"));
  const dbPath = path.join(tempDir, "bot-state.db");
  const schemaPath = path.join(process.cwd(), "data", "schema.sql");
  const logger = new Logger("test-bot", tempDir);
  return new StateManager({ dbPath, schemaPath, logger });
};

/**
 * Build a minimal bot config for test data.
 */
const createBotConfig = (name: string): BotConfig => ({
  name,
  strategy: "orb-atr",
  exchange: "paper",
  symbol: "BTCUSDT",
  interval: "1m",
  initialBalance: 10_000,
  riskManagement: {
    maxDailyLossPct: 5,
    maxPositionSizePct: 10
  },
  params: {}
});

describe("TelegramAlerter", () => {
  it("parses supported commands", () => {
    expect(parseTelegramCommand("/status")).toEqual({ type: "status" });
    expect(parseTelegramCommand("/positions")).toEqual({ type: "positions" });
    expect(parseTelegramCommand("/stop bot-123")).toEqual({ type: "stop", botId: "bot-123" });
    expect(parseTelegramCommand("/stop")).toEqual({ type: "unknown", message: "Usage: /stop <bot-id>" });
  });

  it("rate limits repeated alerts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-05T10:00:00Z"));

    const stateManager = createStateManager();
    const sent: string[] = [];
    const fetcher: TelegramFetcher = async (input, init) => {
      if (String(input).includes("sendMessage")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        sent.push(String(body.text ?? ""));
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    };

    const alerter = new TelegramAlerter({
      config: {
        botToken: "token",
        chatId: "123",
        pollIntervalMs: 1000,
        rateLimit: { windowMs: 60_000, maxPerWindow: 1 }
      },
      stateManager,
      fetcher
    });

    await alerter.sendAlert({ level: "CRITICAL", message: "Test 1", botId: "bot-1" });
    await alerter.sendAlert({ level: "CRITICAL", message: "Test 2", botId: "bot-1" });

    expect(sent.length).toBe(1);
    vi.useRealTimers();
  });

  it("responds to /status command via polling", async () => {
    const stateManager = createStateManager();
    await stateManager.createBot(createBotConfig("Test Bot"));

    const sent: string[] = [];
    const fetcher: TelegramFetcher = async (input, init) => {
      if (String(input).includes("getUpdates")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 1,
                message: {
                  text: "/status",
                  chat: { id: 123 }
                }
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (String(input).includes("sendMessage")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        sent.push(String(body.text ?? ""));
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: false, description: "Unexpected request" }), { status: 500 });
    };

    const alerter = new TelegramAlerter({
      config: {
        botToken: "token",
        chatId: "123",
        pollIntervalMs: 1000,
        rateLimit: { windowMs: 60_000, maxPerWindow: 10 }
      },
      stateManager,
      fetcher
    });

    await alerter.pollOnce();

    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("Bot Status");
  });
});

describe("GoogleSheetsReporter", () => {
  it("schedules updates every 5 minutes by default", async () => {
    const stateManager = createStateManager();
    await stateManager.createBot(createBotConfig("Sheet Bot"));

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dstb-sheets-"));
    const keyPath = path.join(tempDir, "service-account.json");
    fs.writeFileSync(keyPath, "{}", "utf8");

    let intervalMs = 0;
    const scheduler = {
      setInterval: (handler: () => void, ms: number) => {
        intervalMs = ms;
        return setInterval(handler, 9999999);
      },
      clearInterval: (timer: NodeJS.Timeout) => {
        clearInterval(timer);
      }
    };

    const fakeSheetsClient: SheetsClient = {
      spreadsheets: {
        get: async () => ({
          data: { sheets: [{ properties: { title: "Live Status" } }] }
        }),
        batchUpdate: async () => ({}),
        values: {
          update: async () => ({})
        }
      }
    };

    const reporter = new GoogleSheetsReporter({
      config: {
        sheetId: "sheet-123",
        serviceAccountKeyPath: keyPath,
        updateIntervalMs: 300_000,
        tradeHistoryDays: 7,
        summaryDays: 7,
        maxTrades: 200
      },
      stateManager,
      scheduler,
      sheetsClient: fakeSheetsClient
    });

    reporter.start();
    expect(intervalMs).toBe(300_000);
    reporter.stop();
  });
});

describe("EmailAlerter", () => {
  it("schedules daily summaries at the configured hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 5, 7, 0, 0));

    const stateManager = createStateManager();
    const transporter: EmailTransporter = {
      sendMail: async (args) => {
        void args;
      }
    };

    let delayMs = 0;
    const scheduler = {
      setTimeout: (handler: () => void, ms: number) => {
        delayMs = ms;
        return setTimeout(handler, 9999999);
      },
      clearTimeout: (timer: NodeJS.Timeout) => {
        clearTimeout(timer);
      }
    };

    const alerter = new EmailAlerter({
      config: {
        smtpHost: "smtp.test.com",
        smtpPort: 587,
        smtpUser: "user@test.com",
        smtpPass: "pass",
        to: "alert@test.com",
        from: "user@test.com",
        dailySummaryHour: 8,
        rateLimit: { windowMs: 60_000, maxPerWindow: 5 }
      },
      stateManager,
      transporter,
      scheduler
    });

    alerter.start();
    expect(delayMs).toBe(60 * 60 * 1000);
    alerter.stop();

    vi.useRealTimers();
  });

  it("sends critical alert emails only for CRITICAL events", async () => {
    const stateManager = createStateManager();
    const sent: Array<{ subject: string; text: string }> = [];
    const transporter: EmailTransporter = {
      sendMail: async (args) => {
        sent.push({ subject: args.subject, text: args.text });
      }
    };

    const alerter = new EmailAlerter({
      config: {
        smtpHost: "smtp.test.com",
        smtpPort: 587,
        smtpUser: "user@test.com",
        smtpPass: "pass",
        to: "alert@test.com",
        from: "user@test.com",
        dailySummaryHour: 8,
        rateLimit: { windowMs: 60_000, maxPerWindow: 5 }
      },
      stateManager,
      transporter
    });

    await alerter.sendAlert({ level: "WARNING", message: "Ignore", botId: "bot-1" });
    await alerter.sendAlert({ level: "CRITICAL", message: "Boom", botId: "bot-1" });

    expect(sent.length).toBe(1);
    expect(sent[0]?.subject).toContain("Critical Alert");
  });
});
