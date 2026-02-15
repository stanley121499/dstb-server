-- Delete all backtest runs with 4h or 1d intervals
-- This will also cascade delete related trades, equity points, and events

-- First, check how many will be deleted
SELECT interval, COUNT(*) as count
FROM backtest_runs
WHERE interval IN ('4h', '1d')
GROUP BY interval;

-- Delete them (uncomment when ready)
-- DELETE FROM backtest_runs
-- WHERE interval IN ('4h', '1d');


