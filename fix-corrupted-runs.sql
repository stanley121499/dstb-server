-- Fix corrupted data_fingerprint fields caused by the bad batch update
-- This resets the data_fingerprint to NULL for all failed/pending tests
-- so they can be processed cleanly

-- Option 1: Fix all failed tests (safest - only fixes ones that failed)
UPDATE backtest_runs
SET 
  data_fingerprint = NULL,
  status = 'queued',
  error_message = NULL
WHERE status = 'failed'
  AND error_message = 'Unknown backtest failure';

-- Option 2: Fix ALL pending/failed tests (more aggressive)
-- Uncomment this if you want to reset everything
/*
UPDATE backtest_runs
SET 
  data_fingerprint = NULL,
  status = 'queued',
  error_message = NULL
WHERE status IN ('failed', 'queued', 'running')
  AND (
    data_fingerprint IS NULL 
    OR NOT (data_fingerprint ? 'data')  -- Missing the 'data' key means it's corrupted
  );
*/

-- Check how many tests need fixing
SELECT 
  status,
  CASE 
    WHEN data_fingerprint IS NULL THEN 'null'
    WHEN data_fingerprint ? 'data' THEN 'valid'
    ELSE 'corrupted'
  END as data_state,
  COUNT(*)
FROM backtest_runs
WHERE status IN ('failed', 'queued', 'running')
GROUP BY status, data_state
ORDER BY status, data_state;


