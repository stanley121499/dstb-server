import { DateTime } from "luxon";
import { z } from "zod";

import { strategyParamsSchema } from "../domain/strategyParams.js";
import { createExchangeAdapter } from "../exchange/createAdapter.js";
import type { Position } from "../exchange/types.js";
import type { SupabaseClient } from "../supabase/client.js";
import { intervalToMinutes } from "../utils/interval.js";
import { StrategyStateManager } from "../strategy/StrategyStateManager.js";
import type { Bot, BotStatus } from "./botRepo.js";
import { createBot, getBotById, listBots, updateBotBalance, updateBotHeartbeat, updateBotStatus } from "./botRepo.js";
import { BotLogger } from "./BotLogger.js";
import type { BotConfig } from "./botConfigSchema.js";
import { validateBotConfig } from "./validateBotConfig.js";
import { OrderExecutor } from "./OrderExecutor.js";
import { PerformanceMonitor } from "./PerformanceMonitor.js";
import { PositionManager } from "./PositionManager.js";
import { RiskManager } from "./RiskManager.js";
import { TradingBot } from "./TradingBot.js";

const intervalSchema = z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"]);

const staleHeartbeatMs = 2 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function toSessionDateNy(utcIso: string): string {
  return DateTime.fromISO(utcIso, { zone: "utc" }).setZone("America/New_York").toISODate() ?? utcIso.slice(0, 10);
}

function parseInterval(value: string): z.infer<typeof intervalSchema> {
  return intervalSchema.parse(value);
}

function buildPaperAdapterConfig(config: BotConfig): Readonly<{
  type: "paper";
  symbol: string;
  interval: z.infer<typeof intervalSchema>;
  initialBalance: number;
  feesBps: number;
  slippageBps: number;
  currency?: string;
}> {
  const params = strategyParamsSchema.parse(config.params);
  return {
    type: "paper",
    symbol: config.symbol,
    interval: parseInterval(config.interval),
    initialBalance: config.initialBalance,
    feesBps: params.execution.feeBps,
    slippageBps: params.execution.slippageBps,
    currency: "USD"
  };
}

function buildBitunixAdapterConfig(config: BotConfig): Readonly<{
  type: "bitunix";
  symbol: string;
  interval: z.infer<typeof intervalSchema>;
  apiKey: string;
  apiSecret: string;
  testMode: boolean;
  marketType: "spot" | "futures";
}> {
  if (config.bitunix === undefined) {
    throw new Error("Bitunix config is required for bitunix exchange");
  }
  return {
    type: "bitunix",
    symbol: config.symbol,
    interval: parseInterval(config.interval),
    apiKey: config.bitunix.apiKey,
    apiSecret: config.bitunix.secretKey,
    testMode: config.bitunix.testMode ?? false,
    marketType: config.bitunix.marketType ?? "spot"
  };
}

function buildAdapterConfig(config: BotConfig) {
  return config.exchange === "paper" ? buildPaperAdapterConfig(config) : buildBitunixAdapterConfig(config);
}

