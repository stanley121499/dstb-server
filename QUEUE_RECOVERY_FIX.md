# Queue Recovery Fix - Resume 43K Optimization

## What Happened

Your optimization ran overnight but stopped processing. The issue was that the `BacktestQueue` recovery mechanism only recovered tests with status="running", but **didn't reload tests with status="queued"** into the in-memory queue.

**Result:** When you restarted the server, it only picked up 2 tests (the ones that were "running" when it stopped), leaving ~43,000 queued tests in the database but not in the processing queue.

## What Was Fixed

Updated `apps/api/src/jobs/backtestQueue.ts` to:
- Query for BOTH "running" AND "queued" tests on startup
- Reset any "running" tests back to "queued" (they were interrupted)
- Load ALL pending tests into the in-memory queue
- Resume processing automatically

## How to Resume Your 43K Tests

### Step 1: Restart API Server

In the terminal running `npm run dev:api`:
1. Press `Ctrl + C` to stop the server
2. Run: `npm run dev:api`
3. Watch for recovery message

### Step 2: What You Should See

After restart, you should see output like:
```
[BacktestQueue] Initialized with concurrency: 10
[BacktestQueue] ⚠️  RECOVERY: Found X stuck tests and Y queued tests, recovering...
[BacktestQueue] 🎉 Recovery complete: 43000+ tests loaded into queue
[BacktestQueue] Starting run: xxx (active: 1/10)
[BacktestQueue] Starting run: xxx (active: 2/10)
...
[BacktestQueue] Starting run: xxx (active: 10/10)
```

**Key indicator:** You should see a large number (like 43,000+) in the recovery message.

### Step 3: Monitor Progress

**Check queue size:**
Watch for log messages like:
```
[BacktestQueue] Active count: 10/10, Queue: 42990
```

The "Queue" number should start high (43K+) and decrease as tests complete.

**Check database:**
You can query Supabase to see status distribution:
```sql
SELECT status, COUNT(*) 
FROM backtest_runs 
GROUP BY status;
```

You should see:
- `queued`: Decreasing (from ~43K towards 0)
- `running`: Should be 10 (your concurrency setting)
- `completed`: Increasing (towards 43,740)

## Performance Expectations

With concurrency=10 (I see you changed it from 3 to 10):
- **Processing rate:** ~10-30 tests per minute (with cache hits)
- **43,740 tests:** ~24-73 hours total
- **Current setting:** Faster but uses more resources

### Recommended Settings

**If you want it done faster:**
```
BACKTEST_CONCURRENCY=10  # Current setting - good!
```

**If you want to reduce server load:**
- Edit `.env` file (if exists) or set environment variable
- Restart API server after changing

## Troubleshooting

### Problem: Still shows "Queue: 0" after restart

**Cause:** Code change might not have been picked up by tsx watch

**Solution:**
```powershell
# Stop the server completely (Ctrl+C multiple times)
# Verify it stopped (no process running)
cd E:\Dev\GitHub\dstb-server
npm run dev:api
```

### Problem: Recovery says "0 tests loaded"

**Cause:** All tests might have already completed or failed

**Check database:**
```powershell
# Use Supabase dashboard or API to check
curl http://localhost:3001/v1/backtests?offset=0&limit=1
```

Look at the response - it will show total count of tests.

### Problem: Tests are running but very slowly

**Check cache status:**
Look for log messages:
- `[CandleCache] HIT` = Good! Using cached data
- `[CandleCache] MISS` = Fetching from Binance (slower)

After the first few tests complete, you should see mostly HITs.

## Why Did It Stop Originally?

Possible reasons:
1. **Server crash** - Node.js ran out of memory (unlikely with your setup)
2. **Manual stop** - You or Windows stopped the process
3. **Windows update** - System restarted overnight
4. **Power/sleep** - Computer went to sleep or lost power
5. **tsx watch issue** - File watcher crashed

The recovery mechanism now handles all these scenarios!

## Monitoring Progress

**Real-time monitoring:**
```powershell
# Watch the API terminal
# You'll see messages every few seconds:
[BacktestQueue] Completed run: xxx
[BacktestQueue] Active count: 10/10, Queue: 42500
```

**Calculate progress:**
```
Progress = (43740 - Queue) / 43740 * 100%

Example:
Queue: 42500 → Progress: 2.8%
Queue: 30000 → Progress: 31.4%
Queue: 10000 → Progress: 77.1%
Queue: 1000  → Progress: 97.7%
```

**Estimated completion:**
```
Time remaining = Queue / (tests per minute)

Example at 20 tests/min:
Queue: 43000 → ~36 hours remaining
Queue: 20000 → ~17 hours remaining  
Queue: 5000  → ~4 hours remaining
```

## What to Do While It Runs

**DO:**
- ✅ Let it run uninterrupted
- ✅ Keep computer on (disable sleep mode)
- ✅ Check progress occasionally
- ✅ Monitor CPU/memory usage (Task Manager)

**DON'T:**
- ❌ Stop the server unless absolutely necessary
- ❌ Let computer go to sleep
- ❌ Restart Windows
- ❌ Close terminal windows

## If You Need to Stop and Resume

The recovery mechanism now makes this safe!

**To stop:**
1. Press `Ctrl + C` in API terminal
2. Wait for graceful shutdown

**To resume:**
1. Run `npm run dev:api`
2. Recovery will automatically load all pending tests
3. Processing continues where it left off

## Summary

✅ **Fix applied:** Queue recovery now loads ALL pending tests
✅ **Action needed:** Restart API server once
✅ **Result:** All 43K tests will resume processing
✅ **Completion:** 24-73 hours depending on cache performance

**Next step:** Restart the API server and watch for the recovery message showing 43K+ tests loaded!


