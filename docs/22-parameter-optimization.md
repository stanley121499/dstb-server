# Parameter Optimization Feature

## Overview

The DSTB platform now includes a **parameter optimization** (grid search) feature that allows you to test all combinations of parameters across multiple symbols and timeframes with a single click.

## How It Works

### 1. Navigate to Optimize Page

Click on **"Optimize"** in the main navigation (⚡ icon).

### 2. Configure Your Optimization

#### Base Configuration
- **Base Parameter Set**: Select a saved parameter set to use as the starting point
- **Symbols**: Choose which symbols to test (BTC-USD, ETH-USD, or both)
- **Intervals**: Choose which timeframes to test (1m, 2m, 5m, 15m, 30m, 1h, 1d)

#### Parameter Overrides
Define which parameters you want to vary and what values to test:

**Example:**
- Parameter Path: `session.openingRangeMinutes`
- Values: `15,30,60`

This will test 3 different opening range values.

**Common Parameters to Optimize:**

| Parameter | Description | Typical Range | Notes |
|-----------|-------------|---------------|-------|
| `session.openingRangeMinutes` | Opening range duration | 15-90 minutes | Lower = more trades, Higher = better confirmation. Try: 15,30,60 |
| `entry.breakoutBufferBps` | Entry buffer beyond range | 0-20 bps | 0 = no buffer, 10-15 reduces false breakouts. Try: 0,5,10,15 |
| `entry.maxTradesPerSession` | Max trades per session | 1-5 trades | Lower = more selective, Higher = more opportunities. Try: 1,2,3 |
| `atr.atrLength` | ATR calculation period | 10-20 bars | 14 is industry standard. Lower = more reactive. Try: 10,14,20 |
| `risk.riskPctPerTrade` | Risk per trade | 0.5-3% | Professionals use 1-2%. Never exceed 5%. Try: 1,2,3 |
| `risk.atrStopMultiple` | Stop loss ATR multiple | 1.5-3.0x | Lower = tighter stop, Higher = more room. Try: 1.5,2.0,2.5 |
| `risk.tpRMultiple` | Take profit R-multiple | 2-5R | 2R = conservative, 3R = balanced, 4R+ = aggressive. Try: 2,3,4 |
| `risk.atrTrailMultiple` | Trailing stop ATR multiple | 2-4x | Must be >= stop multiple. Higher locks in more profit. Try: 2.0,2.5,3.0 |
| `risk.fixedNotional` | Fixed position size | 1-5% of equity | Depends on account size. Try: 1000,2000,5000 |
| `execution.feeBps` | Trading fees | 5-50 bps | Binance ~10 bps, Coinbase ~50 bps. Try: 5,10,15 |
| `execution.slippageBps` | Expected slippage | 5-30 bps | Liquid: 5-10 bps, Less liquid: 10-30 bps. Try: 5,10,20 |

#### Date Range & Equity
- **Start Time (UTC)**: Beginning of backtest period
- **End Time (UTC)**: End of backtest period
- **Initial Equity**: Starting capital (default: 10,000)

### 3. Review Estimated Tests

The page shows you exactly how many tests will run:
```
Estimated Tests = Symbols × Intervals × Parameter Combinations
```

**Example:**
- 2 symbols (BTC-USD, ETH-USD)
- 3 intervals (5m, 15m, 1h)
- 2 parameters varied:
  - `session.openingRangeMinutes`: 15,30,60 (3 values)
  - `risk.atrStopMultiple`: 1.5,2.0,2.5 (3 values)

Total tests = 2 × 3 × (3 × 3) = **54 runs**

### 4. Run Optimization

Click **"Run X Tests"** button. The system will:
1. Create all test combinations
2. Queue them for execution (processed sequentially)
3. Redirect you to the Compare page with all results

### 5. View Results

The Compare page automatically loads with all optimization runs:
- View metrics side-by-side in a table
- Identify the best performing configuration
- Overlay equity curves to visualize performance
- Sort by any metric (Total Return, Max Drawdown, Win Rate, etc.)

## API Endpoint

The optimization feature uses the existing grid search endpoint:

```
POST /v1/backtests/grid
```

