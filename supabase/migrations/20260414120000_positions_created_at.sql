-- Add created_at to positions table.
-- Useful for debugging rapid create/close cycles and calculating position age
-- in syncPositionWithExchange reconcile guard.
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
