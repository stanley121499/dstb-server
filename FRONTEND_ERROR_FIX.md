# Frontend Error: "Invalid runIds in response" - SOLUTION

## Problem

After running a 43,740 test optimization, you're seeing:
1. Error: "Invalid runIds in response"
2. Vite error: `431 Request Header Fields Too Large`
3. Page not redirecting to results

## Root Cause

The error is **NOT** from the current code - it's from **cached browser code** from before the fix was applied. The browser is using an old version of the parsing logic that expected a `runIds` array in the response.

Additionally, the `431` error suggests the browser has accumulated large headers (possibly from previous attempts with 44K runIds in cookies/storage).

## Evidence

From your API terminal (line 481):
```
Grid search complete: 43740 tests queued
```

The API successfully queued all 43,740 tests! The problem is purely on the frontend/browser side.

## Solution

### Step 1: Clear Browser Cache (REQUIRED)

**In Opera GX:**
1. Press `Ctrl + Shift + Delete`
2. Select **"All time"** from the dropdown
3. Check these boxes:
   - ✅ **Cookies and other site data**
   - ✅ **Cached images and files**
   - ✅ **Browsing history** (optional but recommended)
4. Click **"Clear data"**
5. Close ALL browser windows
6. Reopen Opera GX

### Step 2: Clear Session Storage

Before clicking "Run Tests" again, open DevTools:
1. Press `F12` to open DevTools
2. Go to **Application** tab
3. Click **Session Storage** → **localhost:5173**
4. Right-click → **Clear**
5. Also clear **Local Storage** → **localhost:5173**

### Step 3: Verify Vite Rebuilt Code

In your Cursor terminal where `npm run dev:web` is running:
1. Press `Ctrl + C` to stop Vite
2. Run: `npm run dev:web` to restart
3. Wait for "ready in X ms" message
4. Hard reload browser: `Ctrl + Shift + R` (or `Ctrl + F5`)

### Step 4: Check Your Runs Are Processing

Your 43,740 tests are already queued and processing! You can verify:
1. Go to http://localhost:5173
2. Click **"Runs"** in navigation
3. You should see runs with status "queued" or "running"
4. The API terminal shows tests are processing (line 233: "Queue: 43486")

## What's Happening Now

✅ API successfully queued 43,740 tests
✅ Tests are being processed (3 concurrent as configured)
✅ Cache is preventing candle data from being fetched 43K times
✅ Backend is working perfectly!

❌ Browser has old cached code from before the fix
❌ Browser may have large cookies/headers from previous attempts

## After Clearing Cache

Once you clear cache and reload:
1. The error "Invalid runIds in response" will disappear
2. The 431 error will disappear
3. Page will redirect correctly to results
4. You'll see the new loading progress bar

## Monitoring Progress

While tests are running, you can monitor:

**API Terminal:**
```
[BacktestQueue] Active count: 3/3, Queue: 43486
[BacktestQueue] Completed run: xxx
```

**Check Progress via API:**
```powershell
# Get count of completed runs
curl http://localhost:3001/v1/backtests?offset=0&limit=1

# Response will show total count
```

## Expected Timeline

With 43,740 tests at 3 concurrent:
- **1-2 seconds per test** (with cache hits)
- **Total time:** ~4-8 hours
- **Completion:** Around 3-7 AM (if started at 11 PM)

## If Error Persists After Cache Clear

If you still see the error after clearing cache:

### Nuclear Option: Reset Everything

```powershell
# Stop both servers
# In both terminals, press Ctrl+C

# Clear node modules cache (optional)
cd E:\Dev\GitHub\dstb-server
Remove-Item -Recurse -Force node_modules\.vite

# Restart everything
npm run dev:api    # In terminal 1
npm run dev:web    # In terminal 2
```

### Check Actual Response

Open DevTools Network tab:
1. Press `F12`
2. Go to **Network** tab
3. Click **"Run Tests"**
4. Find the `/v1/backtests/grid` request
5. Click on it
6. Check **Response** tab
7. Should see:
```json
{
  "gridRunId": "xxx-xxx-xxx",
  "totalQueued": 43740,
  "firstRunId": "xxx-xxx-xxx",
  "timestamp": "2025-12-21T..."
}
```

If you see a huge array of runIds, then the API code wasn't updated properly.

## Summary

✅ **Your optimization is running!** (43,740 tests queued successfully)
✅ **API is working correctly**
✅ **Backend is processing tests**
❌ **Browser cache is the issue** - clear it!

**Next step:** Clear browser cache and reload. Your tests are already processing in the background!


