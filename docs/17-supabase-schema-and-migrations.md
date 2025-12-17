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

## Tables (Phase 2 - future)

- `bots`
- `bot_runs`
- `orders`
- `fills`
- `positions`
- `bot_events`

These will be added once live trading begins.

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