async function waitForStatus(args: Readonly<{
  supabase: SupabaseClient;
  botId: string;
  status: BotStatus;
  timeoutMs: number;
}>): Promise<Bot | null> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() < deadline) {
    const bot = await getBotById({ supabase: args.supabase, id: args.botId });
    if (bot !== null && bot.status === args.status) {
      return bot;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  return null;
}

/**
 * Manages bot lifecycle transitions and health monitoring.
 */
export class BotLifecycleManager {
  private readonly supabase: SupabaseClient;
  private readonly activeBots: Map<string, TradingBot>;

  public constructor(args: Readonly<{ supabase: SupabaseClient }>) {
    // Step 1: Store Supabase client for lifecycle operations.
    this.supabase = args.supabase;
    // Step 2: Initialize the in-memory bot registry.
    this.activeBots = new Map<string, TradingBot>();
  }

  /**
   * Starts a bot with the provided config.
   *
   * Inputs:
   * - Bot config payload.
   *
   * Outputs:
   * - Created bot DTO.
   *
   * Edge cases:
   * - Duplicate names are rejected before insert, and by DB unique index.
   *
   * Error behavior:
   * - Throws on validation, DB, or exchange connection errors.
   */
  public async startBot(config: unknown): Promise<Bot> {
    // Step 1: Validate the incoming configuration payload.
    const validation = await validateBotConfig({ config, supabase: this.supabase });
    if (!validation.valid || validation.parsed === undefined) {
      const message = validation.errors.length > 0 ? validation.errors.join("\n") : "Invalid bot config";
      throw new Error(message);
    }

    // Step 2: Persist the bot record.
    const parsed = validation.parsed;
    const bot = await createBot({
      supabase: this.supabase,
      name: parsed.name,
      status: "starting",
      exchange: parsed.exchange,
      symbol: parsed.symbol,
      interval: parsed.interval,
      paramsSnapshot: parsed.params,
      initialBalance: parsed.initialBalance,
      maxDailyLossPct: parsed.riskManagement.maxDailyLossPct,
      maxPositionSizePct: parsed.riskManagement.maxPositionSizePct
    });

    try {
      // Step 3: Validate exchange connectivity before starting the bot.
      const adapter = createExchangeAdapter(buildAdapterConfig(parsed));
      await adapter.connect();
      await adapter.disconnect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown exchange connection error";
      await updateBotStatus({
        supabase: this.supabase,
        id: bot.id,
        status: "error",
        errorMessage: message
      });
      throw new Error(message);
    }

    // Step 4: Build the exchange adapter and dependencies for live trading.
    const adapter = createExchangeAdapter(buildAdapterConfig(parsed));
    const strategyStateManager = new StrategyStateManager({
      timezone: parsed.params.session.timezone,
      startTime: parsed.params.session.startTime,
      openingRangeMinutes: parsed.params.session.openingRangeMinutes,
      atrLength: parsed.params.atr.atrLength,
      intervalMinutes: intervalToMinutes(parsed.params.interval)
    });
    const positionManager = new PositionManager({ supabase: this.supabase });
    const orderExecutor = new OrderExecutor({
      supabase: this.supabase,
      adapter,
      botId: bot.id,
      exchange: parsed.exchange,
      symbol: parsed.symbol
    });
    const riskManager = new RiskManager({
      supabase: this.supabase,
      adapter,
      botId: bot.id,
      params: parsed.params
    });
    const performanceMonitor = new PerformanceMonitor({
      supabase: this.supabase,
      botId: bot.id,
      exchange: parsed.exchange,
      adapter
    });
    const logger = new BotLogger({ supabase: this.supabase, botId: bot.id });
    const tradingBot = new TradingBot({
      botId: bot.id,
      botConfig: parsed,
      exchangeAdapter: adapter,
      supabaseClient: this.supabase,
      dependencies: {
        strategyStateManager,
        positionManager,
        orderExecutor,
        riskManager,
        performanceMonitor,
        logger
      }
    });

    // Step 5: Track the bot instance in memory and start it asynchronously.
    this.activeBots.set(bot.id, tradingBot);
    void this.startBotInBackground(bot.id, tradingBot);

    // Step 6: Wait briefly for the bot to transition to running.
    const runningBot = await waitForStatus({
      supabase: this.supabase,
      botId: bot.id,
      status: "running",
      timeoutMs: 30_000
    });

    return runningBot ?? bot;
  }

  /**
   * Stops a bot by requesting cooperative shutdown.
   *
   * Inputs:
   * - Bot id and optional graceful flag.
   *
   * Outputs:
   * - None.
   *
   * Error behavior:
   * - Throws on DB errors.
   */
  public async stopBot(botId: string, graceful = true): Promise<void> {
    // Step 1: Set status to stopping for visibility.
    await updateBotStatus({
      supabase: this.supabase,
      id: botId,
      status: "stopping"
    });

    // Step 2: Retrieve the in-memory bot instance.
    const runningBot = this.activeBots.get(botId);
    if (runningBot === undefined) {
      throw new Error(`Bot ${botId} not found in active registry`);
    }

    // Step 3: Stop the bot process and clean up.
    await runningBot.stop(graceful);
    this.activeBots.delete(botId);

    // Step 4: Persist a force-stop marker when requested.
    if (!graceful) {
      await updateBotStatus({
        supabase: this.supabase,
        id: botId,
        status: "stopped",
        errorMessage: "Force stop requested",
        stoppedAt: nowIso()
      });
    }
  }

  /**
   * Restarts a bot by stopping and starting its runner.
   *
   * Inputs:
   * - Bot id.
   *
   * Outputs:
   * - None.
   *
   * Error behavior:
   * - Throws if the bot is missing or cannot be restarted.
   */
  public async restartBot(botId: string): Promise<void> {
    const bot = await getBotById({ supabase: this.supabase, id: botId });
    if (bot === null) {
      throw new Error(`Bot ${botId} not found`);
    }

    await this.stopBot(botId, true);

    if (bot.exchange === "bitunix") {
      throw new Error("Bitunix bots require credentials and must be restarted via config file");
    }

    const params = strategyParamsSchema.parse(bot.paramsSnapshot);
    const config: BotConfig = {
      name: bot.name,
      exchange: "paper",
      symbol: bot.symbol,
      interval: parseInterval(bot.interval),
      initialBalance: bot.initialBalance,
      riskManagement: {
        maxDailyLossPct: bot.maxDailyLossPct,
        maxPositionSizePct: bot.maxPositionSizePct
      },
      params
    };

    await this.startBot(config);
  }

  /**
   * Pauses a running bot while keeping positions open.
   */
  public async pauseBot(botId: string): Promise<void> {
    await updateBotStatus({
      supabase: this.supabase,
      id: botId,
      status: "paused"
    });
  }

  /**
   * Resumes a paused bot.
   */
  public async resumeBot(botId: string): Promise<void> {
    await updateBotStatus({
      supabase: this.supabase,
      id: botId,
      status: "running"
    });
  }

  /**
   * Checks health for running bots and attempts restarts when stale.
   */
  public async monitorHealth(): Promise<void> {
    const bots = await listBots({ supabase: this.supabase, status: "running" });
    const nowMs = Date.now();

    for (const bot of bots) {
      const lastHeartbeat = bot.lastHeartbeatAt === null ? null : Date.parse(bot.lastHeartbeatAt);
      const isStale = lastHeartbeat === null || nowMs - lastHeartbeat > staleHeartbeatMs;
      if (!isStale) {
        continue;
      }

      const nextErrorCount = bot.errorCount + 1;
      const result = await this.supabase
        .from("bots")
        .update({
          status: "error",
          error_message: "Heartbeat stale",
          error_count: nextErrorCount
        })
        .eq("id", bot.id);

      if (result.error !== null) {
        throw result.error;
      }

      if (nextErrorCount < 3) {
        await this.restartBot(bot.id);
      }
    }
  }

  /**
   * Reconciles DB state with exchange reality for a bot.
   */
  public async reconcileState(botId: string): Promise<void> {
    const bot = await getBotById({ supabase: this.supabase, id: botId });
    if (bot === null) {
      throw new Error(`Bot ${botId} not found`);
    }

    if (bot.exchange === "bitunix") {
      throw new Error("Bitunix reconciliation requires credentials and is not supported in this runner");
    }

    const params = strategyParamsSchema.parse(bot.paramsSnapshot);
    const config: BotConfig = {
      name: bot.name,
      exchange: "paper",
      symbol: bot.symbol,
      interval: parseInterval(bot.interval),
      initialBalance: bot.initialBalance,
      riskManagement: {
        maxDailyLossPct: bot.maxDailyLossPct,
        maxPositionSizePct: bot.maxPositionSizePct
      },
      params
    };

    const adapter = createExchangeAdapter(buildAdapterConfig(config));
    await adapter.connect();

    const [balance, position, openOrders] = await Promise.all([
      adapter.getBalance(),
      adapter.getPosition(),
      adapter.getOpenOrders()
    ]);

    await updateBotBalance({
      supabase: this.supabase,
      id: bot.id,
      balance: balance.total,
      equity: balance.total
    });
    await updateBotHeartbeat({ supabase: this.supabase, id: bot.id });

    await this.reconcilePositions(bot, position);
    await this.reconcileOrders(bot.id, openOrders.length);

    await adapter.disconnect();
  }

  private async reconcilePositions(bot: Bot, position: Position | null): Promise<void> {
    const dbPositions = await this.supabase
      .from("live_positions")
      .select("*")
      .eq("bot_id", bot.id)
      .eq("status", "open");

    if (dbPositions.error !== null) {
      throw dbPositions.error;
    }

    if (position === null) {
      const rows = dbPositions.data as unknown as readonly Readonly<{ id: string }>[];
      await this.closeStalePositions(rows);
      return;
    }

    if (dbPositions.data.length === 0) {
      const insert = await this.supabase.from("live_positions").insert({
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

  private async closeStalePositions(rows: readonly Readonly<{ id: string }>[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const ids = rows.map((row) => row.id);
    const update = await this.supabase
      .from("live_positions")
      .update({
        status: "closed",
        closed_at: nowIso(),
        exit_reason: "reconciled"
      })
      .in("id", ids);

    if (update.error !== null) {
      throw update.error;
    }
  }

  private async reconcileOrders(botId: string, exchangeOpenOrders: number): Promise<void> {
    const dbOrders = await this.supabase
      .from("live_orders")
      .select("*")
      .eq("bot_id", botId)
      .in("status", ["pending", "submitted", "partial"]);

    if (dbOrders.error !== null) {
      throw dbOrders.error;
    }

    if (exchangeOpenOrders === 0 && dbOrders.data.length > 0) {
      const rows = dbOrders.data as unknown as readonly Readonly<{ id: string }>[];
      const ids = rows.map((row) => row.id);
      const update = await this.supabase
        .from("live_orders")
        .update({
          status: "cancelled",
          cancelled_at: nowIso(),
          error_message: "Reconciled with empty exchange order book"
        })
        .in("id", ids);

      if (update.error !== null) {
        throw update.error;
      }
    }

    if (exchangeOpenOrders !== dbOrders.data.length) {
      console.warn(
        [
          "[bot-reconcile] Order mismatch",
          `botId=${botId}`,
          `exchangeOpenOrders=${exchangeOpenOrders}`,
          `dbOpenOrders=${dbOrders.data.length}`
        ].join(" ")
      );
    }
  }

  /**
   * Runs a trading bot in the background and records failures.
   */
  private async startBotInBackground(botId: string, bot: TradingBot): Promise<void> {
    // Step 1: Start the bot and capture failures.
    try {
      await bot.start();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown bot start error";
      await updateBotStatus({
        supabase: this.supabase,
        id: botId,
        status: "error",
        errorMessage: message
      });
    } finally {
      // Step 2: Ensure we remove the bot from the in-memory registry.
      this.activeBots.delete(botId);
    }
  }
}
