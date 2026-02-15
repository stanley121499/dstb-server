/*
  Phase 2 (Live Trading) - Core tables

  Source of truth:
  - docs/17-supabase-schema-and-migrations.md
  - docs/10-requirements.md

  Single-client rules (Phase 2):
  - NO user_id columns
  - NO RLS / policies

  Notes:
  - Postgres uses single quotes for string literals; double quotes are identifiers.
  - UUIDs are generated via gen_random_uuid() from pgcrypto.
*/

-- -----------------------------------------------------------------------------
-- bots
-- -----------------------------------------------------------------------------
create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  status text not null,
  exchange text not null,
  symbol text not null,
  interval text not null,
  params_snapshot jsonb not null,
  initial_balance numeric not null,
  current_balance numeric not null,
  current_equity numeric not null,
  max_daily_loss_pct numeric not null,
  max_position_size_pct numeric not null,
  error_message text null,
  error_count integer not null default 0,
  last_heartbeat_at timestamptz null,
  started_at timestamptz null,
  stopped_at timestamptz null,

  constraint chk_bots_status
    check (status in ('stopped', 'starting', 'running', 'stopping', 'error', 'paused')),

  constraint chk_bots_exchange
    check (exchange in ('bitunix', 'paper'))
);

-- updated_at trigger (idempotent): create only if missing.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_bots_set_updated_at'
  ) then
    create trigger trg_bots_set_updated_at
    before update on public.bots
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

create index if not exists idx_bots_status
  on public.bots (status);

create index if not exists idx_bots_exchange
  on public.bots (exchange);

create index if not exists idx_bots_last_heartbeat_at
  on public.bots (last_heartbeat_at);

comment on table public.bots is 'Live trading bots with configuration and lifecycle state.';
comment on column public.bots.name is 'Human-readable bot name.';
comment on column public.bots.status is 'Bot lifecycle status.';
comment on column public.bots.exchange is 'Exchange identifier.';
comment on column public.bots.symbol is 'Trading symbol (e.g., BTCUSDT).';
comment on column public.bots.interval is 'Candle interval (e.g., 1m, 5m).';
comment on column public.bots.params_snapshot is 'Snapshot of strategy params used by the bot.';
comment on column public.bots.initial_balance is 'Starting account balance for the bot.';
comment on column public.bots.current_balance is 'Current account balance for the bot.';
comment on column public.bots.current_equity is 'Current account equity for the bot.';
comment on column public.bots.max_daily_loss_pct is 'Daily max loss threshold as a percent.';
comment on column public.bots.max_position_size_pct is 'Max position size as a percent of balance.';
comment on column public.bots.error_message is 'Last error message, if any.';
comment on column public.bots.error_count is 'Number of errors observed for the bot.';
comment on column public.bots.last_heartbeat_at is 'Last time the bot reported a heartbeat.';
comment on column public.bots.started_at is 'Time the bot started running.';
comment on column public.bots.stopped_at is 'Time the bot stopped running.';

-- -----------------------------------------------------------------------------
-- live_orders
-- -----------------------------------------------------------------------------
create table if not exists public.live_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bot_id uuid not null,
  exchange text not null,
  exchange_order_id text null,
  client_order_id text not null,
  symbol text not null,
  side text not null,
  type text not null,
  status text not null,
  quantity numeric not null,
  price numeric null,
  stop_price numeric null,
  filled_quantity numeric not null default 0,
  avg_fill_price numeric null,
  fee_paid numeric null,
  fee_currency text null,
  time_in_force text null,
  request_payload jsonb not null default '{}'::jsonb,
  exchange_response jsonb null,
  error_message text null,
  submitted_at timestamptz null,
  filled_at timestamptz null,
  cancelled_at timestamptz null,
  parent_position_id uuid null,

  constraint chk_live_orders_exchange
    check (exchange in ('bitunix', 'paper')),

  constraint chk_live_orders_side
    check (side in ('buy', 'sell')),

  constraint chk_live_orders_type
    check (type in ('market', 'limit', 'stop_loss', 'take_profit')),

  constraint chk_live_orders_status
    check (status in ('pending', 'submitted', 'partial', 'filled', 'cancelled', 'rejected', 'error')),

  constraint uq_live_orders_client_order_id
    unique (client_order_id),

  constraint fk_live_orders_bot
    foreign key (bot_id)
    references public.bots (id)
    on delete cascade
);

