/**
 * @file Bot lifecycle CLI (start/stop/status/list/restart/pause/resume/run).
 */

import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DateTime } from "luxon";
import { z } from "zod";

import { BotLifecycleManager } from "../live/BotLifecycleManager.js";
import type { Bot, BotStatus } from "../live/botRepo.js";
import { getBotById, listBots, updateBotBalance, updateBotHeartbeat, updateBotStatus } from "../live/botRepo.js";
import { botConfigSchema } from "../live/botConfigSchema.js";
import type { BotConfig } from "../live/botConfigSchema.js";
import { createExchangeAdapter } from "../exchange/createAdapter.js";
import { strategyParamsSchema } from "../domain/strategyParams.js";
import type { StrategyParams } from "../domain/strategyParams.js";
import type { Position } from "../exchange/types.js";
import { readEnv } from "../server/env.js";
import { createSupabaseServerClient } from "../supabase/client.js";
import { OrderExecutor } from "../live/OrderExecutor.js";
import { PerformanceMonitor } from "../live/PerformanceMonitor.js";
import { PositionManager } from "../live/PositionManager.js";

// Global error handlers to prevent unhandled rejections from crashing the bot
process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("[bot-cli] Unhandled Promise Rejection:", reason);
  console.error("Promise:", promise);
  // Don't exit - log and continue
});

process.on("uncaughtException", (error: Error) => {
  console.error("[bot-cli] Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  // Exit on uncaught exceptions as they may leave the process in an invalid state
  process.exit(1);
});

type Command =
  | "start"
  | "stop"
  | "status"
  | "list"
  | "restart"
  | "pause"
  | "resume"
  | "run"
  | "bot:positions"
  | "bot:orders"
  | "bot:trades"
  | "bot:performance"
  | "bot:logs"
  | "bot:health"
  | "bot:emergency-stop-all"
  | "bot:close-position";

type ParsedArgs = Readonly<{
  command: Command;
  flags: Readonly<Record<string, string>>;
}>;

const heartbeatIntervalMs = 15_000;
const statusPollIntervalMs = 5_000;
const gracefulStopTimeoutMs = 60_000;
const intervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);

const numericSchema = z
  .union([z.number(), z.string().transform(Number)])
  .refine((v) => Number.isFinite(v), { message: "Expected a finite number" });

const nullableNumericSchema = z.union([numericSchema, z.null()]);

const positionRowSchema = z.object({
  id: z.string().min(1),
  bot_id: z.string().min(1),
  symbol: z.string().min(1),
  direction: z.string().min(1),
  status: z.string().min(1),
  entry_time: z.string().min(1),
  entry_price: numericSchema,
  current_price: nullableNumericSchema,
  quantity: numericSchema,
  stop_loss_price: nullableNumericSchema,
  take_profit_price: nullableNumericSchema,
  stop_order_id: z.union([z.string().min(1), z.null()]),
  tp_order_id: z.union([z.string().min(1), z.null()]),
  unrealized_pnl: nullableNumericSchema,
  risk_amount: nullableNumericSchema
});

const orderIdSchema = z.object({
  id: z.string().min(1)
});

const orderRowSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().min(1),
  symbol: z.string().min(1),
  side: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  quantity: numericSchema,
  price: nullableNumericSchema,
  filled_quantity: numericSchema
});

const tradeRowSchema = z.object({
  id: z.string().min(1),
  exit_time: z.string().min(1),
  entry_time: z.string().min(1),
  symbol: z.string().min(1),
  direction: z.string().min(1),
  pnl: numericSchema,
  r_multiple: nullableNumericSchema,
  exit_reason: z.string().min(1)
});

const botLogRowSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().min(1),
  level: z.string().min(1),
  category: z.string().min(1),
  message: z.string().min(1),
  context: z.unknown()
});