**Request Body:**
```json
{
  "baseParams": { /* StrategyParams object */ },
  "overrides": [
    {
      "path": "session.openingRangeMinutes",
      "values": [15, 30, 60]
    },
    {
      "path": "risk.atrStopMultiple",
      "values": [1.5, 2.0, 2.5]
    }
  ],
  "symbols": ["BTC-USD", "ETH-USD"],
  "intervals": ["5m", "15m", "1h"],
  "startTimeUtc": "2024-01-01T00:00:00Z",
  "endTimeUtc": "2024-12-31T23:59:59Z",
  "initialEquity": 10000
}
```

**Response:**
```json
{
  "gridRunId": "uuid-of-grid-run",
  "runIds": ["uuid1", "uuid2", "uuid3", ...]
}
```

## Tips for Effective Optimization

### Start Small
- Begin with 1-2 parameters
- Use 3-5 values per parameter
- Test on a limited date range first

### Performance Considerations
- Each run is processed sequentially to avoid rate limits
- Large optimizations (100+ runs) may take time
- Monitor the Runs page to see progress

### Choosing Parameters
Focus on parameters that have the most impact:
1. **Entry timing**: `openingRangeMinutes`, `breakoutBufferBps`
2. **Risk management**: `atrStopMultiple`, `tpRMultiple`
3. **Position sizing**: `riskPctPerTrade`, `fixedNotional`

**Generally avoid optimizing:**
- `feeBps` and `slippageBps` - Use realistic fixed values based on your exchange
- `timezone` and `startTime` - Should match your strategy concept
- `atrFilter.enabled` - Boolean parameters create combinatorial explosion
- Too many parameters at once - Risk of overfitting increases exponentially

### Parameter Range Guidelines

**Opening Range (session.openingRangeMinutes)**
- **Too low (< 15 min)**: Insufficient price action to establish meaningful range
- **Sweet spot (15-60 min)**: Most ORB strategies work well here
- **Too high (> 120 min)**: May miss early breakout momentum

**Stop Loss (risk.atrStopMultiple)**
- **Too tight (< 1.0x)**: Stopped out by normal volatility
- **Sweet spot (1.5-2.5x)**: Balances protection with room to breathe
- **Too loose (> 4.0x)**: Risk too much capital per trade

**Take Profit (risk.tpRMultiple)**
- **Too tight (< 1.5R)**: May not justify risk/reward
- **Sweet spot (2-4R)**: Standard for breakout strategies
- **Too aggressive (> 6R)**: Rarely hit, reduces win rate significantly

**Risk Per Trade (risk.riskPctPerTrade)**
- **Conservative (0.5-1%)**: Slow growth, high survival probability
- **Moderate (1-2%)**: Professional standard
- **Aggressive (2-3%)**: Higher returns but more volatility
- **Dangerous (> 5%)**: High risk of ruin

**ATR Period (atr.atrLength)**
- **Short (< 10)**: Very reactive, may whipsaw
- **Standard (14)**: Industry default, well-tested
- **Long (> 20)**: Smoother but lags market changes

### Avoiding Overfitting
- Use a walk-forward approach: optimize on training data, validate on test data
- Don't over-optimize on too many parameters
- Prefer robust results that work across multiple timeframes
- Look for parameter combinations that perform consistently

## Example Workflow

**Goal: Find the best opening range duration for BTC on multiple timeframes**

1. Go to Optimize page
2. Select a base parameter set (e.g., "ORB Default Strategy")
3. Select symbols: BTC-USD only
4. Select intervals: 5m, 15m, 30m, 1h
5. Add override:
   - Path: `session.openingRangeMinutes`
   - Values: `15,30,45,60,90`
6. Set date range: Last 6 months
7. Click "Run 20 Tests" (4 intervals × 5 values)
8. Compare results and identify which opening range works best

## Technical Notes

- Grid runs are associated via a `gridRunId` stored in run events
- All runs use the same date range and initial equity
- Symbol and interval from the base params are overridden by the grid configuration
- Parameter values can be numbers, strings, or booleans
- Nested parameter paths use dot notation (e.g., `risk.atrStopMultiple`)

## Quick Reference: Starting Points by Strategy Style

