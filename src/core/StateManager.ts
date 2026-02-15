import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Logger } from "./Logger";
import {
  Bot,
  BotConfig,
  BotStatus,
  Order,
  OrderStatus,
  Position,
  PositionSide,
  Trade
} from "./types";

/**
 * Configuration options for StateManager initialization.
 */
export type StateManagerOptions = {
  dbPath: string;
  schemaPath: string;
  backupDir?: string;
  backupRetentionDays?: number;
  logger: Logger;
};

/**
 * StateManager provides SQLite-backed persistence with transactional safety.
 */
export class StateManager {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private readonly schemaPath: string;
  private readonly backupDir: string;
  private readonly backupRetentionDays: number;
  private readonly logger: Logger;

  /**
   * Initialize SQLite database and load schema.
   *
   * Inputs:
   * - options.dbPath: SQLite file path.
   * - options.schemaPath: SQL schema path.
   *
   * Outputs:
   * - Initialized StateManager instance.
   *
   * Error behavior:
   * - Catches and logs initialization errors, but rethrows to prevent silent misuse.
   */
  constructor(options: StateManagerOptions) {
    this.dbPath = options.dbPath;
    this.schemaPath = options.schemaPath;
    this.backupDir = options.backupDir ?? path.join(path.dirname(this.dbPath), "backups");
    this.backupRetentionDays = options.backupRetentionDays ?? 30;
    this.logger = options.logger;

    // Ensure the DB directory exists before opening.
    this.ensureDirectory(path.dirname(this.dbPath));
    this.ensureDirectory(this.backupDir);

    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  /**
   * Create a new bot record.
   *
   * Inputs:
   * - bot: BotConfig for the new bot.
   *
   * Outputs:
   * - Newly created bot ID.
   *
   * Error behavior:
   * - Logs error and returns empty string on failure.
   */
  async createBot(bot: BotConfig): Promise<string> {
    return this.runTransaction(
      () => {
        const id = randomUUID();
        const now = Date.now();
        const statement = this.db.prepare(
          [
            "INSERT INTO bots (id, name, strategy, initial_balance, current_equity, status, config, created_at, last_heartbeat)",
            "VALUES (@id, @name, @strategy, @initialBalance, @currentEquity, @status, @config, @createdAt, @lastHeartbeat)"
          ].join(" ")
        );

        // Store config as JSON string to preserve all settings.
        statement.run({
          id,
          name: bot.name,
          strategy: bot.strategy,
          initialBalance: bot.initialBalance,
          currentEquity: bot.initialBalance,
          status: "running",
          config: JSON.stringify(bot),
          createdAt: now,
          lastHeartbeat: now
        });

        return id;
      },
      "",
      "createBot"
    );
  }

  /**
   * Fetch a bot by ID.
   *
   * Inputs:
   * - id: Bot ID.
   *
   * Outputs:
   * - Bot or null if not found.
   *
   * Error behavior:
   * - Logs error and returns null on failure.
   */
  async getBot(id: string): Promise<Bot | null> {
    return this.runTransaction(
      () => {
        const statement = this.db.prepare("SELECT * FROM bots WHERE id = @id");
        const row = statement.get({ id }) as
          | {
              id: string;
              name: string;
              strategy: string;
              initial_balance: number;
              current_equity: number;
              status: string;
              config: string;
              created_at: number;
              last_heartbeat: number | null;
            }
          | undefined;

        if (row === undefined) {
          return null;
        }

        // Parse JSON config safely.
        const config = this.parseJson<BotConfig>(row.config, "getBot");
        if (config === null) {
          return null;
        }

        return {
          id: row.id,
          name: row.name,
          strategy: row.strategy,
          initialBalance: row.initial_balance,
          currentEquity: row.current_equity,
          status: row.status as Bot["status"],
          config,
          createdAt: row.created_at,
          lastHeartbeat: row.last_heartbeat ?? undefined
        };
      },
      null,
      "getBot"
    );
  }

  /**
   * Fetch all bots.
   *
   * Inputs:
   * - None.
   *
   * Outputs:
   * - Array of bots.
   *
   * Error behavior:
   * - Logs error and returns empty array on failure.
   */
  async getAllBots(): Promise<Bot[]> {
    return this.runTransaction(
      () => {
        const statement = this.db.prepare("SELECT * FROM bots ORDER BY created_at ASC");
        const rows = statement.all() as Array<{
          id: string;
          name: string;
          strategy: string;
          initial_balance: number;
          current_equity: number;
          status: string;
          config: string;
          created_at: number;
          last_heartbeat: number | null;
        }>;

        return rows
          .map((row) => {
            const config = this.parseJson<BotConfig>(row.config, "getAllBots");
            if (config === null) {
              return null;
            }

            return {
              id: row.id,
              name: row.name,
              strategy: row.strategy,
              initialBalance: row.initial_balance,
              currentEquity: row.current_equity,
              status: row.status as Bot["status"],
              config,
              createdAt: row.created_at,
              lastHeartbeat: row.last_heartbeat ?? undefined
            };
          })
          .filter((bot): bot is Bot => bot !== null);
      },
      [],
      "getAllBots"
    );
  }

  /**
   * Update bot status.
   *
   * Inputs:
   * - id: Bot ID.
   * - status: New bot status.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async updateBotStatus(id: string, status: BotStatus): Promise<void> {
    this.runTransaction(
      () => {
        const statement = this.db.prepare(
          "UPDATE bots SET status = @status WHERE id = @id"
        );
        statement.run({ id, status });
      },
      undefined,
      "updateBotStatus"
    );
  }

  /**
   * Update bot equity.
   *
   * Inputs:
   * - id: Bot ID.
   * - equity: New equity value.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async updateBotEquity(id: string, equity: number): Promise<void> {
    this.runTransaction(
      () => {
        const statement = this.db.prepare(
          "UPDATE bots SET current_equity = @equity WHERE id = @id"
        );
        statement.run({ id, equity });
      },
      undefined,
      "updateBotEquity"
    );
  }

  /**
   * Update bot heartbeat timestamp.
   *
   * Inputs:
   * - id: Bot ID.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async updateBotHeartbeat(id: string): Promise<void> {
    this.runTransaction(
      () => {
        const statement = this.db.prepare(
          "UPDATE bots SET last_heartbeat = @lastHeartbeat WHERE id = @id"
        );
        statement.run({ id, lastHeartbeat: Date.now() });
      },
      undefined,
      "updateBotHeartbeat"
    );
  }

  /**
   * Create a new position.
   *
   * Inputs:
   * - position: Position to insert.
   *
   * Outputs:
   * - Newly created position ID.
   *
   * Error behavior:
   * - Logs error and returns empty string on failure.
   */
  async createPosition(position: Position): Promise<string> {
    return this.runTransaction(
      () => {
        const id = randomUUID();
        const statement = this.db.prepare(
          [
            "INSERT INTO positions (id, bot_id, symbol, side, quantity, entry_price, stop_loss, take_profit, entry_time)",
            "VALUES (@id, @botId, @symbol, @side, @quantity, @entryPrice, @stopLoss, @takeProfit, @entryTime)"
          ].join(" ")
        );

        statement.run({
          id,
          botId: position.botId,
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          stopLoss: position.stopLoss ?? null,
          takeProfit: position.takeProfit ?? null,
          entryTime: position.entryTime
        });

        return id;
      },
      "",
      "createPosition"
    );
  }

  /**
   * Get open positions for a bot.
   *
   * Inputs:
   * - botId: Bot ID.
   *
   * Outputs:
   * - Array of open positions.
   *
   * Error behavior:
   * - Logs error and returns empty array on failure.
   */
  async getOpenPositions(botId: string): Promise<Position[]> {
    return this.runTransaction(
      () => {
        const statement = this.db.prepare("SELECT * FROM positions WHERE bot_id = @botId");
        const rows = statement.all({ botId }) as Array<{
          id: string;
          bot_id: string;
          symbol: string;
          side: string;
          quantity: number;
          entry_price: number;
          stop_loss: number | null;
          take_profit: number | null;
          entry_time: number;
        }>;

        return rows.map((row) => ({
          id: row.id,
          botId: row.bot_id,
          symbol: row.symbol,
          side: row.side as PositionSide,
          quantity: row.quantity,
          entryPrice: row.entry_price,
          stopLoss: row.stop_loss ?? undefined,
          takeProfit: row.take_profit ?? undefined,
          entryTime: row.entry_time
        }));
      },
      [],
      "getOpenPositions"
    );
  }

  /**
   * Update an existing position with partial fields.
   *
   * Inputs:
   * - id: Position ID.
   * - updates: Partial position updates.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async updatePosition(id: string, updates: Partial<Position>): Promise<void> {
    this.runTransaction(
      () => {
        const fields: string[] = [];
        const values: Record<string, unknown> = { id };

        // Build the update statement dynamically based on provided fields.
        if (updates.symbol !== undefined) {
          fields.push("symbol = @symbol");
          values.symbol = updates.symbol;
        }

        if (updates.side !== undefined) {
          fields.push("side = @side");
          values.side = updates.side;
        }

        if (updates.quantity !== undefined) {
          fields.push("quantity = @quantity");
          values.quantity = updates.quantity;
        }

        if (updates.entryPrice !== undefined) {
          fields.push("entry_price = @entryPrice");
          values.entryPrice = updates.entryPrice;
        }

        if (updates.stopLoss !== undefined) {
          fields.push("stop_loss = @stopLoss");
          values.stopLoss = updates.stopLoss;
        }

        if (updates.takeProfit !== undefined) {
          fields.push("take_profit = @takeProfit");
          values.takeProfit = updates.takeProfit;
        }

        if (updates.entryTime !== undefined) {
          fields.push("entry_time = @entryTime");
          values.entryTime = updates.entryTime;
        }

        if (fields.length === 0) {
          return;
        }

        const statement = this.db.prepare(
          ["UPDATE positions SET", fields.join(", "), "WHERE id = @id"].join(" ")
        );
        statement.run(values);
      },
      undefined,
      "updatePosition"
    );
  }

  /**
   * Close a position and write a trade record.
   *
   * Inputs:
   * - id: Position ID.
   * - exitPrice: Exit price.
   * - reason: Exit reason.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async closePosition(id: string, exitPrice: number, reason: string): Promise<void> {
    this.runTransaction(
      () => {
        const now = Date.now();
        const positionStatement = this.db.prepare("SELECT * FROM positions WHERE id = @id");
        const position = positionStatement.get({ id }) as
          | {
              id: string;
              bot_id: string;
              symbol: string;
              side: string;
              quantity: number;
              entry_price: number;
              stop_loss: number | null;
              take_profit: number | null;
              entry_time: number;
            }
          | undefined;

        if (position === undefined) {
          return;
        }

        // Compute PnL based on position side.
        const pnl =
          position.side === "LONG"
            ? (exitPrice - position.entry_price) * position.quantity
            : (position.entry_price - exitPrice) * position.quantity;

        // Compute optional R multiple when stop loss is available.
        const rMultiple = this.computeRMultiple(
          position.side as PositionSide,
          position.entry_price,
          exitPrice,
          position.stop_loss ?? undefined
        );

        const tradeStatement = this.db.prepare(
          [
            "INSERT INTO trades (id, bot_id, symbol, side, quantity, entry_price, exit_price, pnl, r_multiple, entry_time, exit_time, exit_reason)",
            "VALUES (@id, @botId, @symbol, @side, @quantity, @entryPrice, @exitPrice, @pnl, @rMultiple, @entryTime, @exitTime, @exitReason)"
          ].join(" ")
        );

        tradeStatement.run({
          id: randomUUID(),
          botId: position.bot_id,
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          entryPrice: position.entry_price,
          exitPrice,
          pnl,
          rMultiple: rMultiple ?? null,
          entryTime: position.entry_time,
          exitTime: now,
          exitReason: reason
        });

        const deleteStatement = this.db.prepare("DELETE FROM positions WHERE id = @id");
        deleteStatement.run({ id });
      },
      undefined,
      "closePosition"
    );
  }

  /**
   * Save a trade record.
   *
   * Inputs:
   * - trade: Trade details (ID will be generated).
   *
   * Outputs:
   * - Newly created trade ID.
   *
   * Error behavior:
   * - Logs error and returns empty string on failure.
   */
  async saveTrade(trade: Trade): Promise<string> {
    return this.runTransaction(
      () => {
        const id = randomUUID();
        const statement = this.db.prepare(
          [
            "INSERT INTO trades (id, bot_id, symbol, side, quantity, entry_price, exit_price, pnl, r_multiple, entry_time, exit_time, exit_reason)",
            "VALUES (@id, @botId, @symbol, @side, @quantity, @entryPrice, @exitPrice, @pnl, @rMultiple, @entryTime, @exitTime, @exitReason)"
          ].join(" ")
        );

        statement.run({
          id,
          botId: trade.botId,
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          pnl: trade.pnl,
          rMultiple: trade.rMultiple ?? null,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          exitReason: trade.exitReason ?? null
        });

        return id;
      },
      "",
      "saveTrade"
    );
  }

  /**
   * Fetch trades for a bot, optionally filtered by last N days.
   *
   * Inputs:
   * - botId: Bot ID.
   * - days: Optional number of days to include.
   *
   * Outputs:
   * - Array of trades.
   *
   * Error behavior:
   * - Logs error and returns empty array on failure.
   */
  async getTrades(botId: string, days?: number): Promise<Trade[]> {
    return this.runTransaction(
      () => {
        if (days !== undefined) {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const statement = this.db.prepare(
            "SELECT * FROM trades WHERE bot_id = @botId AND exit_time >= @cutoff ORDER BY exit_time DESC"
          );

          return this.mapTrades(
            statement.all({ botId, cutoff }) as Array<Record<string, unknown>>
          );
        }

        const statement = this.db.prepare(
          "SELECT * FROM trades WHERE bot_id = @botId ORDER BY exit_time DESC"
        );
        return this.mapTrades(statement.all({ botId }) as Array<Record<string, unknown>>);
      },
      [],
      "getTrades"
    );
  }

  /**
   * Create an order record.
   *
   * Inputs:
   * - order: Order details (ID will be generated).
   *
   * Outputs:
   * - Newly created order ID.
   *
   * Error behavior:
   * - Logs error and returns empty string on failure.
   */
  async createOrder(order: Order): Promise<string> {
    return this.runTransaction(
      () => {
        const id = randomUUID();
        const statement = this.db.prepare(
          [
            "INSERT INTO orders (id, bot_id, client_order_id, exchange_order_id, symbol, side, quantity, price, status, created_at, filled_at)",
            "VALUES (@id, @botId, @clientOrderId, @exchangeOrderId, @symbol, @side, @quantity, @price, @status, @createdAt, @filledAt)"
          ].join(" ")
        );

        statement.run({
          id,
          botId: order.botId,
          clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeOrderId ?? null,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          price: order.price ?? null,
          status: order.status,
          createdAt: order.createdAt,
          filledAt: order.filledAt ?? null
        });

        return id;
      },
      "",
      "createOrder"
    );
  }

  /**
   * Update order status by client order ID.
   *
   * Inputs:
   * - clientOrderId: Client order ID.
   * - status: New order status.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async updateOrderStatus(clientOrderId: string, status: OrderStatus): Promise<void> {
    this.runTransaction(
      () => {
        const statement = this.db.prepare(
          "UPDATE orders SET status = @status WHERE client_order_id = @clientOrderId"
        );
        statement.run({ clientOrderId, status });
      },
      undefined,
      "updateOrderStatus"
    );
  }

  /**
   * Fetch an order by client order ID.
   *
   * Inputs:
   * - clientOrderId: Client order ID.
   *
   * Outputs:
   * - Order or null if not found.
   *
   * Error behavior:
   * - Logs error and returns null on failure.
   */
  async getOrder(clientOrderId: string): Promise<Order | null> {
    return this.runTransaction(
      () => {
        const statement = this.db.prepare("SELECT * FROM orders WHERE client_order_id = @clientOrderId");
        const row = statement.get({ clientOrderId }) as
          | {
              id: string;
              bot_id: string;
              client_order_id: string;
              exchange_order_id: string | null;
              symbol: string;
              side: string;
              quantity: number;
              price: number | null;
              status: string;
              created_at: number;
              filled_at: number | null;
            }
          | undefined;

        if (row === undefined) {
          return null;
        }

        return {
          id: row.id,
          botId: row.bot_id,
          clientOrderId: row.client_order_id,
          exchangeOrderId: row.exchange_order_id ?? undefined,
          symbol: row.symbol,
          side: row.side as PositionSide,
          quantity: row.quantity,
          price: row.price ?? undefined,
          status: row.status as OrderStatus,
          createdAt: row.created_at,
          filledAt: row.filled_at ?? undefined
        };
      },
      null,
      "getOrder"
    );
  }

  /**
   * Return all open positions across all bots.
   *
   * Inputs:
   * - None.
   *
   * Outputs:
   * - Array of open positions.
   *
   * Error behavior:
   * - Logs error and returns empty array on failure.
   */
  async getAllOpenPositions(): Promise<Position[]> {
    return this.runTransaction(
      () => {
        const statement = this.db.prepare("SELECT * FROM positions");
        const rows = statement.all() as Array<{
          id: string;
          bot_id: string;
          symbol: string;
          side: string;
          quantity: number;
          entry_price: number;
          stop_loss: number | null;
          take_profit: number | null;
          entry_time: number;
        }>;

        return rows.map((row) => ({
          id: row.id,
          botId: row.bot_id,
          symbol: row.symbol,
          side: row.side as PositionSide,
          quantity: row.quantity,
          entryPrice: row.entry_price,
          stopLoss: row.stop_loss ?? undefined,
          takeProfit: row.take_profit ?? undefined,
          entryTime: row.entry_time
        }));
      },
      [],
      "getAllOpenPositions"
    );
  }

  /**
   * Get daily PnL for a bot and date (YYYY-MM-DD).
   *
   * Inputs:
   * - botId: Bot ID.
   * - date: Local date string in YYYY-MM-DD format.
   *
   * Outputs:
   * - Sum of PnL for the day.
   *
   * Error behavior:
   * - Logs error and returns 0 on failure.
   */
  async getDailyPnL(botId: string, date: string): Promise<number> {
    return this.runTransaction(
      () => {
        const range = this.getDateRange(date);
        if (range === null) {
          return 0;
        }

        const statement = this.db.prepare(
          "SELECT SUM(pnl) as total_pnl FROM trades WHERE bot_id = @botId AND exit_time >= @start AND exit_time < @end"
        );
        const row = statement.get({ botId, start: range.start, end: range.end }) as
          | { total_pnl: number | null }
          | undefined;

        return row?.total_pnl ?? 0;
      },
      0,
      "getDailyPnL"
    );
  }

  /**
   * Create a database backup and prune old backups.
   *
   * Inputs:
   * - None.
   *
   * Outputs:
   * - void.
   *
   * Error behavior:
   * - Logs error on failure.
   */
  async backup(): Promise<void> {
    this.runTransaction(
      () => {
        const date = this.formatDate(new Date());
        const backupFile = path.join(this.backupDir, `bot-state-${date}.db`);

        // Copy the database file to the backup folder.
        fs.copyFileSync(this.dbPath, backupFile);

        // Remove backups older than retention window.
        this.pruneBackups();
      },
      undefined,
      "backup"
    );
  }

  /**
   * Initialize the schema from SQL file.
   */
  private initializeSchema(): void {
    try {
      const schemaSql = fs.readFileSync(this.schemaPath, "utf8");
      this.db.exec(schemaSql);
    } catch (error) {
      this.logger.error("Failed to initialize SQLite schema", {
        error: this.normalizeError(error),
        schemaPath: this.schemaPath
      });
      throw error;
    }
  }

  /**
   * Run an action inside a transaction with error handling.
   */
  private runTransaction<T>(action: () => T, fallback: T, context: string): T {
    try {
      const wrapped = this.db.transaction(() => action());
      return wrapped();
    } catch (error) {
      this.logger.error("SQLite operation failed", {
        context,
        error: this.normalizeError(error)
      });
      return fallback;
    }
  }

  /**
   * Parse JSON safely with logging.
   */
  private parseJson<T>(raw: string, context: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.error("Failed to parse JSON from SQLite", {
        context,
        error: this.normalizeError(error)
      });
      return null;
    }
  }