-- updated_at trigger (idempotent): create only if missing.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_live_orders_set_updated_at'
  ) then
    create trigger trg_live_orders_set_updated_at
    before update on public.live_orders
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

create index if not exists idx_live_orders_bot_id_created_at
  on public.live_orders (bot_id, created_at);

create index if not exists idx_live_orders_exchange_order_id
  on public.live_orders (exchange_order_id);

create index if not exists idx_live_orders_client_order_id
  on public.live_orders (client_order_id);

create index if not exists idx_live_orders_status
  on public.live_orders (status);

create index if not exists idx_live_orders_symbol_side
  on public.live_orders (symbol, side);

comment on table public.live_orders is 'All live order submissions and updates.';
comment on column public.live_orders.bot_id is 'Owning bot.';
comment on column public.live_orders.exchange is 'Exchange identifier.';
comment on column public.live_orders.exchange_order_id is 'Exchange-provided order ID.';
comment on column public.live_orders.client_order_id is 'Client-generated unique order ID.';
comment on column public.live_orders.side is 'Order side (buy/sell).';
comment on column public.live_orders.type is 'Order type (market/limit/stop_loss/take_profit).';
comment on column public.live_orders.status is 'Order lifecycle status.';
comment on column public.live_orders.quantity is 'Requested order quantity.';
comment on column public.live_orders.price is 'Limit price, when applicable.';
comment on column public.live_orders.stop_price is 'Stop price, when applicable.';
comment on column public.live_orders.filled_quantity is 'Cumulative filled quantity.';
comment on column public.live_orders.avg_fill_price is 'Average fill price across fills.';
comment on column public.live_orders.fee_paid is 'Total fee paid for the order.';
comment on column public.live_orders.fee_currency is 'Fee currency code.';
comment on column public.live_orders.time_in_force is 'Time-in-force policy from the exchange.';
comment on column public.live_orders.request_payload is 'Raw order request payload.';
comment on column public.live_orders.exchange_response is 'Raw exchange response payload.';
comment on column public.live_orders.error_message is 'Error message, if any.';
comment on column public.live_orders.submitted_at is 'Time order was submitted to exchange.';
comment on column public.live_orders.filled_at is 'Time order was fully filled.';
comment on column public.live_orders.cancelled_at is 'Time order was cancelled.';
comment on column public.live_orders.parent_position_id is 'Owning position for the order.';

-- -----------------------------------------------------------------------------
-- live_positions
-- -----------------------------------------------------------------------------
create table if not exists public.live_positions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bot_id uuid not null,
  exchange text not null,
  symbol text not null,
  direction text not null,
  status text not null,
  entry_order_id uuid null,
  entry_time timestamptz not null,
  entry_price numeric not null,
  quantity numeric not null,
  stop_loss_price numeric null,
  take_profit_price numeric null,
  trailing_stop_price numeric null,
  stop_order_id uuid null,
  tp_order_id uuid null,
  current_price numeric null,
  unrealized_pnl numeric null,
  realized_pnl numeric null,
  fee_total numeric null,
  risk_amount numeric null,
  r_multiple numeric null,
  session_date_ny date not null,
  closed_at timestamptz null,
  exit_reason text null,

  constraint chk_live_positions_exchange
    check (exchange in ('bitunix', 'paper')),

  constraint chk_live_positions_direction
    check (direction in ('long', 'short')),

  constraint chk_live_positions_status
    check (status in ('open', 'closing', 'closed')),

  constraint fk_live_positions_bot
    foreign key (bot_id)
    references public.bots (id)
    on delete cascade
);

-- updated_at trigger (idempotent): create only if missing.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_live_positions_set_updated_at'
  ) then
    create trigger trg_live_positions_set_updated_at
    before update on public.live_positions
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

create index if not exists idx_live_positions_bot_id_status
  on public.live_positions (bot_id, status);

create index if not exists idx_live_positions_symbol_status
  on public.live_positions (symbol, status);

create index if not exists idx_live_positions_session_date_ny
  on public.live_positions (session_date_ny);

