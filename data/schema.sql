-- SQLite schema for DSTB core state management
-- Tables: bots, positions, trades, orders

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  initial_balance REAL NOT NULL,
  current_equity REAL NOT NULL,
  status TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_heartbeat INTEGER
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  entry_time INTEGER NOT NULL,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl REAL NOT NULL,
  r_multiple REAL,
  entry_time INTEGER NOT NULL,
  exit_time INTEGER NOT NULL,
  exit_reason TEXT,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  client_order_id TEXT UNIQUE NOT NULL,
  exchange_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  filled_at INTEGER,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE INDEX IF NOT EXISTS idx_positions_bot_id ON positions(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_exit_time ON trades(exit_time);
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id);
