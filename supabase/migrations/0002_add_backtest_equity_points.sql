/*
  Phase 1 (Backtesting) - Optional equity curve points

  Source of truth:
  - docs/17-supabase-schema-and-migrations.md

  Notes:
  - This is intentionally a separate migration so it can be omitted/removed later
    if we decide not to persist per-bar equity curves.
*/

create table if not exists public.backtest_equity_points (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  time_utc timestamptz not null,
  equity numeric not null,

  constraint fk_backtest_equity_points_run
    foreign key (run_id)
    references public.backtest_runs (id)
    on delete cascade
);

create index if not exists idx_backtest_equity_points_run_id_time_utc
  on public.backtest_equity_points (run_id, time_utc);





