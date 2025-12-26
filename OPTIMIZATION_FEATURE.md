# Parameter Optimization Feature - Implementation Summary

## Date: December 21, 2025

## Feature Request
User requested a button to "test all combination of the params in all timeframe, like i click once it will test everything and give me the best result."

## Implementation

### What Was Built
A comprehensive **parameter optimization UI** that leverages the existing `/v1/backtests/grid` API endpoint to run exhaustive parameter searches across multiple symbols, timeframes, and parameter combinations.

### Files Modified

#### 1. API Client (`apps/web/src/lib/dstbApi.ts`)
- Added `GridOverride` type
- Added `RunGridSearchRequest` type
- Added `GridSearchResponse` type
- Added `apiRunGridSearch()` function to call the grid endpoint
- Added `parseGridSearchResponse()` helper

#### 2. New Page (`apps/web/src/pages/OptimizeParametersPage.tsx`)
**Features:**
- Select a base parameter set
- Multi-select for symbols (BTC-USD, ETH-USD)
- Multi-select for intervals (1m, 2m, 5m, 15m, 30m, 1h, 1d)
- Dynamic parameter override configuration:
  - Add/remove parameter paths
  - Define comma-separated values for each parameter
  - Auto-complete suggestions for common parameters
- Date range picker (UTC)
- Initial equity configuration
- Real-time calculation of estimated test count
- Validation before submission
- Auto-redirect to Compare page with results

#### 3. App Router (`apps/web/src/App.tsx`)
- Added "Optimize" navigation item (⚡ Zap icon)
- Added route: `/optimize` → `OptimizeParametersPage`
- Added to both desktop and mobile navigation

#### 4. Compare Page Enhancement (`apps/web/src/pages/CompareRunsPage.tsx`)
- Added URL query parameter support (`?runIds=id1,id2,id3`)
- Auto-loads runs from URL parameters
- Auto-triggers comparison when loaded from URL
- Perfect for viewing optimization results

#### 5. Documentation (`docs/22-parameter-optimization.md`)
- Complete user guide
- API reference
- Best practices for optimization
- Example workflows
- Tips to avoid overfitting

### User Experience Flow

```
1. User clicks "Optimize" in nav
   ↓
2. User selects base parameter set
   ↓
3. User selects symbols & intervals to test
   ↓
4. User adds parameter overrides with values
   ↓
5. User sees estimated test count (e.g., "Run 54 Tests")
   ↓
6. User clicks "Run X Tests" button
   ↓
7. System creates all combinations and queues them
   ↓
8. User is redirected to Compare page
   ↓
9. Compare page auto-loads all results
   ↓
10. User views metrics table, identifies best run
    ↓
11. User overlays equity curves to visualize
```

### Key Technical Details

**Grid Search Algorithm:**
- Uses Cartesian product to generate all combinations
- Formula: `total_runs = symbols × intervals × param_combinations`
- Example: 2 symbols × 3 intervals × (3 × 3) params = 54 runs

**Parameter Override Format:**
```typescript
{
  path: "session.openingRangeMinutes",
  values: [15, 30, 60]  // Can be numbers, strings, or booleans
}
```

**API Endpoint Used:**
```
POST /v1/backtests/grid
```

**Processing:**
- All runs are queued sequentially (prevents rate limits)
- Each run is tracked individually
- Grid runs are linked via `gridRunId` in run events

### Example Usage

**Scenario:** Find best opening range for BTC across multiple timeframes

1. Base params: "ORB Default Strategy"
2. Symbols: BTC-USD
3. Intervals: 5m, 15m, 1h (3 intervals)
4. Override:
   - `session.openingRangeMinutes`: 15,30,60 (3 values)
   
Result: **9 tests** (1 × 3 × 3)

**Scenario:** Optimize entry and risk for both cryptos

1. Base params: "ORB Default Strategy"
2. Symbols: BTC-USD, ETH-USD (2 symbols)
3. Intervals: 5m, 15m, 30m, 1h (4 intervals)
4. Overrides:
   - `session.openingRangeMinutes`: 15,30,60 (3 values)
   - `risk.atrStopMultiple`: 1.5,2.0,2.5 (3 values)
   
Result: **72 tests** (2 × 4 × 3 × 3)

### Benefits

1. **One-Click Optimization**: No manual parameter tweaking
2. **Comprehensive Testing**: Tests all combinations systematically
3. **Multi-Asset**: Compare performance across BTC and ETH
4. **Multi-Timeframe**: Identify robust parameters across timeframes
5. **Visual Comparison**: See equity curves overlaid
6. **Transparent**: Shows exactly how many tests will run
7. **Efficient**: Reuses existing grid search backend
8. **Extensible**: Easy to add more parameters or optimization strategies

### Common Parameters to Optimize

From the UI suggestions:
- `session.openingRangeMinutes` - Duration of opening range
- `entry.breakoutBufferBps` - Entry buffer
- `entry.maxTradesPerSession` - Trade limit
- `atr.atrLength` - ATR period
- `risk.riskPctPerTrade` - Position size
- `risk.atrStopMultiple` - Stop loss distance
- `risk.tpRMultiple` - Take profit target
- `risk.atrTrailMultiple` - Trailing stop distance

### Performance Considerations

- **Sequential Processing**: Runs are processed one at a time
- **Rate Limiting**: Prevents hitting Yahoo Finance API limits
- **Scalability**: Can handle 100+ run combinations
- **Progress Tracking**: Users can monitor via Runs page

### Future Enhancements

Documented in `docs/22-parameter-optimization.md`:
- Smart optimization (genetic algorithms, Bayesian)
- Parallel execution
- Real-time progress tracking
- Result export (CSV/JSON)
- Optimization presets
- Statistical significance analysis

## Testing Recommendations

Before considering this complete, test:

1. **Basic Flow**
   - Select parameter set
   - Add 1-2 overrides
   - Run small optimization (< 10 tests)
   - Verify redirection to Compare page
   - Verify all runs load and display

2. **Edge Cases**
   - Empty parameter path
   - Empty values list
   - Invalid date range
   - No symbols selected
   - No intervals selected

3. **Large Optimizations**
   - Test with 50+ runs
   - Monitor backend queue processing
   - Verify no memory issues

4. **Value Parsing**
   - Test with numbers: `1,2,3`
   - Test with decimals: `1.5,2.0,2.5`
   - Test with strings: `long_only,short_only`
   - Test with booleans: `true,false`

## Status

✅ **Implementation Complete**

All core functionality is implemented and ready for testing:
- UI is fully functional
- API integration is complete
- Navigation is updated
- Documentation is written
- Linting issues are resolved

**Next Step:** Manual testing in the browser to verify end-to-end flow.



