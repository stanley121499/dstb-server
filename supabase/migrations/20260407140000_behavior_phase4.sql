-- Phase 4: behavior analysis tables (schema + RLS + seed + realtime)
-- Aligns with dstb-docs/raw/2026-04-07-schema-design-v3.md

-- ---------------------------------------------------------------------------
-- behavior_analyzers
-- ---------------------------------------------------------------------------
CREATE TABLE behavior_analyzers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  description      TEXT,
  code             TEXT NOT NULL,
  execution_mode   TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (execution_mode IN ('sandbox', 'native_s2')),
  param_defaults   JSONB NOT NULL DEFAULT '{}',
  param_schema     JSONB NOT NULL DEFAULT '{}',
  version          INT NOT NULL DEFAULT 1,
  tested           BOOLEAN NOT NULL DEFAULT false,
  created_by       UUID REFERENCES auth.users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_behavior_analyzers_slug ON behavior_analyzers (slug);

-- ---------------------------------------------------------------------------
-- behavior_rulesets
-- ---------------------------------------------------------------------------
CREATE TABLE behavior_rulesets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  analyzers    JSONB NOT NULL,
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT false,
  created_by   UUID REFERENCES auth.users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_behavior_rulesets_active ON behavior_rulesets (is_active) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- behavior_raw_cycles
-- ---------------------------------------------------------------------------
CREATE TABLE behavior_raw_cycles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            TEXT NOT NULL,
  cycle_date        DATE NOT NULL,
  candles           JSONB NOT NULL,
  reference_levels  JSONB NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, cycle_date)
);

CREATE INDEX idx_behavior_raw_cycles_symbol_date ON behavior_raw_cycles (symbol, cycle_date DESC);

-- ---------------------------------------------------------------------------
-- behavior_results
-- ---------------------------------------------------------------------------
CREATE TABLE behavior_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_cycle_id  UUID NOT NULL REFERENCES behavior_raw_cycles (id) ON DELETE CASCADE,
  ruleset_id    UUID NOT NULL REFERENCES behavior_rulesets (id) ON DELETE CASCADE,
  columns       JSONB NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (raw_cycle_id, ruleset_id)
);

CREATE INDEX idx_behavior_results_ruleset ON behavior_results (ruleset_id);
CREATE INDEX idx_behavior_results_raw_cycle ON behavior_results (raw_cycle_id);

-- ---------------------------------------------------------------------------
-- behavior_environments
-- ---------------------------------------------------------------------------
CREATE TABLE behavior_environments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  ruleset_id      UUID REFERENCES behavior_rulesets (id),
  derived_params  JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'candidate',
  backtest_stats  JSONB NOT NULL DEFAULT '{}',
  live_stats      JSONB NOT NULL DEFAULT '{}',
  notes           TEXT,
  config_id       UUID REFERENCES configs (id),
  created_by      UUID REFERENCES auth.users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_behavior_environments_status ON behavior_environments (status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER behavior_analyzers_updated_at
  BEFORE UPDATE ON behavior_analyzers
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER behavior_rulesets_updated_at
  BEFORE UPDATE ON behavior_rulesets
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER behavior_environments_updated_at
  BEFORE UPDATE ON behavior_environments
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE behavior_analyzers ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_raw_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_environments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_behavior_analyzers" ON behavior_analyzers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_behavior_analyzers" ON behavior_analyzers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_behavior_rulesets" ON behavior_rulesets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_behavior_rulesets" ON behavior_rulesets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_behavior_raw_cycles" ON behavior_raw_cycles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_behavior_raw_cycles" ON behavior_raw_cycles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_behavior_results" ON behavior_results
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_behavior_results" ON behavior_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_behavior_environments" ON behavior_environments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_behavior_environments" ON behavior_environments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Realtime (dashboard progress / live inserts)
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE behavior_results;

-- ---------------------------------------------------------------------------
-- Seed: default native S2 analyzer + active ruleset
-- Fixed UUIDs so ruleset JSON references stay stable across environments.
-- ---------------------------------------------------------------------------
INSERT INTO behavior_analyzers (
  id,
  slug,
  name,
  description,
  code,
  execution_mode,
  param_defaults,
  param_schema,
  version,
  tested
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  's2_full_cycle',
  'S2 full cycle (native)',
  'Runs the built-in TypeScript BehaviorAnalyzer; code field is unused when execution_mode is native_s2.',
  '/* native_s2 */',
  'native_s2',
  '{}',
  '{}',
  1,
  true
);

INSERT INTO behavior_rulesets (
  id,
  name,
  analyzers,
  notes,
  is_active
) VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'Default S2',
  '[{"analyzer_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","params":{}}]'::jsonb,
  'Seeded default ruleset for Phase 4',
  true
);
