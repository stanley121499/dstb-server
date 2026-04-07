-- Phase 1 v3: bot management, trades, operational tables (no behavior_* yet)
-- DSTB — Supabase Postgres schema aligned with docs/raw/2026-04-07-schema-design-v3.md

-- ---------------------------------------------------------------------------
-- configs
-- ---------------------------------------------------------------------------
CREATE TABLE configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  strategy          TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  interval          TEXT NOT NULL,
  exchange          TEXT NOT NULL DEFAULT 'bitunix',
  initial_balance   NUMERIC NOT NULL,
  params            JSONB NOT NULL DEFAULT '{}',
  risk_mgmt         JSONB NOT NULL DEFAULT '{}',
  credentials_ref   JSONB NOT NULL DEFAULT '{}',
  enabled           BOOLEAN NOT NULL DEFAULT false,
  current_version   INT NOT NULL DEFAULT 1,
  created_by        UUID REFERENCES auth.users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_configs_enabled ON configs (enabled) WHERE enabled = true;
CREATE UNIQUE INDEX idx_configs_name_symbol ON configs (name, symbol);

-- ---------------------------------------------------------------------------
-- config_versions
-- ---------------------------------------------------------------------------
CREATE TABLE config_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id     UUID NOT NULL REFERENCES configs (id) ON DELETE CASCADE,
  version       INT NOT NULL,
  params        JSONB NOT NULL,
  risk_mgmt     JSONB NOT NULL,
  change_note   TEXT,
  created_by    UUID REFERENCES auth.users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (config_id, version)
);

CREATE INDEX idx_config_versions_config_id ON config_versions (config_id);

-- ---------------------------------------------------------------------------
-- bots
-- ---------------------------------------------------------------------------
CREATE TABLE bots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID NOT NULL REFERENCES configs (id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'stopped',
  equity          NUMERIC,
  last_heartbeat  TIMESTAMPTZ,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (config_id)
);

-- ---------------------------------------------------------------------------
-- orders (client_order_id required by trading engine)
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id              UUID NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  client_order_id     TEXT NOT NULL,
  exchange_order_id   TEXT,
  symbol              TEXT NOT NULL,
  side                TEXT NOT NULL,
  order_type          TEXT NOT NULL DEFAULT 'MARKET',
  quantity            NUMERIC NOT NULL,
  price               NUMERIC,
  status              TEXT NOT NULL DEFAULT 'pending',
  filled_price        NUMERIC,
  filled_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_order_id)
);

CREATE INDEX idx_orders_bot_id ON orders (bot_id);
CREATE INDEX idx_orders_status ON orders (status) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
CREATE TABLE trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id            UUID NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  config_id         UUID NOT NULL REFERENCES configs (id),
  config_version    INT NOT NULL,
  config_snapshot   JSONB NOT NULL,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,
  entry_price       NUMERIC NOT NULL,
  exit_price        NUMERIC NOT NULL,
  quantity          NUMERIC NOT NULL,
  stop_loss         NUMERIC,
  take_profit       NUMERIC,
  pnl               NUMERIC NOT NULL,
  pnl_pct           NUMERIC NOT NULL,
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ NOT NULL,
  exit_reason       TEXT NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trades_bot_id ON trades (bot_id);
CREATE INDEX idx_trades_config_id ON trades (config_id);
CREATE INDEX idx_trades_exit_time ON trades (exit_time DESC);

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------
CREATE TABLE positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  config_id       UUID NOT NULL REFERENCES configs (id),
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,
  entry_price     NUMERIC NOT NULL,
  quantity        NUMERIC NOT NULL,
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  entry_time      TIMESTAMPTZ NOT NULL,
  unrealized_pnl  NUMERIC,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id)
);

CREATE INDEX idx_positions_bot_id ON positions (bot_id);

-- ---------------------------------------------------------------------------
-- trade_candles
-- ---------------------------------------------------------------------------
CREATE TABLE trade_candles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id      UUID NOT NULL REFERENCES trades (id) ON DELETE CASCADE,
  timeframe     TEXT NOT NULL,
  candles       JSONB NOT NULL,
  range_start   TIMESTAMPTZ NOT NULL,
  range_end     TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trade_candles_trade_id ON trade_candles (trade_id);

-- ---------------------------------------------------------------------------
-- bot_logs
-- ---------------------------------------------------------------------------
CREATE TABLE bot_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id      UUID REFERENCES bots (id) ON DELETE SET NULL,
  level       TEXT NOT NULL,
  event       TEXT NOT NULL,
  message     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_logs_bot_id ON bot_logs (bot_id);
CREATE INDEX idx_bot_logs_level ON bot_logs (level) WHERE level IN ('ERROR', 'CRITICAL');
CREATE INDEX idx_bot_logs_created_at ON bot_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger for configs and bots
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER configs_updated_at
  BEFORE UPDATE ON configs
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER bots_updated_at
  BEFORE UPDATE ON bots
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (service role bypasses; anon/authenticated policies later)
-- ---------------------------------------------------------------------------
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated dashboard users (placeholder — tighten in Phase 2)
CREATE POLICY "authenticated_read_configs" ON configs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_configs" ON configs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_config_versions" ON config_versions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_config_versions" ON config_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_bots" ON bots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_bots" ON bots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_orders" ON orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_orders" ON orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_trades" ON trades
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_trades" ON trades
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_positions" ON positions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_positions" ON positions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_trade_candles" ON trade_candles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_trade_candles" ON trade_candles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_bot_logs" ON bot_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_bot_logs" ON bot_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Realtime: configs changes drive bot server control plane
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE configs;