function parseArgv(argv: readonly string[]): ParsedArgs {
  const [commandToken, ...rest] = argv;
  if (commandToken === undefined) {
    throw new Error(
      [
        "Missing command. Expected one of:",
        "start, stop, status, list, restart, pause, resume, run,",
        "bot:positions, bot:orders, bot:trades, bot:performance, bot:logs, bot:health,",
        "bot:emergency-stop-all, bot:close-position."
      ].join(" ")
    );
  }

  const command = commandToken as Command;
  const supported: Command[] = [
    "start",
    "stop",
    "status",
    "list",
    "restart",
    "pause",
    "resume",
    "run",
    "bot:positions",
    "bot:orders",
    "bot:trades",
    "bot:performance",
    "bot:logs",
    "bot:health",
    "bot:emergency-stop-all",
    "bot:close-position"
  ];
  if (!supported.includes(command)) {
    throw new Error(`Unsupported command "${commandToken}".`);
  }

  const flags: Record<string, string> = {};
  const booleanFlags = new Set(["force", "follow"]);
  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token === undefined) {
      i += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}". Expected flags like --id.`);
    }
    const key = token.slice(2).trim();
    if (key.length === 0) {
      throw new Error(`Invalid flag "${token}".`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      if (booleanFlags.has(key)) {
        flags[key] = "true";
        i += 1;
        continue;
      }
      throw new Error(`Missing value for flag "--${key}".`);
    }
    flags[key] = value;
    i += 2;
  }

  return { command, flags };
}

async function readJsonFile(pathValue: string): Promise<unknown> {
  const absolute = resolve(process.cwd(), pathValue);
  const raw = await readFile(absolute, { encoding: "utf-8" });
  return JSON.parse(raw) as unknown;
}

function formatBotStatus(bot: Bot): string {
  const pnl = bot.currentEquity - bot.initialBalance;
  const parts = [
    `ID: ${bot.id}`,
    `Name: ${bot.name}`,
    `Status: ${bot.status}`,
    `Exchange: ${bot.exchange}`,
    `Symbol: ${bot.symbol}`,
    `Interval: ${bot.interval}`,
    `Balance: ${bot.currentBalance}`,
    `Equity: ${bot.currentEquity}`,
    `P&L: ${pnl}`,
    `Last Heartbeat: ${bot.lastHeartbeatAt ?? "n/a"}`,
    `Error: ${bot.errorMessage ?? "n/a"}`
  ];
  return parts.join("\n");
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, " ");
}

function formatTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, idx) => {
    const rowMax = rows.reduce((max, row) => Math.max(max, row[idx]?.length ?? 0), 0);
    return Math.max(header.length, rowMax);
  });

  const headerLine = headers.map((header, idx) => pad(header, widths[idx] ?? header.length)).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-|-");
  const rowLines = rows.map((row) => row.map((cell, idx) => pad(cell, widths[idx] ?? cell.length)).join(" | "));

  return [headerLine, separator, ...rowLines].join("\n");
}

function formatNumber(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(decimals);
}

function formatDurationMinutes(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "n/a";
  }
  const minutes = Math.max(0, (end - start) / 60000);
  return `${minutes.toFixed(1)}m`;
}

