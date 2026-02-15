# Supabase schema + migrations plan

## Purpose

Define the database “source of truth” entities so future agents can:

- Create migrations
- Implement API endpoints
- Persist and query backtest runs and results

Database: Supabase (Postgres).

## Design principles

- Use UUID primary keys.
- Store timestamps as `timestamptz`.
- Prefer JSONB for strategy params payload (versioned).
- Avoid storing large per-bar equity curves if not needed; store compressed data or per-trade equity, with optional expansion later.

## Tables (Phase 1)

### `parameter_sets`

Stores strategy configuration as a versioned JSONB blob.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `name` text not null
- `description` text null
- `params_version` text not null (e.g., "1.0")
- `params` jsonb not null (must match schema from `12-strategy-orb-atr.md`)
- `is_deleted` boolean not null default false

Indexes:

- `parameter_sets(is_deleted)`
- `parameter_sets(updated_at desc)`

### `backtest_runs`

Stores run metadata and summary.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `status` text not null (queued/running/completed/failed)
- `parameter_set_id` uuid null FK -> parameter_sets(id)
- `params_snapshot` jsonb not null (exact params used in this run)
- `symbol` text not null
- `interval` text not null
- `start_time_utc` timestamptz not null
- `end_time_utc` timestamptz not null
- `initial_equity` numeric not null
- `final_equity` numeric null
- `total_return_pct` numeric null
- `max_drawdown_pct` numeric null
- `win_rate_pct` numeric null
- `profit_factor` numeric null
- `trade_count` integer null
- `data_source` text not null default "yfinance"
- `data_fingerprint` jsonb not null (row count, min/max ts, checksum if available)
- `error_message` text null

Indexes:

- `backtest_runs(created_at desc)`
- `backtest_runs(status)`
- `backtest_runs(symbol, interval, start_time_utc, end_time_utc)`

### `backtest_trades`

Stores trades for a run.

Columns:

- `id` uuid PK
- `run_id` uuid not null FK -> backtest_runs(id)
- `session_date_ny` date not null
- `direction` text not null ("long" | "short")
- `entry_time_utc` timestamptz not null
- `entry_price` numeric not null
- `exit_time_utc` timestamptz not null
- `exit_price` numeric not null
- `quantity` numeric not null
- `fee_total` numeric not null
- `pnl` numeric not null
- `r_multiple` numeric null
- `exit_reason` text not null

Indexes:

- `backtest_trades(run_id, entry_time_utc)`
- `backtest_trades(run_id, session_date_ny)`

### `backtest_equity_points` (optional initially)

If we store equity per bar (or compressed):

- `id` uuid PK
- `run_id` uuid not null FK -> backtest_runs(id)
- `time_utc` timestamptz not null
- `equity` numeric not null

Indexes:

- `backtest_equity_points(run_id, time_utc)`

### `run_events`

Stores structured events/logs for runs.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `run_id` uuid not null FK -> backtest_runs(id)
- `level` text not null ("info" | "warn" | "error")
- `code` text not null (e.g., "DATA_QUALITY_MISSING_OPENING_RANGE")
- `message` text not null
- `context` jsonb not null default '{}'::jsonb

Indexes:

- `run_events(run_id, created_at)`

## Tables (Phase 2 - Live Trading) ✅

**Status**: Implemented in migration `0002_phase2_live_trading.sql`

### `bots`

Stores live trading bot configuration and state.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `name` text not null unique (enforced by `0003_add_bots_unique_name.sql`)
- `status` text not null (stopped | starting | running | stopping | error | paused)
- `exchange` text not null (bitunix | paper)
- `symbol` text not null
- `interval` text not null
- `params_snapshot` jsonb not null (StrategyParams from backtest system)
- `initial_balance` numeric not null
- `current_balance` numeric null
- `current_equity` numeric null
- `max_daily_loss_pct` numeric not null default 5
- `max_position_size_pct` numeric not null default 100
- `error_message` text null
- `error_count` integer not null default 0
- `last_heartbeat_at` timestamptz null
- `started_at` timestamptz null
- `stopped_at` timestamptz null

Indexes:

- `bots(status)`
- `bots(exchange)`
- `bots(last_heartbeat_at)`
- `bots(name)` unique

### `live_orders`

Stores all order activity (submitted, filled, cancelled, rejected).

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `bot_id` uuid not null FK -> bots(id) ON DELETE CASCADE
- `exchange` text not null
- `exchange_order_id` text null
- `client_order_id` text not null unique
- `symbol` text not null
- `side` text not null (buy | sell)
- `type` text not null (market | limit | stop_loss | take_profit)
- `status` text not null (pending | submitted | partial | filled | cancelled | rejected | error)
- `quantity` numeric not null
- `price` numeric null
- `stop_price` numeric null
- `filled_quantity` numeric not null default 0
- `avg_fill_price` numeric null
- `fee_paid` numeric not null default 0
- `fee_currency` text null
- `time_in_force` text not null default 'GTC'
- `request_payload` jsonb not null
- `exchange_response` jsonb null
- `error_message` text null
- `submitted_at` timestamptz null
- `filled_at` timestamptz null
- `cancelled_at` timestamptz null
- `parent_position_id` uuid null FK -> live_positions(id) ON DELETE SET NULL

