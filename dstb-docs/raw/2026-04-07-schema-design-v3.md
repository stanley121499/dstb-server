# Supabase Schema Design v3

**Date:** 2026-04-07
**Status:** Planning
**Related:** [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md)

---

## Overview

This document defines the Supabase (Postgres) schema that replaces the SQLite database (`data/bot-state.db`) and JSON config files (`configs/strategies/*.json`). The schema covers four domains:

1. **Bot Management** — configs, bots, orders
2. **Trade Data** — trades, positions, candle context
3. **Operational** — bot logs
4. **Behavior Analysis** — raw cycles, analyzers, rulesets, results, environments

---

## 1. Bot Management

### `configs`

The source of truth for what bots should exist and their strategy parameters. Replaces `configs/strategies/*.json` and `bot-stopped-state.json`.

```sql
CREATE TABLE configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                           -- "ETH ORB-ATR v3"
  strategy        TEXT NOT NULL,                           -- "orb-atr"
  symbol          TEXT NOT NULL,                           -- "ETHUSDT"
  interval        TEXT NOT NULL,                           -- "15m"
  exchange        TEXT NOT NULL DEFAULT 'bitunix',         -- "bitunix" | "paper"
  initial_balance NUMERIC NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}',             -- full strategy params blob
  risk_mgmt       JSONB NOT NULL DEFAULT '{}',             -- { maxDailyLossPct, maxPositionSizePct }
  credentials_ref JSONB NOT NULL DEFAULT '{}',             -- env var references, e.g. { "apiKey": "${BITUNIX_API_KEY}" }
  enabled         BOOLEAN NOT NULL DEFAULT false,          -- control plane toggle
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for bot server startup query
CREATE INDEX idx_configs_enabled ON configs (enabled) WHERE enabled = true;
```

### `config_versions`

Tracks every edit to a config's parameters. Created automatically when a config is updated.

```sql
CREATE TABLE config_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  params          JSONB NOT NULL,
  risk_mgmt       JSONB NOT NULL,
  change_note     TEXT,                                    -- "increased ATR multiple to 2.5"
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (config_id, version)
);
```

### `bots`

Runtime state for each active bot instance. One row per config that is or has been running.

```sql
CREATE TABLE bots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'stopped',         -- 'running' | 'stopped' | 'errored' | 'starting'
  equity          NUMERIC,
  last_heartbeat  TIMESTAMPTZ,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (config_id)
);
```

### `orders`

Exchange orders placed by bots.

```sql
CREATE TABLE orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id            UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  exchange_order_id TEXT,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,                          -- 'BUY' | 'SELL'
  order_type        TEXT NOT NULL,                          -- 'MARKET' | 'LIMIT' | 'STOP'
  quantity          NUMERIC NOT NULL,
  price             NUMERIC,
  status            TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'filled' | 'cancelled' | 'failed'
  filled_price      NUMERIC,
  filled_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_bot_id ON orders (bot_id);
CREATE INDEX idx_orders_status ON orders (status) WHERE status = 'pending';
```

---

## 2. Trade Data

### `trades`

Completed trade history. Every closed position becomes a trade row.

```sql
CREATE TABLE trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id            UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  config_id         UUID NOT NULL REFERENCES configs(id),
  config_version    INT NOT NULL,                           -- which version was active at trade time
  config_snapshot   JSONB NOT NULL,                         -- denormalized params for this trade
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,                           -- 'LONG' | 'SHORT'
  entry_price       NUMERIC NOT NULL,
  exit_price        NUMERIC NOT NULL,
  quantity          NUMERIC NOT NULL,
  stop_loss         NUMERIC,
  take_profit       NUMERIC,
  pnl               NUMERIC NOT NULL,
  pnl_pct           NUMERIC NOT NULL,
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ NOT NULL,
  exit_reason       TEXT NOT NULL,                          -- 'tp_hit' | 'sl_hit' | 'signal_exit' | 'manual' | 'exchange_closed_externally'
  metadata          JSONB DEFAULT '{}',                     -- extra context (slippage, fees, etc.)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trades_bot_id ON trades (bot_id);
CREATE INDEX idx_trades_config_id ON trades (config_id);
CREATE INDEX idx_trades_exit_time ON trades (exit_time DESC);
```

