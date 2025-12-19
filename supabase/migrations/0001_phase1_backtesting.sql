/*
  Phase 1 (Backtesting) - Core tables

  Source of truth:
  - docs/17-supabase-schema-and-migrations.md
  - docs/10-requirements.md

  Single-client rules (Phase 1):
  - NO user_id columns
  - NO RLS / policies

  Notes:
  - Postgres uses single quotes for string literals; double quotes are identifiers.
  - UUIDs are generated via gen_random_uuid() from pgcrypto.
*/

-- Ensure UUID generation is available (Supabase supports pgcrypto).
create extension if not exists pgcrypto;

/*
  Helper trigger function to automatically maintain updated_at columns.
  Using CREATE OR REPLACE keeps this idempotent across re-runs.
*/
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- parameter_sets
-- -----------------------------------------------------------------------------
create table if not exists public.parameter_sets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  description text null,
  params_version text not null,
  params jsonb not null,
  is_deleted boolean not null default false
);

-- updated_at trigger (idempotent): create only if missing.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_parameter_sets_set_updated_at'
  ) then
    create trigger trg_parameter_sets_set_updated_at
    before update on public.parameter_sets
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

create index if not exists idx_parameter_sets_is_deleted
  on public.parameter_sets (is_deleted);

create index if not exists idx_parameter_sets_updated_at_desc
  on public.parameter_sets (updated_at desc);

-- -----------------------------------------------------------------------------
-- backtest_runs
-- -----------------------------------------------------------------------------
create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Status is a text enum in Phase 1 (keep simple, no RLS).
  status text not null,

  -- Optional link to a saved parameter set (historical runs should remain even if the set is deleted).
  parameter_set_id uuid null,

  -- Exact params used for this run (snapshot is required for reproducibility).
  params_snapshot jsonb not null,

  -- Reproducibility requirement (docs/10-requirements.md):
  -- the run should be reproducible with the same engine version.
  engine_version text not null,

  -- Run inputs
  symbol text not null,
  interval text not null,
  start_time_utc timestamptz not null,
  end_time_utc timestamptz not null,

  -- Equity + metrics
  initial_equity numeric not null,
  final_equity numeric null,
  total_return_pct numeric null,
  max_drawdown_pct numeric null,
  win_rate_pct numeric null,
  profit_factor numeric null,
  trade_count integer null,

  -- Data provenance
  data_source text not null default 'yfinance',
  data_fingerprint jsonb not null,

  -- Error reporting
  error_message text null,

  constraint chk_backtest_runs_status
    check (status in ('queued', 'running', 'completed', 'failed')),

  constraint fk_backtest_runs_parameter_set
    foreign key (parameter_set_id)
    references public.parameter_sets (id)
    on delete set null
);

create index if not exists idx_backtest_runs_created_at_desc
  on public.backtest_runs (created_at desc);

create index if not exists idx_backtest_runs_status
  on public.backtest_runs (status);

create index if not exists idx_backtest_runs_symbol_interval_time_range
  on public.backtest_runs (symbol, interval, start_time_utc, end_time_utc);

-- -----------------------------------------------------------------------------
-- backtest_trades
-- -----------------------------------------------------------------------------
create table if not exists public.backtest_trades (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,

  -- Session identity (anchored to New York open; stored as NY calendar day).
  session_date_ny date not null,

  direction text not null,
  entry_time_utc timestamptz not null,
  entry_price numeric not null,
  exit_time_utc timestamptz not null,
  exit_price numeric not null,
  quantity numeric not null,
  fee_total numeric not null,
  pnl numeric not null,
  r_multiple numeric null,
  exit_reason text not null,

  constraint chk_backtest_trades_direction
    check (direction in ('long', 'short')),

  constraint fk_backtest_trades_run
    foreign key (run_id)
    references public.backtest_runs (id)
    on delete cascade
);

create index if not exists idx_backtest_trades_run_id_entry_time_utc
  on public.backtest_trades (run_id, entry_time_utc);

create index if not exists idx_backtest_trades_run_id_session_date_ny
  on public.backtest_trades (run_id, session_date_ny);

-- -----------------------------------------------------------------------------
-- run_events
-- -----------------------------------------------------------------------------
create table if not exists public.run_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid not null,
  level text not null,
  code text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,

  constraint chk_run_events_level
    check (level in ('info', 'warn', 'error')),

  constraint fk_run_events_run
    foreign key (run_id)
    references public.backtest_runs (id)
    on delete cascade
);

create index if not exists idx_run_events_run_id_created_at
  on public.run_events (run_id, created_at);

