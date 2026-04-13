import { configRowToBotConfig, type ConfigRow } from "../core/configMapping.js";
import { Logger } from "../core/Logger.js";
import type { SupabaseStateStore } from "../core/SupabaseStateStore.js";
import { TradingBot } from "../core/TradingBot.js";
import type { AlertingAdapter } from "../core/TradingBot.js";
import type { BotConfig } from "../core/types.js";
import { buildExchangeAdapter } from "../cli/commands/cliExchange.js";
import { createStrategy } from "../strategies/factory.js";

/**
 * Represents a single managed bot instance.
 */
export type ManagedBot = Readonly<{
  botId: string;
  configId: string;
  config: BotConfig;
  bot: TradingBot;
  startedAt: Date;
}>;

/**
 * Options for constructing a BotManager.
 */
export type BotManagerOptions = Readonly<{
  store: SupabaseStateStore;
  logger: Logger;
  alerting?: AlertingAdapter;
}>;

/**
 * BotManager manages TradingBot instances driven by Supabase `configs` rows.
 */
export class BotManager {
  private readonly store: SupabaseStateStore;
  private readonly logger: Logger;
  private readonly alerting?: AlertingAdapter;
  private readonly bots: Map<string, ManagedBot> = new Map();
  /** Counts consecutive crash restarts per bot (reset after a successful auto-restart). */
  private readonly crashRestartByBot: Map<string, number> = new Map();
  private readonly debounceMs = 400;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeChannel: ReturnType<SupabaseStateStore["client"]["channel"]> | null = null;

  public constructor(options: BotManagerOptions) {
    this.store = options.store;
    this.logger = options.logger;
    if (options.alerting !== undefined) {
      this.alerting = options.alerting;
    }
  }