function parseIntegerFlag(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received "${value}"`);
  }
  return Math.floor(parsed);
}

function formatBotList(bots: readonly Bot[]): string {
  const headers = ["ID", "Name", "Status", "Symbol", "Equity", "P&L", "Heartbeat"];
  const rows = bots.map((bot) => {
    const pnl = bot.currentEquity - bot.initialBalance;
    return [
      bot.id,
      bot.name,
      bot.status,
      bot.symbol,
      bot.currentEquity.toFixed(2),
      pnl.toFixed(2),
      bot.lastHeartbeatAt ?? "n/a"
    ];
  });

  const widths = headers.map((header, idx) => {
    const rowMax = rows.reduce((max, row) => Math.max(max, row[idx]?.length ?? 0), 0);
    return Math.max(header.length, rowMax);
  });

  const headerLine = headers.map((header, idx) => pad(header, widths[idx] ?? header.length)).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-|-");
  const rowLines = rows.map((row) => row.map((cell, idx) => pad(cell, widths[idx] ?? cell.length)).join(" | "));

  return [headerLine, separator, ...rowLines].join("\n");
}

async function handleStart(args: ParsedArgs): Promise<void> {
  const configPath = args.flags.config;
  if (configPath === undefined) {
    throw new Error("Missing --config <path>.");
  }

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const manager = new BotLifecycleManager({ supabase });

  const configRaw = await readJsonFile(configPath);
  const config = botConfigSchema.parse(configRaw);

  const bot = await manager.startBot(config);
  console.log(`Bot started: ${bot.id}, status: ${bot.status}`);
}

async function handleStop(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }
  const force = args.flags.force !== undefined;

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const manager = new BotLifecycleManager({ supabase });

  await manager.stopBot(botId, !force);
  console.log(`Bot stopped: ${botId}`);
}

async function handleStatus(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const bot = await getBotById({ supabase, id: botId });
  if (bot === null) {
    throw new Error(`Bot ${botId} not found`);
  }

  const positionsCount = await supabase
    .from("live_positions")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", bot.id)
    .in("status", ["open", "closing"]);

  if (positionsCount.error !== null) {
    throw positionsCount.error;
  }

  const openPositions = positionsCount.count ?? 0;
  const output = [formatBotStatus(bot), `Open Positions: ${openPositions}`].join("\n");
  console.log(output);
}

async function handleList(args: ParsedArgs): Promise<void> {
  const status = args.flags.status as BotStatus | undefined;
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const listArgs: { supabase: ReturnType<typeof createSupabaseServerClient>; status?: BotStatus } = { supabase };
  if (status !== undefined) {
    listArgs.status = status;
  }
  const bots = await listBots(listArgs);
  console.log(formatBotList(bots));
}

async function handleRestart(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const manager = new BotLifecycleManager({ supabase });
  await manager.restartBot(botId);
  console.log(`Bot restarted: ${botId}`);
}

async function handlePause(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const manager = new BotLifecycleManager({ supabase });
  await manager.pauseBot(botId);
  console.log(`Bot paused: ${botId}`);
}

async function handleResume(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const manager = new BotLifecycleManager({ supabase });
  await manager.resumeBot(botId);
  console.log(`Bot resumed: ${botId}`);
}

async function handlePositions(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const result = await supabase
    .from("live_positions")
    .select(
      "id,bot_id,symbol,direction,status,entry_time,entry_price,current_price,quantity,stop_loss_price,take_profit_price,stop_order_id,tp_order_id,unrealized_pnl,risk_amount"
    )
    .eq("bot_id", botId)
    .in("status", ["open", "closing"])
    .order("entry_time", { ascending: true });

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(positionRowSchema).parse(result.data ?? []);
  if (rows.length === 0) {
    console.log("No open positions.");
    return;
  }

  const nowIso = new Date().toISOString();
  const tableRows = rows.map((row) => {
    const entryPrice = Number(row.entry_price);
    const currentPrice = row.current_price === null ? entryPrice : Number(row.current_price);
    const quantity = Number(row.quantity);
    const unrealized = row.unrealized_pnl === null ? (currentPrice - entryPrice) * quantity : Number(row.unrealized_pnl);
    const stopLoss = row.stop_loss_price === null ? null : Number(row.stop_loss_price);
    const takeProfit = row.take_profit_price === null ? null : Number(row.take_profit_price);
    const riskAmount =
      row.risk_amount === null && stopLoss !== null ? Math.abs(entryPrice - stopLoss) * quantity : row.risk_amount;
    const rMultiple =
      riskAmount === null || !Number.isFinite(riskAmount) || riskAmount === 0 ? null : unrealized / Number(riskAmount);

    return [
      row.symbol,
      row.direction,
      formatNumber(entryPrice, 2),
      formatNumber(currentPrice, 2),
      formatNumber(quantity, 4),
      formatNumber(unrealized, 2),
      formatNumber(rMultiple, 2),
      row.entry_time,
      formatDurationMinutes(row.entry_time, nowIso),
      formatNumber(stopLoss, 2),
      formatNumber(takeProfit, 2)
    ];
  });

  const headers = [
    "Symbol",
    "Dir",
    "Entry",
    "Current",
    "Qty",
    "Unreal PnL",
    "R",
    "Entry Time",
    "Duration",
    "Stop",
    "TP"
  ];
  console.log(formatTable(headers, tableRows));
}

async function handleOrders(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const status = args.flags.status;
  const days = parseIntegerFlag(args.flags.days, 7);
  const cutoff = DateTime.now().minus({ days }).toISO();

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);

  let query = supabase
    .from("live_orders")
    .select("id,created_at,symbol,side,type,status,quantity,price,filled_quantity")
    .eq("bot_id", botId)
    .gte("created_at", cutoff ?? "")
    .order("created_at", { ascending: false });

  if (status !== undefined) {
    query = query.eq("status", status);
  }

  const result = await query;
  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(orderRowSchema).parse(result.data ?? []);
  if (rows.length === 0) {
    console.log("No orders found.");
    return;
  }

  const tableRows = rows.map((row) => [
    row.created_at,
    row.symbol,
    row.side,
    row.type,
    row.status,
    formatNumber(Number(row.quantity), 4),
    formatNumber(row.price === null ? null : Number(row.price), 2),
    formatNumber(Number(row.filled_quantity), 4)
  ]);

  const headers = ["Time", "Symbol", "Side", "Type", "Status", "Qty", "Price", "Filled"];
  console.log(formatTable(headers, tableRows));
}

async function handleTrades(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const days = parseIntegerFlag(args.flags.days, 7);
  const cutoff = DateTime.now().minus({ days }).toISO();

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);

  const result = await supabase
    .from("live_trades")
    .select("id,entry_time,exit_time,symbol,direction,pnl,r_multiple,exit_reason")
    .eq("bot_id", botId)
    .gte("exit_time", cutoff ?? "")
    .order("exit_time", { ascending: false });

  if (result.error !== null) {
    throw result.error;
  }

  const rows = z.array(tradeRowSchema).parse(result.data ?? []);
  if (rows.length === 0) {
    console.log("No trades found.");
    return;
  }

  const tableRows = rows.map((row) => [
    row.exit_time,
    row.symbol,
    row.direction,
    formatNumber(Number(row.pnl), 2),
    formatNumber(row.r_multiple === null ? null : Number(row.r_multiple), 2),
    row.exit_reason
  ]);

  const headers = ["Time", "Symbol", "Dir", "P&L", "R", "Exit Reason"];
  console.log(formatTable(headers, tableRows));

  const totalPnl = rows.reduce((sum, row) => sum + Number(row.pnl), 0);
  const winners = rows.filter((row) => Number(row.pnl) > 0).length;
  const winRate = rows.length > 0 ? (winners / rows.length) * 100 : 0;
  const grossProfit = rows.filter((row) => Number(row.pnl) > 0).reduce((sum, row) => sum + Number(row.pnl), 0);
  const grossLoss = Math.abs(rows.filter((row) => Number(row.pnl) < 0).reduce((sum, row) => sum + Number(row.pnl), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

  console.log(
    [
      "",
      `Total P&L: ${formatNumber(totalPnl, 2)}`,
      `Win rate: ${winRate.toFixed(2)}%`,
      `Profit factor: ${profitFactor === null ? "n/a" : profitFactor.toFixed(2)}`
    ].join("\n")
  );
}

async function handlePerformance(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const days = parseIntegerFlag(args.flags.days, 30);
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const bot = await getBotById({ supabase, id: botId });
  if (bot === null) {
    throw new Error(`Bot ${botId} not found`);
  }

  const monitor = new PerformanceMonitor({ supabase, botId: bot.id, exchange: bot.exchange });
  const report = await monitor.calculatePerformance(bot.id, days);

  const lines = [
    `Total P&L: ${formatNumber(report.totalPnl, 2)}`,
    `Total return %: ${formatNumber(report.totalReturnPct, 2)}`,
    `Win rate: ${formatNumber(report.winRatePct, 2)}%`,
    `Profit factor: ${report.profitFactor === null ? "n/a" : report.profitFactor.toFixed(2)}`,
    `Max drawdown %: ${formatNumber(report.maxDrawdownPct, 2)}`,
    `Trade count: ${report.tradeCount}`,
    `Average R: ${report.averageRMultiple === null ? "n/a" : report.averageRMultiple.toFixed(2)}`,
    `Sharpe ratio: ${report.sharpeRatio === null ? "n/a" : report.sharpeRatio.toFixed(2)}`,
    `Avg duration: ${
      report.averageTradeDurationMinutes === null ? "n/a" : `${report.averageTradeDurationMinutes.toFixed(1)}m`
    }`
  ];

  console.log(lines.join("\n"));
}

async function handleLogs(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const level = args.flags.level;
  const tail = parseIntegerFlag(args.flags.tail, 50);
  const follow = args.flags.follow === "true";

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);

  const fetchLogs = async (since?: string): Promise<readonly z.infer<typeof botLogRowSchema>[]> => {
    let query = supabase
      .from("bot_logs")
      .select("id,created_at,level,category,message,context")
      .eq("bot_id", botId)
      .order("created_at", { ascending: true });

    if (level !== undefined) {
      query = query.eq("level", level);
    }
    if (since !== undefined) {
      query = query.gt("created_at", since);
    }
    if (since === undefined) {
      query = query.limit(tail);
    }

    const result = await query;
    if (result.error !== null) {
      throw result.error;
    }
    return z.array(botLogRowSchema).parse(result.data ?? []);
  };

  const printLogs = (rows: readonly z.infer<typeof botLogRowSchema>[]): void => {
    for (const row of rows) {
      const context = row.context === null ? "null" : JSON.stringify(row.context);
      const line = `[${row.created_at}] ${row.level.toUpperCase()} ${row.category} ${row.message} ${context}`;
      console.log(line.trim());
    }
  };

  const initial = await fetchLogs();
  printLogs(initial);
  let lastTimestamp = initial.at(-1)?.created_at ?? null;

  if (!follow) {
    return;
  }

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const rows = await fetchLogs(lastTimestamp ?? undefined);
    if (rows.length > 0) {
      printLogs(rows);
      lastTimestamp = rows.at(-1)?.created_at ?? lastTimestamp;
    }
  }
}

async function handleHealth(args: ParsedArgs): Promise<void> {
  const botId = args.flags.id;
  if (botId === undefined) {
    throw new Error("Missing --id <botId>.");
  }

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const bot = await getBotById({ supabase, id: botId });
  if (bot === null) {
    throw new Error(`Bot ${botId} not found`);
  }

  const monitor = new PerformanceMonitor({ supabase, botId: bot.id, exchange: bot.exchange });
  const health = await monitor.checkBotHealth(bot.id);

  console.log(`Healthy: ${health.healthy ? "yes" : "no"}`);
  if (health.issues.length > 0) {
    console.log(health.issues.map((issue) => `- ${issue}`).join("\n"));
  }

  process.exitCode = health.healthy ? 0 : 1;
}

async function logCriticalEvent(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  botId: string,
  message: string,
  context: Readonly<Record<string, unknown>>
): Promise<void> {
  await supabase.from("bot_logs").insert({
    bot_id: botId,
    level: "critical",
    category: "system",
    message,
    context
  });
}

async function finalizeEmergencyStop(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  botId: string,
  errorMessage: string | null
): Promise<void> {
  await updateBotStatus({
    supabase,
    id: botId,
    status: "stopped",
    errorMessage,
    stoppedAt: new Date().toISOString()
  });
}

async function closePositionsForEmergencyStop(
  positionManager: PositionManager,
  orderExecutor: OrderExecutor,
  supabase: ReturnType<typeof createSupabaseServerClient>,
  botId: string
): Promise<void> {
  const positions = await positionManager.getOpenPositions(botId);
  for (const position of positions) {
    const side = position.direction === "long" ? "sell" : "buy";
    const quantity = Number(position.quantity);
    try {
      const order = await orderExecutor.placeMarketOrder({ side, quantity, parentPositionId: position.id });
      const filled = await orderExecutor.waitForFill(order.id, 10_000);
      if (position.stop_order_id !== null) {
        await orderExecutor.cancelOrder(position.stop_order_id);
      }
      if (position.tp_order_id !== null) {
        await orderExecutor.cancelOrder(position.tp_order_id);
      }
      await positionManager.closePosition({
        positionId: position.id,
        exitOrder: filled,
        exitReason: "emergency_stop"
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown emergency stop error";
      await logCriticalEvent(supabase, botId, "Emergency stop close failed", { error: message, positionId: position.id });
    }
  }
}

async function cancelPendingOrdersForEmergencyStop(
  orderExecutor: OrderExecutor,
  supabase: ReturnType<typeof createSupabaseServerClient>,
  botId: string
): Promise<void> {
  const pendingOrders = await supabase
    .from("live_orders")
    .select("id,status")
    .eq("bot_id", botId)
    .in("status", ["pending", "submitted", "partial"]);

  if (pendingOrders.error === null && pendingOrders.data !== null) {
    const pending = z.array(orderIdSchema).parse(pendingOrders.data);
    for (const order of pending) {
      try {
        await orderExecutor.cancelOrder(order.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown cancel error";
        await logCriticalEvent(supabase, botId, "Emergency stop cancel failed", { error: message, orderId: order.id });
      }
    }
  }
}

async function handlePaperEmergencyStop(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  bot: Bot
): Promise<void> {
  const params = strategyParamsSchema.parse(bot.paramsSnapshot);
  const adapter = createExchangeAdapter(buildPaperAdapterConfig(bot, params));
  await adapter.connect();

  const positionManager = new PositionManager({ supabase });
  const orderExecutor = new OrderExecutor({
    supabase,
    adapter,
    botId: bot.id,
    exchange: bot.exchange,
    symbol: bot.symbol
  });

  await closePositionsForEmergencyStop(positionManager, orderExecutor, supabase, bot.id);
  await cancelPendingOrdersForEmergencyStop(orderExecutor, supabase, bot.id);

  await adapter.disconnect();
}

async function handleEmergencyStopAll(): Promise<void> {
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const bots = await listBots({ supabase, status: "running" });

  if (bots.length === 0) {
    console.log("No running bots found.");
    return;
  }

  for (const bot of bots) {
    await updateBotStatus({
      supabase,
      id: bot.id,
      status: "stopping",
      errorMessage: "Emergency stop requested"
    });

    await logCriticalEvent(supabase, bot.id, "Emergency stop triggered", { source: "botCli" });

    if (bot.exchange !== "paper") {
      await finalizeEmergencyStop(supabase, bot.id, "Emergency stop requested (manual close may be required)");
      continue;
    }

    await handlePaperEmergencyStop(supabase, bot);
    await finalizeEmergencyStop(supabase, bot.id, null);
  }

  console.log("Emergency stop completed.");
}

async function handleClosePosition(args: ParsedArgs): Promise<void> {
  const positionId = args.flags.id;
  const reason = args.flags.reason;
  if (positionId === undefined) {
    throw new Error("Missing --id <positionId>.");
  }
  if (reason === undefined) {
    throw new Error("Missing --reason <reason>.");
  }

  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);
  const positionResult = await supabase.from("live_positions").select("*").eq("id", positionId).single();
  if (positionResult.error !== null || positionResult.data === null) {
    throw positionResult.error ?? new Error(`Position ${positionId} not found`);
  }

  const position = positionRowSchema.parse(positionResult.data);
  const bot = await getBotById({ supabase, id: position.bot_id });
  if (bot === null) {
    throw new Error(`Bot ${position.bot_id} not found`);
  }

  if (bot.exchange !== "paper") {
    throw new Error("Manual close for non-paper bots requires exchange credentials");
  }

  const params = strategyParamsSchema.parse(bot.paramsSnapshot);
  const adapter = createExchangeAdapter(buildPaperAdapterConfig(bot, params));
  await adapter.connect();

  const orderExecutor = new OrderExecutor({
    supabase,
    adapter,
    botId: bot.id,
    exchange: bot.exchange,
    symbol: bot.symbol
  });
  const positionManager = new PositionManager({ supabase });

  const side = position.direction === "long" ? "sell" : "buy";
  const quantity = Number(position.quantity);
  const order = await orderExecutor.placeMarketOrder({ side, quantity, parentPositionId: position.id });
  const filled = await orderExecutor.waitForFill(order.id, 10_000);

  if (position.stop_order_id !== null) {
    await orderExecutor.cancelOrder(position.stop_order_id);
  }
  if (position.tp_order_id !== null) {
    await orderExecutor.cancelOrder(position.tp_order_id);
  }

  await positionManager.closePosition({
    positionId: position.id,
    exitOrder: filled,
    exitReason: reason
  });

  await supabase.from("bot_logs").insert({
    bot_id: bot.id,
    level: "info",
    category: "system",
    message: "Manual position close",
    context: { positionId: position.id, reason }
  });

  await adapter.disconnect();
  console.log(`Position closed: ${position.id}`);
}

function toSessionDateNy(utcIso: string): string {
  return DateTime.fromISO(utcIso, { zone: "utc" }).setZone("America/New_York").toISODate() ?? utcIso.slice(0, 10);
}

function parseInterval(value: string): z.infer<typeof intervalSchema> {
  return intervalSchema.parse(value);
}

function buildPaperAdapterConfig(bot: Bot, params: StrategyParams): Readonly<{
  type: "paper";
  symbol: string;
  interval: BotConfig["interval"];
  initialBalance: number;
  feesBps: number;
  slippageBps: number;
  currency?: string;
}> {
  return {
    type: "paper",
    symbol: bot.symbol,
    interval: parseInterval(bot.interval),
    initialBalance: bot.initialBalance,
    feesBps: params.execution.feeBps,
    slippageBps: params.execution.slippageBps,
    currency: "USD"
  };
}

async function updatePositionSnapshot(bot: Bot, position: Position | null, supabase: ReturnType<typeof createSupabaseServerClient>): Promise<void> {
  const dbPositions = await supabase
    .from("live_positions")
    .select("*")
    .eq("bot_id", bot.id)
    .eq("status", "open");

  if (dbPositions.error !== null) {
    throw dbPositions.error;
  }

  if (position === null && dbPositions.data.length > 0) {
    const rows = dbPositions.data as unknown as readonly Readonly<{ id: string }>[];
    const ids = rows.map((row) => row.id);
    const update = await supabase
      .from("live_positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_reason: "runner_close"
      })
      .in("id", ids);

    if (update.error !== null) {
      throw update.error;
    }
  }

  if (position !== null && dbPositions.data.length === 0) {
    const insert = await supabase.from("live_positions").insert({
      bot_id: bot.id,
      exchange: bot.exchange,
      symbol: position.symbol,
      direction: position.side,
      status: "open",
      entry_order_id: null,
      entry_time: position.openedAtUtc,
      entry_price: position.entryPrice,
      quantity: position.quantity,
      stop_loss_price: null,
      take_profit_price: null,
      trailing_stop_price: null,
      stop_order_id: null,
      tp_order_id: null,
      current_price: position.currentPrice,
      unrealized_pnl: position.unrealizedPnl,
      realized_pnl: position.realizedPnl,
      fee_total: position.totalFeesPaid,
      risk_amount: null,
      r_multiple: null,
      session_date_ny: toSessionDateNy(position.openedAtUtc),
      closed_at: null,
      exit_reason: null
    });

    if (insert.error !== null) {
      throw insert.error;
    }
  }
}

async function attemptGracefulClose(adapter: ReturnType<typeof createExchangeAdapter>): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < gracefulStopTimeoutMs) {
    const position = await adapter.getPosition();
    if (position === null) {
      return;
    }
    const side = position.side === "long" ? "sell" : "buy";
    await adapter.placeMarketOrder({ side, quantity: position.quantity });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
}

async function runBotProcess(botId: string): Promise<void> {
  const env = readEnv(process.env);
  const supabase = createSupabaseServerClient(env);

  const bot = await getBotById({ supabase, id: botId });
  if (bot === null) {
    throw new Error(`Bot ${botId} not found`);
  }

  if (bot.exchange !== "paper") {
    throw new Error("Only paper bots are supported by the local runner");
  }

  const params = strategyParamsSchema.parse(bot.paramsSnapshot);
  const adapter = createExchangeAdapter(buildPaperAdapterConfig(bot, params));

  await adapter.connect();

  await updateBotStatus({
    supabase,
    id: bot.id,
    status: "running",
    errorMessage: null,
    startedAt: new Date().toISOString()
  });

  let isStopping = false;
  const heartbeatTimer = setInterval(async () => {
    if (isStopping) {
      return;
    }
    const balance = await adapter.getBalance();
    await updateBotBalance({
      supabase,
      id: bot.id,
      balance: balance.total,
      equity: balance.total
    });
    await updateBotHeartbeat({ supabase, id: bot.id });

    const position = await adapter.getPosition();
    await updatePositionSnapshot(bot, position, supabase);
  }, heartbeatIntervalMs);

  const statusTimer = setInterval(async () => {
    const latest = await getBotById({ supabase, id: bot.id });
    if (latest === null) {
      return;
    }
    if (latest.status === "paused") {
      return;
    }
    if (latest.status === "stopping" || latest.status === "stopped") {
      isStopping = true;
    }
  }, statusPollIntervalMs);

  try {
    while (!isStopping) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }

    await attemptGracefulClose(adapter);
    await adapter.disconnect();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown bot runner error";
    await updateBotStatus({
      supabase,
      id: bot.id,
      status: "error",
      errorMessage: message
    });
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
    clearInterval(statusTimer);
  }

  await updateBotStatus({
    supabase,
    id: bot.id,
    status: "stopped",
    errorMessage: null,
    stoppedAt: new Date().toISOString()
  });
}

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv.slice(2));

  switch (parsed.command) {
    case "start":
      await handleStart(parsed);
      return;
    case "stop":
      await handleStop(parsed);
      return;
    case "status":
      await handleStatus(parsed);
      return;
    case "list":
      await handleList(parsed);
      return;
    case "restart":
      await handleRestart(parsed);
      return;
    case "pause":
      await handlePause(parsed);
      return;
    case "resume":
      await handleResume(parsed);
      return;
    case "bot:positions":
      await handlePositions(parsed);
      return;
    case "bot:orders":
      await handleOrders(parsed);
      return;
    case "bot:trades":
      await handleTrades(parsed);
      return;
    case "bot:performance":
      await handlePerformance(parsed);
      return;
    case "bot:logs":
      await handleLogs(parsed);
      return;
    case "bot:health":
      await handleHealth(parsed);
      return;
    case "bot:emergency-stop-all":
      await handleEmergencyStopAll();
      return;
    case "bot:close-position":
      await handleClosePosition(parsed);
      return;
    case "run": {
      const botId = parsed.flags.id;
      if (botId === undefined) {
        throw new Error("Missing --id <botId>.");
      }
      await runBotProcess(botId);
      return;
    }
    default:
      throw new Error(`Unsupported command "${parsed.command}".`);
  }
}

try {
  await main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[bot-cli] Fatal error: ${message}`);
  if (stack !== undefined) {
    console.error(stack);
  }
  process.exitCode = 1;
}