Indexes:

- `live_orders(bot_id, created_at desc)`
- `live_orders(exchange_order_id)`
- `live_orders(client_order_id)` unique
- `live_orders(status)`
- `live_orders(symbol, side)`

### `live_positions`

Stores currently open positions with real-time P&L tracking.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `bot_id` uuid not null FK -> bots(id) ON DELETE CASCADE
- `exchange` text not null
- `symbol` text not null
- `direction` text not null (long | short)
- `status` text not null (open | closing | closed)
- `entry_order_id` uuid not null FK -> live_orders(id) ON DELETE SET NULL
- `entry_time` timestamptz not null
- `entry_price` numeric not null
- `quantity` numeric not null
- `stop_loss_price` numeric null
- `take_profit_price` numeric null
- `trailing_stop_price` numeric null
- `stop_order_id` uuid null FK -> live_orders(id) ON DELETE SET NULL
- `tp_order_id` uuid null FK -> live_orders(id) ON DELETE SET NULL
- `current_price` numeric null
- `unrealized_pnl` numeric not null default 0
- `realized_pnl` numeric not null default 0
- `fee_total` numeric not null default 0
- `risk_amount` numeric not null
- `r_multiple` numeric null
- `session_date_ny` date not null
- `closed_at` timestamptz null
- `exit_reason` text null

Indexes:

- `live_positions(bot_id, status)`
- `live_positions(symbol, status)`
- `live_positions(session_date_ny)`

### `live_trades`

Archived completed trades (read-only history).

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `bot_id` uuid not null FK -> bots(id) ON DELETE CASCADE
- `position_id` uuid null FK -> live_positions(id) ON DELETE SET NULL
- `exchange` text not null
- `symbol` text not null
- `direction` text not null (long | short)
- `entry_time` timestamptz not null
- `entry_price` numeric not null
- `exit_time` timestamptz not null
- `exit_price` numeric not null
- `quantity` numeric not null
- `fee_total` numeric not null
- `pnl` numeric not null
- `r_multiple` numeric null
- `exit_reason` text not null
- `session_date_ny` date not null
- `entry_order_id` uuid null FK -> live_orders(id) ON DELETE SET NULL
- `exit_order_id` uuid null FK -> live_orders(id) ON DELETE SET NULL
- `max_favorable_excursion` numeric null
- `max_adverse_excursion` numeric null

Indexes:

- `live_trades(bot_id, entry_time desc)`
- `live_trades(symbol, session_date_ny)`
- `live_trades(exit_reason)`

### `bot_logs`

Detailed event logging for debugging and monitoring.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `bot_id` uuid not null FK -> bots(id) ON DELETE CASCADE
- `level` text not null (debug | info | warn | error | critical)
- `category` text not null (signal | order | position | risk | system)
- `message` text not null
- `context` jsonb not null default '{}'::jsonb
- `position_id` uuid null FK -> live_positions(id) ON DELETE SET NULL
- `order_id` uuid null FK -> live_orders(id) ON DELETE SET NULL

Indexes:

- `bot_logs(bot_id, created_at desc)`
- `bot_logs(level, created_at desc)`
- `bot_logs(category)`

### `account_snapshots`

Periodic equity snapshots for performance tracking.

Columns:

- `id` uuid PK
- `created_at` timestamptz not null default now()
- `bot_id` uuid not null FK -> bots(id) ON DELETE CASCADE
- `exchange` text not null
- `balance` numeric not null
- `equity` numeric not null
- `open_positions_count` integer not null
- `total_unrealized_pnl` numeric not null
- `daily_pnl` numeric null
- `total_pnl_since_start` numeric null
- `snapshot_type` text not null (periodic | session_start | session_end | manual)

Indexes:

- `account_snapshots(bot_id, created_at desc)`
- `account_snapshots(snapshot_type)`

## Migration conventions (authoritative)

When generating migrations:

- Use a numbered prefix:
  - `0001_init.sql`
  - `0002_add_backtest_runs.sql`
- Each migration must be idempotent if possible (or clearly ordered).
- Include:
  - table definitions
  - indexes
  - foreign keys
  - triggers for `updated_at` (optional but recommended)

## RLS (Row Level Security)

### Single-client decision (current)

This project is **single-client** initially.

- Do **not** add `user_id` columns in Phase 1 tables.
- Do **not** enable RLS initially (keep it simple).
- If/when we become multi-tenant later, we will add `user_id` and RLS policies in a migration.

### If this becomes multi-tenant (future)

- Enable RLS on all user-owned tables.
- Add `user_id` column and policies accordingly.


