# File-Based Optimization Results Guide

## Overview

For maximum performance during large optimization runs (10K+ backtests), results are written to a JSON Lines file instead of the database. This provides **10-50x speedup** by eliminating database bottlenecks.

## How It Works

### 1. During Optimization (Automatic)

When you run optimization, the API server:
- Detects optimization mode automatically
- Writes results to `optimization-results/results-TIMESTAMP.jsonl`
- Logs file path on startup: `[Server] Optimization results will be written to: ...`
- Each completed test appends one line to the file

**Log Example:**
```
[Server] Optimization results will be written to: E:/Dev/GitHub/dstb-server/optimization-results/results-2025-12-21T12-30-45-123Z.jsonl
[processBacktestRun] ✅ Written to file: a1b2c3d4
[ResultsFileWriter] Written 100 results to ...
[ResultsFileWriter] Written 200 results to ...
```

### 2. After Optimization (Manual Import)

Once all tests complete, import results to database:

```powershell
# Method 1: Using npm script
npm run import-results -- optimization-results/results-2025-12-21T12-30-45-123Z.jsonl

# Method 2: Direct tsx execution
npx tsx apps/api/src/scripts/importOptimizationResults.ts optimization-results/results-TIMESTAMP.jsonl
```

**Import Process:**
- Reads entire file
- Parses all JSON Lines
- Bulk updates database in chunks of 100
- Shows progress every chunk
- Handles both completed and failed runs

**Expected Output:**
```
[Import] Reading results from: optimization-results/results-2025-12-21T12-30-45-123Z.jsonl
[Import] Found 43000 results to import
[Import] Parsed 43000 valid results
[Import] Progress: 100/43000 (0%)
[Import] Progress: 1000/43000 (2%)
...
[Import] Progress: 43000/43000 (100%)
[Import] ✅ Import complete!
[Import]    Completed: 42850
[Import]    Failed: 150
[Import]    Total: 43000
```

## File Format (JSON Lines)

Each line is a complete JSON object:

```jsonl
{"runId":"abc-123","status":"completed","finalEquity":10500,"totalReturnPct":5.0,...}
{"runId":"def-456","status":"completed","finalEquity":9800,"totalReturnPct":-2.0,...}
{"runId":"ghi-789","status":"failed","errorMessage":"Insufficient data"}
```

## Performance Comparison

| Approach | Time for 10K runs | DB Load |
|----------|-------------------|---------|
| **Direct DB updates** | ~30-60 minutes | Very high (exhausts pool) |
| **File-based** | ~5-10 minutes | Minimal (only final import) |

## Troubleshooting

### Results not appearing in UI
- This is expected! Results are in the file, not DB yet
- Run the import script to see them in UI

### Import script fails
- Check that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your `.env`
- Make sure the file path is correct
- Check file permissions

### Want to see results before import?
```powershell
# Count completed runs
(Get-Content results.jsonl | Select-String '"status":"completed"').Count

# View first 5 results
Get-Content results.jsonl | Select-Object -First 5 | ConvertFrom-Json | Format-Table
```

## Tips

- **Keep the file safe!** It's your only copy until imported
- **Import can be re-run** - it will update existing runs (idempotent)
- **Delete the file** after successful import to save space
- **Results folder is gitignored** - won't accidentally commit large files