  /**
   * Subscribe to Realtime `configs` changes for start/stop/restart.
   */
  public subscribeConfigRealtime(): void {
    const ch = this.store.client
      .channel("configs-control-plane")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "configs" },
        (payload: { eventType: string; new: unknown; old: unknown }) => {
          this.scheduleConfigResync(payload);
        }
      )
      .subscribe((status) => {
        this.logger.info(`Realtime configs subscription: ${status}`, { event: "realtime_configs", status });
      });

    this.realtimeChannel = ch;
  }

  /**
   * Auto-start every enabled config from Supabase.
   */
  public async startAll(): Promise<void> {
    const rows = await this.store.fetchEnabledConfigRows();

    if (rows.length === 0) {
      this.logger.warn("No enabled configs in Supabase — server runs with zero bots.", {
        event: "server_no_configs"
      });
      return;
    }

    this.logger.info(`Auto-starting ${String(rows.length)} bot(s) from Supabase...`, {
      event: "server_autostart",
      count: rows.length
    });

    for (const row of rows) {
      try {
        await this.startBotForConfigRow(row);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to start bot for config ${row.id}: ${msg}`, {
          event: "server_bot_start_failed",
          configId: row.id
        });
      }
    }
  }

  /**
   * Start a bot by config display name (Telegram and tooling).
   */
  public async startBotByConfigName(name: string): Promise<string> {
    const { data, error } = await this.store.client
      .from("configs")
      .select("*")
      .eq("name", name)
      .limit(2);

    if (error !== null) {
      throw new Error(`Config lookup failed: ${error.message}`);
    }

    const rows = (data ?? []) as ConfigRow[];
    if (rows.length === 0) {
      throw new Error(`No config found with name "${name}".`);
    }
    if (rows.length > 1) {
      throw new Error(`Multiple configs match name "${name}" — disambiguate in Supabase.`);
    }

    const row = rows[0];
    if (row === undefined) {
      throw new Error(`No config found with name "${name}".`);
    }

    return await this.startBotForConfigRow(row);
  }

  /**
   * Start managed bot from a `configs` row.
   */
  public async startBotForConfigRow(row: ConfigRow): Promise<string> {
    const config = configRowToBotConfig(row);
    const botId = await this.store.ensureBotRowForConfigId(row.id);
    return await this.spawnTradingBot(botId, row.id, config);
  }

  /**
   * Core spawn: upserts bot row, constructs TradingBot, runs loop in background.
   */
  private async spawnTradingBot(botId: string, configId: string, config: BotConfig): Promise<string> {
    if (this.bots.has(botId)) {
      throw new Error(`Bot already running: ${botId}`);
    }

    await this.store.upsertBot(botId, config);

    const logger = new Logger(botId, `${process.cwd()}/logs`);
    const strategy = createStrategy(config.strategy, config.params);
    const exchange = buildExchangeAdapter(config);

    const bot = new TradingBot({
      botId,
      config,
      strategy,
      exchange,
      stateManager: this.store,
      logger,
      ...(this.alerting !== undefined ? { alerting: this.alerting } : {})
    });

    const managed: ManagedBot = {
      botId,
      configId,
      config,
      bot,
      startedAt: new Date()
    };

    this.bots.set(botId, managed);

    this.logger.info(`Starting bot: ${config.name}`, {
      event: "server_bot_started",
      botId,
      strategy: config.strategy,
      symbol: config.symbol
    });

    void bot
      .start()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Bot ${botId} crashed: ${msg}`, {
          event: "server_bot_crashed",
          botId
        });
        this.scheduleAutoRestartAfterCrash({ botId, configId });
      })
      .finally(() => {
        this.bots.delete(botId);
      });

    return botId;
  }

  /**
   * When `BOT_AUTO_RESTART=true`, restarts a crashed bot with exponential backoff up to `BOT_AUTO_RESTART_MAX` attempts.
   */
  private scheduleAutoRestartAfterCrash(args: Readonly<{ botId: string; configId: string }>): void {
    const flag = process.env["BOT_AUTO_RESTART"];
    if (flag !== "1" && flag !== "true") {
      return;
    }
    const maxRaw = process.env["BOT_AUTO_RESTART_MAX"] ?? "3";
    const maxAttempts = Math.max(0, parseInt(maxRaw, 10) || 0);
    if (maxAttempts === 0) {
      return;
    }
    const prev = this.crashRestartByBot.get(args.botId) ?? 0;
    const next = prev + 1;
    if (next > maxAttempts) {
      this.logger.warn(`Bot ${args.botId} exceeded auto-restart limit (${String(maxAttempts)})`, {
        event: "bot_auto_restart_exhausted",
        botId: args.botId
      });
      return;
    }
    this.crashRestartByBot.set(args.botId, next);
    const delayMs = Math.min(120_000, 2000 * 2 ** (next - 1));
    this.logger.info(`Scheduling bot auto-restart in ${String(delayMs)}ms (attempt ${String(next)})`, {
      event: "bot_auto_restart_scheduled",
      botId: args.botId,
      configId: args.configId
    });
    setTimeout(() => {
      void this.attemptRestartAfterCrash(args);
    }, delayMs);
  }

  private async attemptRestartAfterCrash(args: Readonly<{ botId: string; configId: string }>): Promise<void> {
    if (this.bots.has(args.botId)) {
      return;
    }
    const { data: row, error } = await this.store.client.from("configs").select("*").eq("id", args.configId).maybeSingle();
    if (error !== null || row === null) {
      return;
    }
    const cfgRow = row as ConfigRow;
    if (!cfgRow.enabled) {
      this.crashRestartByBot.delete(args.botId);
      return;
    }
    try {
      await this.startBotForConfigRow(cfgRow);
      this.logger.info(`Bot ${args.botId} auto-restarted after crash`, { event: "bot_auto_restart_ok", botId: args.botId });
      this.crashRestartByBot.delete(args.botId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Auto-restart failed for ${args.botId}: ${msg}`, {
        event: "bot_auto_restart_failed",
        botId: args.botId
      });
    }
  }

  /**
   * Stop a running bot and set `configs.enabled = false`.
   */
  public async stopBot(botId: string): Promise<boolean> {
    const managed = this.bots.get(botId);
    if (managed === undefined) {
      return false;
    }
    await managed.bot.stop();
    this.bots.delete(botId);
    await this.store.setConfigEnabled(managed.configId, false);

    this.logger.info(`Bot ${botId} stopped; config disabled in Supabase.`, {
      event: "server_bot_stopped",
      botId
    });

    return true;
  }

  /**
   * Stop all running bots (shutdown); does not disable configs in DB.
   */
  public async stopAll(): Promise<void> {
    const ids = [...this.bots.keys()];
    for (const id of ids) {
      const managed = this.bots.get(id);
      if (managed !== undefined) {
        await managed.bot.stop();
        this.bots.delete(id);
      }
    }
  }

  public listRunning(): readonly ManagedBot[] {
    return [...this.bots.values()];
  }

  /**
   * Config names present in Supabase (for Telegram startup summary).
   */
  public async listAvailableConfigNames(): Promise<string[]> {
    const { data, error } = await this.store.client.from("configs").select("name").order("name");

    if (error !== null) {
      this.logger.error("listAvailableConfigNames failed", { error: error.message });
      return [];
    }

    const names = (data ?? [])
      .map((r) => (r as { name: string }).name)
      .filter((n) => typeof n === "string" && n.length > 0);
    return [...new Set(names)];
  }

  private scheduleConfigResync(payload: { eventType: string; new: unknown; old: unknown }): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.applyConfigChange(payload);
    }, this.debounceMs);
  }

  private async applyConfigChange(payload: { eventType: string; new: unknown; old: unknown }): Promise<void> {
    const configId =
      payload.new !== null && typeof payload.new === "object" && "id" in payload.new
        ? String((payload.new as { id: string }).id)
        : payload.old !== null && typeof payload.old === "object" && "id" in payload.old
          ? String((payload.old as { id: string }).id)
          : null;

    if (configId === null) {
      return;
    }

    if (payload.eventType === "DELETE") {
      for (const [botId, m] of this.bots) {
        if (m.configId === configId) {
          await this.stopBotWithoutDisabling(botId);
        }
      }
      return;
    }

    const { data: row, error } = await this.store.client
      .from("configs")
      .select("*")
      .eq("id", configId)
      .maybeSingle();

    if (error !== null || row === null) {
      this.logger.warn("Realtime config refetch failed", { error: error?.message, configId });
      return;
    }

    const cfgRow = row as ConfigRow;
    const running = [...this.bots.values()].find((m) => m.configId === configId);

    if (!cfgRow.enabled) {
      if (running !== undefined) {
        await this.stopBotWithoutDisabling(running.botId);
      }
      return;
    }

    if (running !== undefined) {
      await this.stopBotWithoutDisabling(running.botId);
    }

    try {
      await this.startBotForConfigRow(cfgRow);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Realtime restart failed for ${configId}: ${msg}`, {
        event: "realtime_config_restart_failed",
        configId
      });
    }
  }

  /**
   * Stop runtime bot only (used when config updated or deleted; `enabled` already reflects intent).
   */
  private async stopBotWithoutDisabling(botId: string): Promise<void> {
    const managed = this.bots.get(botId);
    if (managed === undefined) {
      return;
    }
    await managed.bot.stop();
    this.bots.delete(botId);
  }
}