### Conservative ORB Strategy
```
session.openingRangeMinutes: 60
entry.breakoutBufferBps: 10
entry.maxTradesPerSession: 1
risk.riskPctPerTrade: 1
risk.atrStopMultiple: 2.0
risk.tpRMultiple: 3
risk.atrTrailMultiple: 2.5
```
**Goal**: Higher win rate, fewer trades, lower risk per trade

### Balanced ORB Strategy
```
session.openingRangeMinutes: 30
entry.breakoutBufferBps: 5
entry.maxTradesPerSession: 2
risk.riskPctPerTrade: 2
risk.atrStopMultiple: 1.5
risk.tpRMultiple: 2.5
risk.atrTrailMultiple: 2.0
```
**Goal**: Balance between frequency and quality

### Aggressive ORB Strategy
```
session.openingRangeMinutes: 15
entry.breakoutBufferBps: 0
entry.maxTradesPerSession: 3
risk.riskPctPerTrade: 2.5
risk.atrStopMultiple: 1.5
risk.tpRMultiple: 2
risk.atrTrailMultiple: 1.5
```
**Goal**: More trades, faster exits, higher frequency

## Common Optimization Recipes

### Recipe 1: "Find My Opening Range"
**Goal**: Determine optimal range duration for your asset/timeframe
```
Fixed: All other parameters
Vary: session.openingRangeMinutes = 15,30,45,60,90
Test: Both BTC and ETH, 3-4 timeframes
```

### Recipe 2: "Optimize Risk/Reward"
**Goal**: Find best stop loss and take profit combination
```
Fixed: Entry parameters
Vary: 
  - risk.atrStopMultiple = 1.5,2.0,2.5
  - risk.tpRMultiple = 2,3,4
Test: Your primary symbol and timeframe
```

### Recipe 3: "Full Strategy Calibration"
**Goal**: Comprehensive optimization (use sparingly to avoid overfitting)
```
Fixed: Execution costs (feeBps, slippageBps)
Vary:
  - session.openingRangeMinutes = 30,60
  - entry.breakoutBufferBps = 0,10
  - risk.atrStopMultiple = 1.5,2.0
  - risk.tpRMultiple = 2,3
Test: One symbol, one timeframe initially
Then validate best result across other timeframes
```

## File-Based Results for Large Optimizations

### Performance Mode

For large optimization runs (10K+ backtests), results are written to a JSON Lines file instead of the database. This provides **10-50x speedup** by eliminating database bottlenecks.

### How It Works

#### 1. During Optimization (Automatic)

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
```

#### 2. After Optimization (Manual Import)

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

### File Format (JSON Lines)

Each line is a complete JSON object:

```jsonl
{"runId":"abc-123","status":"completed","finalEquity":10500,"totalReturnPct":5.0,...}
{"runId":"def-456","status":"completed","finalEquity":9800,"totalReturnPct":-2.0,...}
{"runId":"ghi-789","status":"failed","errorMessage":"Insufficient data"}
```

### Performance Comparison

| Approach | Time for 10K runs | DB Load |
|----------|-------------------|---------|
| **Direct DB updates** | ~30-60 minutes | Very high (exhausts pool) |
| **File-based** | ~5-10 minutes | Minimal (only final import) |

### Troubleshooting

**Results not appearing in UI:**
- This is expected! Results are in the file, not DB yet
- Run the import script to see them in UI

**Import script fails:**
- Check that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your `.env`
- Make sure the file path is correct
- Check file permissions

**Want to see results before import?**
```powershell
# Count completed runs
(Get-Content results.jsonl | Select-String '"status":"completed"').Count

# View first 5 results
Get-Content results.jsonl | Select-Object -First 5 | ConvertFrom-Json | Format-Table
```

### Tips

- **Keep the file safe!** It's your only copy until imported
- **Import can be re-run** - it will update existing runs (idempotent)
- **Delete the file** after successful import to save space
- **Results folder is gitignored** - won't accidentally commit large files

## Future Enhancements

Potential improvements for future versions:
- **Smart optimization**: Genetic algorithms or Bayesian optimization instead of brute-force grid search
- **Parallel execution**: Process multiple runs simultaneously
- **Progress tracking**: Real-time updates during optimization
- **Result export**: Download optimization results as CSV/JSON
- **Optimization presets**: Save and reuse common optimization configurations
- **Statistical analysis**: Automatic detection of statistically significant parameter ranges