comment on table public.live_positions is 'Open and closing positions with live P&L.';
comment on column public.live_positions.bot_id is 'Owning bot.';
comment on column public.live_positions.exchange is 'Exchange identifier.';
comment on column public.live_positions.symbol is 'Trading symbol.';
comment on column public.live_positions.direction is 'Position direction (long/short).';
comment on column public.live_positions.status is 'Position status.';
comment on column public.live_positions.entry_order_id is 'Entry order for the position.';
comment on column public.live_positions.entry_time is 'Entry timestamp.';
comment on column public.live_positions.entry_price is 'Entry price.';
comment on column public.live_positions.quantity is 'Position quantity.';
comment on column public.live_positions.stop_loss_price is 'Stop loss price.';
comment on column public.live_positions.take_profit_price is 'Take profit price.';
comment on column public.live_positions.trailing_stop_price is 'Trailing stop price.';
comment on column public.live_positions.stop_order_id is 'Active stop order ID.';
comment on column public.live_positions.tp_order_id is 'Active take profit order ID.';
comment on column public.live_positions.current_price is 'Current mark/last price.';
comment on column public.live_positions.unrealized_pnl is 'Unrealized profit/loss.';
comment on column public.live_positions.realized_pnl is 'Realized profit/loss.';
comment on column public.live_positions.fee_total is 'Total fees paid for the position.';
comment on column public.live_positions.risk_amount is 'Risk amount used for R-multiple.';
comment on column public.live_positions.r_multiple is 'R-multiple for the position.';
comment on column public.live_positions.session_date_ny is 'Session date in New York time.';
comment on column public.live_positions.closed_at is 'Time position was closed.';
comment on column public.live_positions.exit_reason is 'Reason the position was closed.';

-- -----------------------------------------------------------------------------
-- live_trades
-- -----------------------------------------------------------------------------
create table if not exists public.live_trades (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bot_id uuid not null,
  position_id uuid null,
  exchange text not null,
  symbol text not null,
  direction text not null,
  entry_time timestamptz not null,
  entry_price numeric not null,
  exit_time timestamptz not null,
  exit_price numeric not null,
  quantity numeric not null,
  fee_total numeric not null,
  pnl numeric not null,
  r_multiple numeric null,
  exit_reason text not null,
  session_date_ny date not null,
  entry_order_id uuid null,
  exit_order_id uuid null,
  max_favorable_excursion numeric null,
  max_adverse_excursion numeric null,

  constraint chk_live_trades_exchange
    check (exchange in ('bitunix', 'paper')),

  constraint chk_live_trades_direction
    check (direction in ('long', 'short')),

  constraint fk_live_trades_bot
    foreign key (bot_id)
    references public.bots (id)
    on delete cascade
);

create index if not exists idx_live_trades_bot_id_entry_time_desc
  on public.live_trades (bot_id, entry_time desc);

create index if not exists idx_live_trades_symbol_session_date_ny
  on public.live_trades (symbol, session_date_ny);

create index if not exists idx_live_trades_exit_reason
  on public.live_trades (exit_reason);

comment on table public.live_trades is 'Completed live trades for analytics and reporting.';
comment on column public.live_trades.bot_id is 'Owning bot.';
comment on column public.live_trades.position_id is 'Source position for the trade.';
comment on column public.live_trades.exchange is 'Exchange identifier.';
comment on column public.live_trades.symbol is 'Trading symbol.';
comment on column public.live_trades.direction is 'Trade direction (long/short).';
comment on column public.live_trades.entry_time is 'Entry timestamp.';
comment on column public.live_trades.entry_price is 'Entry price.';
comment on column public.live_trades.exit_time is 'Exit timestamp.';
comment on column public.live_trades.exit_price is 'Exit price.';
comment on column public.live_trades.quantity is 'Trade quantity.';
comment on column public.live_trades.fee_total is 'Total fees paid.';
comment on column public.live_trades.pnl is 'Net profit/loss.';
comment on column public.live_trades.r_multiple is 'R-multiple for the trade.';
comment on column public.live_trades.exit_reason is 'Reason the trade exited.';
comment on column public.live_trades.session_date_ny is 'Session date in New York time.';
comment on column public.live_trades.entry_order_id is 'Entry order ID.';
comment on column public.live_trades.exit_order_id is 'Exit order ID.';
comment on column public.live_trades.max_favorable_excursion is 'Max favorable excursion.';
comment on column public.live_trades.max_adverse_excursion is 'Max adverse excursion.';

-- -----------------------------------------------------------------------------
-- bot_logs
-- -----------------------------------------------------------------------------
create table if not exists public.bot_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bot_id uuid not null,
  level text not null,
  category text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  position_id uuid null,
  order_id uuid null,

  constraint chk_bot_logs_level
    check (level in ('debug', 'info', 'warn', 'error', 'critical')),

  constraint fk_bot_logs_bot
    foreign key (bot_id)
    references public.bots (id)
    on delete cascade
);