  /**
   * Convert DB trade rows into Trade objects.
   */
  private mapTrades(rows: Array<Record<string, unknown>>): Trade[] {
    return rows
      .map((row) => {
        const mapped = row as {
          id: string;
          bot_id: string;
          symbol: string;
          side: string;
          quantity: number;
          entry_price: number;
          exit_price: number;
          pnl: number;
          r_multiple: number | null;
          entry_time: number;
          exit_time: number;
          exit_reason: string | null;
        };

        return {
          id: mapped.id,
          botId: mapped.bot_id,
          symbol: mapped.symbol,
          side: mapped.side as PositionSide,
          quantity: mapped.quantity,
          entryPrice: mapped.entry_price,
          exitPrice: mapped.exit_price,
          pnl: mapped.pnl,
          rMultiple: mapped.r_multiple ?? undefined,
          entryTime: mapped.entry_time,
          exitTime: mapped.exit_time,
          exitReason: mapped.exit_reason ?? undefined
        };
      })
      .filter((trade) => trade.id.length > 0);
  }

  /**
   * Compute R multiple for a trade when stop loss is known.
   */
  private computeRMultiple(
    side: PositionSide,
    entryPrice: number,
    exitPrice: number,
    stopLoss?: number
  ): number | undefined {
    if (stopLoss === undefined) {
      return undefined;
    }

    const risk =
      side === "LONG" ? entryPrice - stopLoss : stopLoss - entryPrice;

    if (risk <= 0) {
      return undefined;
    }

    const reward =
      side === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;

    return reward / risk;
  }

  /**
   * Build date range for a given YYYY-MM-DD string.
   */
  private getDateRange(date: string): { start: number; end: number } | null {
    const parts = date.split("-");
    if (parts.length !== 3) {
      return null;
    }

    const [yearRaw, monthRaw, dayRaw] = parts;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }

    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

    return { start: start.getTime(), end: end.getTime() };
  }

  /**
   * Ensure a directory exists.
   */
  private ensureDirectory(directoryPath: string): void {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }

  /**
   * Remove old backups beyond retention window.
   */
  private pruneBackups(): void {
    const cutoff = Date.now() - this.backupRetentionDays * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(this.backupDir);

    entries.forEach((entry) => {
      const filePath = path.join(this.backupDir, entry);
      const stats = fs.statSync(filePath);

      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    });
  }

  /**
   * Format date as YYYY-MM-DD.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  /**
   * Normalize unknown errors for safe logging.
   */
  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "Unknown error";
  }
}
