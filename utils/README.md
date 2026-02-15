# Utility Scripts

This folder contains one-off utility scripts for database maintenance and cleanup.

## SQL Scripts

### `delete-4h-1d-runs.sql`

**Purpose**: Delete backtest runs with 4h or 1d intervals

**Usage**:
1. Review the SELECT query to see how many runs will be deleted
2. Uncomment the DELETE statement
3. Run via Supabase SQL editor or `psql`

**Note**: This will cascade delete related:
- `backtest_trades`
- `backtest_equity_points`  
- `run_events`

### `fix-corrupted-runs.sql`

**Purpose**: Fix corrupted `data_fingerprint` fields from bad batch updates

**When to use**: If backtest runs have failed with "Unknown backtest failure" or have corrupted fingerprints

**Options**:
- **Option 1** (Safest): Fix only failed tests with specific error
- **Option 2** (Aggressive): Reset ALL pending/failed tests

**Usage**:
1. Run the check query to see how many runs are affected
2. Choose Option 1 or Option 2
3. Review output and verify
4. Re-queue runs if needed

## Best Practices

- **Always test on a backup** before running on production database
- **Review SELECT queries** before running any DELETE/UPDATE
- **Document** any new utility scripts added here
- **Keep scripts idempotent** where possible (safe to re-run)

## When NOT to Use These

These are **maintenance scripts**, not part of normal operations. Don't run them unless:
- You understand what they do
- You have a specific problem they solve
- You've backed up the database
- You've tested on a non-production environment first