create index if not exists idx_bot_logs_bot_id_created_at_desc
  on public.bot_logs (bot_id, created_at desc);

create index if not exists idx_bot_logs_level_created_at_desc
  on public.bot_logs (level, created_at desc);

create index if not exists idx_bot_logs_category
  on public.bot_logs (category);

comment on table public.bot_logs is 'Structured logs from live trading bots.';
comment on column public.bot_logs.bot_id is 'Owning bot.';
comment on column public.bot_logs.level is 'Log severity level.';
comment on column public.bot_logs.category is 'Subsystem or category for the log.';
comment on column public.bot_logs.message is 'Human-readable log message.';
comment on column public.bot_logs.context is 'Structured log context payload.';
comment on column public.bot_logs.position_id is 'Related position, if any.';
comment on column public.bot_logs.order_id is 'Related order, if any.';

-- -----------------------------------------------------------------------------
-- account_snapshots
-- -----------------------------------------------------------------------------
create table if not exists public.account_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bot_id uuid not null,
  exchange text not null,
  balance numeric not null,
  equity numeric not null,
  open_positions_count integer not null,
  total_unrealized_pnl numeric not null,
  daily_pnl numeric not null,
  total_pnl_since_start numeric not null,
  snapshot_type text not null,

  constraint chk_account_snapshots_exchange
    check (exchange in ('bitunix', 'paper')),

  constraint chk_account_snapshots_snapshot_type
    check (snapshot_type in ('periodic', 'session_start', 'session_end', 'manual')),

  constraint fk_account_snapshots_bot
    foreign key (bot_id)
    references public.bots (id)
    on delete cascade
);

create index if not exists idx_account_snapshots_bot_id_created_at_desc
  on public.account_snapshots (bot_id, created_at desc);

create index if not exists idx_account_snapshots_snapshot_type
  on public.account_snapshots (snapshot_type);

comment on table public.account_snapshots is 'Periodic account equity snapshots for bots.';
comment on column public.account_snapshots.bot_id is 'Owning bot.';
comment on column public.account_snapshots.exchange is 'Exchange identifier.';
comment on column public.account_snapshots.balance is 'Wallet balance at snapshot.';
comment on column public.account_snapshots.equity is 'Equity at snapshot.';
comment on column public.account_snapshots.open_positions_count is 'Count of open positions.';
comment on column public.account_snapshots.total_unrealized_pnl is 'Total unrealized P&L.';
comment on column public.account_snapshots.daily_pnl is 'Session or daily P&L.';
comment on column public.account_snapshots.total_pnl_since_start is 'P&L since bot start.';
comment on column public.account_snapshots.snapshot_type is 'Snapshot cadence or trigger.';

-- -----------------------------------------------------------------------------
-- Cross-table foreign keys (idempotent)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_orders_parent_position'
  ) then
    alter table public.live_orders
    add constraint fk_live_orders_parent_position
    foreign key (parent_position_id)
    references public.live_positions (id)
    on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_positions_entry_order'
  ) then
    alter table public.live_positions
    add constraint fk_live_positions_entry_order
    foreign key (entry_order_id)
    references public.live_orders (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_positions_stop_order'
  ) then
    alter table public.live_positions
    add constraint fk_live_positions_stop_order
    foreign key (stop_order_id)
    references public.live_orders (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_positions_tp_order'
  ) then
    alter table public.live_positions
    add constraint fk_live_positions_tp_order
    foreign key (tp_order_id)
    references public.live_orders (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_trades_position'
  ) then
    alter table public.live_trades
    add constraint fk_live_trades_position
    foreign key (position_id)
    references public.live_positions (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_trades_entry_order'
  ) then
    alter table public.live_trades
    add constraint fk_live_trades_entry_order
    foreign key (entry_order_id)
    references public.live_orders (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_live_trades_exit_order'
  ) then
    alter table public.live_trades
    add constraint fk_live_trades_exit_order
    foreign key (exit_order_id)
    references public.live_orders (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_bot_logs_position'
  ) then
    alter table public.bot_logs
    add constraint fk_bot_logs_position
    foreign key (position_id)
    references public.live_positions (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_bot_logs_order'
  ) then
    alter table public.bot_logs
    add constraint fk_bot_logs_order
    foreign key (order_id)
    references public.live_orders (id)
    on delete set null;
  end if;
end;
$$;