### `positions`

Currently open positions. Moved to `trades` on close.

```sql
CREATE TABLE positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  config_id       UUID NOT NULL REFERENCES configs(id),
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,                            -- 'LONG' | 'SHORT'
  entry_price     NUMERIC NOT NULL,
  quantity        NUMERIC NOT NULL,
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  entry_time      TIMESTAMPTZ NOT NULL,
  unrealized_pnl  NUMERIC,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (bot_id)                                          -- one open position per bot
);
```

### `trade_candles`

Multi-timeframe candle context captured at trade time. Powers the "why did I lose" chart view.

```sql
CREATE TABLE trade_candles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  timeframe       TEXT NOT NULL,                            -- '15m', '1h', '4h', '1d'
  candles         JSONB NOT NULL,                           -- array of { t, o, h, l, c, v }
  range_start     TIMESTAMPTZ NOT NULL,
  range_end       TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trade_candles_trade_id ON trade_candles (trade_id);
```

**Note on candle capture scope:** The number of candles and timeframes captured per trade is determined by the strategy. The bot server writes whatever the strategy considers relevant. For ORB-ATR, this is typically the full session's 15m candles plus surrounding 4h candles. Multi-timeframe strategies may write additional rows.

---

## 3. Operational

### `bot_logs`

Structured log events. Replaces file-based logging for important events. Raw debug logs remain ephemeral (stdout on Render).

```sql
CREATE TABLE bot_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id          UUID REFERENCES bots(id) ON DELETE SET NULL,
  level           TEXT NOT NULL,                            -- 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'
  event           TEXT NOT NULL,                            -- 'bot_start', 'position_opened', 'risk_blocked', etc.
  message         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_logs_bot_id ON bot_logs (bot_id);
CREATE INDEX idx_bot_logs_level ON bot_logs (level) WHERE level IN ('ERROR', 'CRITICAL');
CREATE INDEX idx_bot_logs_created_at ON bot_logs (created_at DESC);
```

**Retention policy:** Consider a Supabase cron (pg_cron) or application-level job to prune logs older than 90 days. Critical/error logs may be retained longer.

---

## 4. Behavior Analysis

### `behavior_analyzers`

Registered analysis modules. Each row contains LLM-generated JavaScript code that classifies one aspect of market behavior (e.g. "attempt begin", "decision type", "outcome").

```sql
CREATE TABLE behavior_analyzers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,                     -- "attempt_begin", "decision_type"
  name            TEXT NOT NULL,                            -- "Attempt Begin Classifier"
  description     TEXT,                                     -- Darren's English spec (what was given to the LLM)
  code            TEXT NOT NULL,                            -- LLM-generated JavaScript function body
  param_defaults  JSONB NOT NULL DEFAULT '{}',              -- default parameter values
  param_schema    JSONB NOT NULL DEFAULT '{}',              -- JSON Schema for dashboard form generation
  version         INT NOT NULL DEFAULT 1,
  tested          BOOLEAN NOT NULL DEFAULT false,           -- has it been test-run successfully?
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `behavior_rulesets`

A ruleset is a named combination of analyzers with parameter overrides. Darren creates rulesets to test hypotheses.

```sql
CREATE TABLE behavior_rulesets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                            -- "v3 — relaxed entry, strict outcome"
  analyzers       JSONB NOT NULL,                           -- array of { analyzer_id, params: {...overrides} }
  notes           TEXT,                                     -- what changed and why
  is_active       BOOLEAN NOT NULL DEFAULT false,           -- which ruleset the live BehaviorBot uses
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`analyzers` column example:**
```json
[
  { "analyzer_id": "uuid-1", "params": { "observeCandles": 3 } },
  { "analyzer_id": "uuid-2", "params": {} },
  { "analyzer_id": "uuid-3", "params": { "confirmationCandles": 2, "minWickPct": 0.3 } }
]
```

### `behavior_raw_cycles`

