## Backend Backtest CLI Guide (JSONL + Google Sheets)

This repo includes a backend-only CLI runner that executes a backtest **without HTTP**, writes results to a **JSONL** file (one JSON object per line), and includes a helper script to convert JSONL → CSV for Google Sheets.

### What you get
- **Run a single backtest from terminal** via `npm run backtest ...`
- **Results written automatically** to `apps/api/optimization-results/results-<timestamp>.jsonl`
- **Convert JSONL → CSV** for Google Sheets import via `node scripts/jsonl-to-csv.js ...`

### Prerequisites
- **Windows 11 + PowerShell** (works in Cursor’s integrated terminal).
- **Node.js** installed.
- An `.env` file (or environment variables) with:
  - **`SUPABASE_URL`**
  - **`SUPABASE_SERVICE_ROLE_KEY`**
  - Optional: **`ENGINE_VERSION`** (defaults to `"dev"`)

Notes:
- The CLI uses the existing job runner `processBacktestRun()`, which reads a run row from Supabase. So it **creates one `backtest_runs` row** (no DB schema changes).
- Data is fetched from **Binance** (e.g. `ZEC-USD → ZECUSDT`).

### Supported symbols
- `BTC-USD`
- `ETH-USD`
- `ZEC-USD`

### Direction mode behavior (important)
The backtest engine is currently hardcoded to always allow **both long and short** entries (even if `directionMode` is `"long_only"` / `"short_only"`). The field stays in schemas for compatibility.

### Run a backtest (CLI)
Run from the `apps/api` folder:

```bash
npm run backtest -- --symbol ZEC-USD --interval 15m --start 2025-01-01T00:00:00.000Z --end 2025-12-31T23:59:00.000Z --initialEquity 10000
```

Expected output includes a line like:
- `Results written to: optimization-results/results-2026-01-12T12-34-56-789Z.jsonl`

The JSONL file will be created under:
- `apps/api/optimization-results/`

### Convert JSONL → CSV for Google Sheets
From the `apps/api` folder:

```bash
node scripts/jsonl-to-csv.js optimization-results/results-2026-01-12T12-34-56-789Z.jsonl > results.csv
```

The CSV has these columns:
- `runId, symbol, interval, finalEquity, totalReturnPct, maxDrawdownPct, winRatePct, profitFactor, tradeCount`
- Plus flattened params columns (when present): `openingRangeMinutes, breakoutBufferBps, directionMode, riskPctPerTrade, atrStopMultiple, tpRMultiple, atrTrailMultiple`

### High-performance batch grid runner (no DB)
This is the fastest way to run **hundreds/thousands** of parameter combinations:
- Fetches candles **once per (symbol, interval, dateRange)**
- Runs `runBacktest()` directly in-memory with configurable concurrency
- Streams results to JSONL as tests complete

#### Use the included example config
Start with:
- `apps/api/grid-config.example.json` - Working example with 5 common parameters
- `apps/api/ALL-PARAMETERS-REFERENCE.md` - Complete reference of ALL 20+ overrideable parameters

Run it from `apps/api`:

```bash
npm run backtest:batch -- --config grid-config.example.json
```

#### Concurrency tuning
- **Default:** `concurrency: 10`
- **Recommended:** 1.5-2x your CPU core count
- **Example:** 8-core CPU → use `12-16` for optimal speed
- **Yes, you can go higher!** You can set it to 50+ if you want
  - Backtests are CPU-intensive, so context switching overhead increases
  - Test to see what works best for your system
  - Higher isn't always faster due to CPU contention

#### Output
- By default, output goes to the path in the config under `options.outputFile`
- The runner prints: `Results written to: optimization-results/...jsonl`

### Import into Google Sheets
- Open Google Sheets
- **File → Import** → Upload `results.csv`
- Use **“Replace spreadsheet”** or **“Insert new sheet(s)”** (your choice)

### Troubleshooting
- **Missing env vars**: if you see env validation errors, ensure `.env` contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- **No output file**: ensure you ran the command from `apps/api` (the output path is relative to `process.cwd()`).
- **Binance errors**: confirm your network allows outbound HTTPS to Binance endpoints.