Immutable raw market data collected by the BehaviorBot each daily cycle. This data is never modified — only new rows are appended.

```sql
CREATE TABLE behavior_raw_cycles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT NOT NULL,
  cycle_date      DATE NOT NULL,
  candles         JSONB NOT NULL,                           -- { "15m": [...], "4h": [...], "1d": [...] }
  reference_levels JSONB NOT NULL,                          -- { "pdh": 3245.5, "pdl": 3198.2, "sessionOpen": 3220.0 }
  metadata        JSONB DEFAULT '{}',                       -- any additional context
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (symbol, cycle_date)
);
```

### `behavior_results`

Output of applying a ruleset to raw cycle data. One row per (cycle, ruleset) combination.

```sql
CREATE TABLE behavior_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_cycle_id    UUID NOT NULL REFERENCES behavior_raw_cycles(id) ON DELETE CASCADE,
  ruleset_id      UUID NOT NULL REFERENCES behavior_rulesets(id) ON DELETE CASCADE,
  columns         JSONB NOT NULL,                           -- { "attempt_begin": "ATT_BGN_EARLY", "decision_type": "DEC_ACC", ... }
  details         JSONB DEFAULT '{}',                       -- per-analyzer debug info
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (raw_cycle_id, ruleset_id)
);

CREATE INDEX idx_behavior_results_ruleset ON behavior_results (ruleset_id);
```

### `behavior_environments`

Candidate strategy environments derived from behavior analysis. Tracks their progression through the testing pipeline.

```sql
CREATE TABLE behavior_environments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                            -- "ETH ORB tight-stop v2"
  ruleset_id      UUID REFERENCES behavior_rulesets(id),
  derived_params  JSONB NOT NULL,                           -- strategy params this environment implies
  status          TEXT NOT NULL DEFAULT 'candidate',        -- 'candidate' | 'backtesting' | 'paper' | 'live' | 'retired'
  backtest_stats  JSONB DEFAULT '{}',                       -- win rate, PF, Sharpe, etc.
  live_stats      JSONB DEFAULT '{}',                       -- real performance
  notes           TEXT,                                     -- Darren's notes
  config_id       UUID REFERENCES configs(id),              -- link to config when promoted to paper/live
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_behavior_environments_status ON behavior_environments (status);
```

---

## Row-Level Security (RLS)

All tables should have RLS enabled. Policies:

- **Service role** (bot server): full read/write on all tables.
- **Authenticated users** (dashboard): read/write on most tables, restricted from `credentials_ref` column in `configs` (or use a Postgres view that omits it).
- **Anon**: no access.

Specific policy notes:
- The `configs.credentials_ref` column should not be readable from the dashboard. Use a Postgres view or column-level security to exclude it.
- `behavior_raw_cycles` should be insert-only for the bot server and read-only for the dashboard (immutable raw data).

---

## Supabase Realtime Subscriptions

The bot server subscribes to:

| Table | Event | Action |
|-------|-------|--------|
| `configs` | UPDATE (enabled changed) | Start or stop the corresponding bot |
| `configs` | UPDATE (params/risk_mgmt changed) | Restart the bot with new params |
| `configs` | DELETE | Stop and remove the bot |
| `configs` | INSERT (with enabled=true) | Start a new bot |

---

## Migration Notes

### From SQLite tables

| SQLite table | Supabase table | Notes |
|-------------|---------------|-------|
| `bots` | `bots` + `configs` | SQLite `bots` stored both config and state. Split into separate tables. |
| `positions` | `positions` | Direct migration. |
| `trades` | `trades` | Add `config_snapshot` and `config_version` columns. |
| `orders` | `orders` | Direct migration. |

### From JSON files

| File | Supabase table | Notes |
|------|---------------|-------|
| `configs/strategies/*.json` | `configs` | One row per JSON file. `enabled` replaces `bot-stopped-state.json`. |
| `configs/bot-stopped-state.json` | `configs.enabled` column | Removed entirely. |

---

## See Also

- [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md)
- [Phase Rollout Plan](./2026-04-07-phase-plan-v3.md)
- [Behavior System Design](./2026-04-07-behavior-system-design.md)
