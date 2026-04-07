# S2 Behavior Bot — Architecture & Operations Guide

## 1. Overview

The **S2 Behavior Bot** is a market observation and journaling system that tracks how BTC price behaves at **Previous Day High (PDH)** and **Previous Day Low (PDL)** levels on the Bitunix live exchange. It does not place trades automatically (in Phase 1), but it:

- **Automatically classifies** every daily BTC cycle using a strict 3-phase framework (INTERACT → DECISION → OUTCOME)
- **Logs every result** to a dedicated Google Sheets tab (`S2-BO-BEHAVIOR-BTC`) in real time
- **Fires Telegram alerts** when the market confirms a directional decision at key levels
- **Supports a one-shot backtest mode** to populate all historical data from Jan 1 2026 to today

> Phase 2 (future): When trade fields are enabled, the bot will execute live trades on Bitunix at confirmed DECISION events.

---

## 2. The Three-Phase Framework

Every daily BTC cycle (08:00:00 UTC+8 → 07:59:59 UTC+8 next day) is analyzed across three phases:

### Phase 1 — INTERACT (Observation)
*Did price interact with PDH or PDL, and how?*

| Field | Description |
|---|---|
| `Asia Range` | Which side of the Asia session range (00:00–07:59 UTC+8) price touched first |
| `Previous-Day Level` | PDH or PDL — whichever was touched first during the cycle |
| `Two-Candle Behavior` | How the first two 15M candles behaved after initial PDH/PDL touch: BREAK_HOLD / TOUCH_REJECT / TOUCH_CONSOLIDATE / NO_INTERACTION |
| `First Interaction Time` | Open time (HH:MM:SS UTC+8) of the first 15M candle that touched PDH or PDL |
| `First Interaction Session` | Which trading session phase the interaction occurred in (ASIA_PRE, UK_H1, US_H2, etc.) |

### Phase 2 — DECISION (Permission)
*Did the market commit to a direction at the level?*

| Field | Description |
|---|---|
| `Decision Begin Type` | How the attempt started: ATT_BGN_EARLY (candles 1&2 clean) / ATT_BGN_DEFAULT (mixed, waited) / ATT_IND (no interaction) |
| `Decision Begin Time` | Timestamp of the first directional attempt |
| `Decision Attempt #1 Output` | ACCEPTANCE / REJECTION / INDECISIVE — from 2-consecutive-candle rule |
| `Decision Confirm Time` | Close time of the 2nd confirming candle |
| `Failed Status` | Did the confirmed attempt survive C3–C6? ACP_SUCC / ACP_FAIL_INV / REJ_SUCC / REJ_FAIL_INV / NONE |
| `Resolved Decision Output` | True final structural outcome after C3–C6: ACCEPTANCE / REJECTION / INDECISIVE |
| `Resolved Decision Strength` | Speed + friction quality: ACP_SUCC_IMP / ACP_SUCC_STR / ACP_SUCC_WEAK / REJ_SUCC_IMP / REJ_SUCC_STR / REJ_SUCC_WEAK / IND |

### Phase 3 — OUTCOME (Result)
*How much move followed the confirmed decision?*

| Field | Description |
|---|---|
| `Resolved Outcome Direction` | CONTINUATION / MEAN-REVERSION / STALL |
| `Resolved Outcome Quality` | MoveScore vs ATR: MS_NOISE (<0.5) / MS_WEAK (0.5–1.0) / MS_HEALTHY (1.0–2.0) / MS_STRONG (≥2.0) |
| `Resolved Outcome Begin Time` | First 15M candle (C1–C8) showing measurable expansion — closes ≥ ¼ ATR beyond decision level |
| `Outcome Peak Time` | Timestamp of highest high (UP) or lowest low (DOWN) within the 2-hour window |
| `HTF 4H Edge` | 4H structural context: EDGE_ALIGN / EDGE_CONFLICT / MID_ALIGN / MID_NEUTRAL |

---

## 3. Module Architecture

```
src/
├── behavior/
│   ├── types.ts                              # All enums + BehaviorRow type (Zod schemas)
│   ├── utils.ts                              # UTC+8 helpers, ATR calc, session classifier
│   ├── analyzer/
│   │   ├── interactAnalyzer.ts               # Phase 1: Asia Range, PDH/PDL, 2-candle, session
│   │   ├── decisionAnalyzer.ts               # Phase 2: begin type, 2-candle rule, C3-C6, resolved
│   │   ├── outcomeAnalyzer.ts                # Phase 3: direction, MoveScore, begin/peak time
│   │   ├── htfContextAnalyzer.ts             # 4H rolling range (N=12), EMA55/200, EDGE/MID/ALIGN
│   │   └── BehaviorAnalyzer.ts               # Orchestrator: takes candles → returns BehaviorRow
│   ├── reporter/
│   │   └── BehaviorSheetsReporter.ts         # Writes to "S2-BO-BEHAVIOR-BTC" Google Sheets tab
│   ├── bot/
│   │   └── BehaviorBot.ts                    # Live: 15M scheduler, Telegram alerts, daily write
│   └── scripts/
│       └── runBehaviorBacktest.ts            # CLI script: Jan 1 2026 → today, bulk write to sheet
```

---

## 4. Integration Points with Existing Infrastructure

### 4.1 Data Source (Candles)

| Mode | Source | Why |
|---|---|---|
| **Backtest** | `fetchBinanceCandles()` (existing in `src/data/binanceDataSource.ts`) | Full historical data, no API key needed, reliable |
| **Live** | `BitunixAdapter.getLatestCandles()` via `IExchangeAdapter` | Consistent with the live exchange already connected |

Both 15M and 4H candles are required:
- **15M** → INTERACT + DECISION + OUTCOME analysis
- **4H** → HTF rolling range (last 12 closed 4H candles) + EMA55/EMA200

The existing `CandleCache` (`src/data/candleCache.ts`) is reused for the backtest to avoid redundant Binance fetches.

### 4.2 Google Sheets (Reporting)

`BehaviorSheetsReporter` follows the **exact same pattern** as `GoogleSheetsReporter` (`src/monitoring/GoogleSheetsReporter.ts`):
- Uses the same `SheetsClient` interface and `google.auth.GoogleAuth` setup
- Reads `GOOGLE_SHEETS_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` from the same env vars
- Adds `"S2-BO-BEHAVIOR-BTC"` to the list of managed tabs
- **Bulk mode** (backtest): clears tab, writes header row, then appends rows in batches of 50
- **Incremental mode** (live): appends one row per completed daily cycle

The sheet tab has **49 columns** matching the original CSV exactly, including the trade fields as empty placeholders (so Phase 2 trade integration adds data without reshuffling columns).

### 4.3 Telegram Alerts

`BehaviorBot` receives an injected `TelegramAlerter` instance and fires alerts at these trigger points:

| Event | Alert Example |
|---|---|
| Resolved Decision confirmed | `🔔 BTC PDH REJECTION confirmed @ 11:45 ASIA_TP_H1 → REJ_SUCC_IMP → MEAN-REVERSION expected` |
| Outcome Begin confirmed | `📈 BTC Outcome started @ 12:30 — MEAN-REVERSION — MS_HEALTHY (1.4) — EDGE_ALIGN` |
| Daily cycle complete | `📋 BTC 02/01/2026 Summary: PDH REJECTION → MEAN-REVERSION MS_STRONG (2.1) EDGE_ALIGN` |
| No interaction day | `⚪ BTC 04/01/2026: No PDH/PDL interaction (STALL day)` |

### 4.4 Bitunix Exchange (Live Data)

The live `BehaviorBot` connects to Bitunix using the existing `BitunixAdapter` and `BitunixMarketApi.getKline()`:
- Subscribes to 15M candle updates via `subscribeToCandles()`
- Fetches the last 200 15M candles for the current cycle on startup
- Fetches the last 50 4H candles for HTF context

**For Phase 2 (future trades):** The bot will use:
- `placeMarketOrder()` — enter at confirmed DECISION
- `placeStopLossOrder()` + `placeTakeProfitOrder()` — set risk levels
- `cancelOrder()` — if decision is invalidated (ACP_FAIL_INV / REJ_FAIL_INV)

---

## 5. Key Time Logic

All analysis is anchored to **UTC+8 (Singapore/Malaysia time)**.

| Rule | Detail |
|---|---|
| **Daily cycle** | 08:00:00 UTC+8 (start) → 07:59:59 UTC+8 next day (end) |
| **UTC equivalent** | 00:00:00 UTC (start) → 23:59:59 UTC (end) |
| **Asia Range window** | 00:00:00–07:59:59 UTC+8 = 16:00:00–23:59:59 UTC (prior calendar day) |
| **Day Owner rule** | If first interaction time < 08:00:00 UTC+8 → DAY_PREV; else DAY_CURR |
| **Date Owner rule** | Same as Day Owner but for calendar date labeling |
| **1D candle** | Previous Day High/Low taken from the closed 1D UTC+8 candle |

**Luxon** (already a dependency) is used for all timezone-aware math:
```typescript
import { DateTime } from "luxon";
const utc8Time = DateTime.fromMillis(timestampMs, { zone: "Asia/Singapore" });
```

---

## 6. Configuration

Add the following to your `.env` file:

```bash
# ─── Behavior Bot ────────────────────────────────────────────────
# Google Sheets (reuses existing vars — no new ones needed for auth)
GOOGLE_SHEETS_ID=your_sheet_id_here
GOOGLE_SERVICE_ACCOUNT_KEY=./google-service-account.json

# Telegram (reuses existing vars)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Behavior Bot Settings
BEHAVIOR_PAIR=BTCUSDT
BEHAVIOR_TIMEZONE=Asia/Singapore
BEHAVIOR_BACKTEST_START=2026-01-01
BEHAVIOR_SHEET_TAB=S2-BO-BEHAVIOR-BTC
BEHAVIOR_TELEGRAM_ALERTS=true

# Bitunix (live mode only — reuses existing bot config)
# These are already set in your bot config JSON files
```

---

## 7. Running the Backtest

The backtest populates all historical data from Jan 1 2026 to today in one shot.

### Prerequisites
1. `.env` file configured with `GOOGLE_SHEETS_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY`
2. Google Service Account JSON file at the path specified in `GOOGLE_SERVICE_ACCOUNT_KEY`
3. The Google Sheet must have the service account as an **Editor**
4. Internet connection to reach the Binance public API (no API key needed)

### Run the Backtest

```powershell
# From the project root
npm run bot -- behavior:backtest

# Optional: specify a custom date range
npm run bot -- behavior:backtest --start 2026-01-01 --end 2026-03-01

# Optional: dry-run (analyze but do not write to sheet)
npm run bot -- behavior:backtest --dry-run

# Optional: verbose output
npm run bot -- behavior:backtest --verbose
```

### What Happens

1. **Fetches all 15M candles** for BTCUSDT from Binance (Jan 1 2026 → today)
2. **Fetches all 4H candles** for BTCUSDT from Binance (Dec 15 2025 → today for rolling range pre-warm)
3. **Splits candles into daily cycles** by 08:00:00 UTC+8 boundaries
4. **For each day cycle:**
   - Computes PDH and PDL from the closed 1D candle (UTC+8)
   - Runs all 4 analyzers → produces one `BehaviorRow`
5. **Clears** the `S2-BO-BEHAVIOR-BTC` sheet tab (or creates it if missing)
6. **Writes header row** then **appends all rows** in batches of 50
7. **Sends a Telegram summary**: `"✅ Backtest complete: 60 days logged to S2-BO-BEHAVIOR-BTC"`

Expected run time: ~30–60 seconds for 60 days of data.

---

## 8. Going Live (Real-Time Bot)

The live bot watches every new 15M Bitunix candle and updates the sheet in real time.

### Prerequisites
1. All backtest prerequisites above
2. A running Bitunix connection (API key + secret key in your bot config)
3. The backtest has already been run (so historical data is in the sheet)

### Start the Live Bot

```powershell
# Start the behavior bot as part of the main server
npm run start

# OR start as a standalone CLI process
npm run bot -- behavior:live --config configs/bot-live-eth-bitunix.json

# With verbose logging
npm run bot -- behavior:live --config configs/bot-live-eth-bitunix.json --verbose
```

### What Happens at Runtime

The live bot runs on a **15-minute polling cycle** synchronized to UTC+8 time boundaries:

| Event | Action |
|---|---|
| Every 15M candle close | Checks for first PDH/PDL interaction in current cycle |
| Decision confirmed (ACCEPTANCE/REJECTION) | Fires immediate Telegram alert |
| Outcome Begin confirmed | Fires Telegram alert with MoveScore |
| 07:59:59 UTC+8 (cycle end) | Runs full analysis, appends row to Google Sheet, sends daily summary |
| Cycle rollover (08:00:00 UTC+8) | Resets internal cycle state, fetches new PDH/PDL |

### Stopping the Live Bot

```powershell
# Via CLI
npm run bot -- stop <bot-id>

# Via Telegram (using existing command)
/stop <bot-id>
```

---

## 9. Google Sheet Column Layout

The `S2-BO-BEHAVIOR-BTC` tab uses **49 columns** in this exact order:

| # | Column | Type | Phase |
|---|---|---|---|
| A | Entry Date | Date | Meta |
| B | UID | Number | Meta |
| C | TradingView Link | URL | Meta |
| D | Pair | String | Meta |
| E | Day | String | Meta |
| F | Day Owner | DAY_PREV \| DAY_CURR | INTERACT |
| G | Date (dd/mm/yyyy) | String | INTERACT |
| H | Date Owner | DATE_PREV \| DATE_CURR | INTERACT |
| I | Asia Range | AR_NONE \| AR_SINGLE_H \| AR_SINGLE_L \| AR_BOTH_HL \| AR_BOTH_LH | INTERACT |
| J | Previous-Day Level | PDH \| PDL \| PD_NONE | INTERACT |
| K | Two-Candle Behavior | BREAK_HOLD \| TOUCH_REJECT \| TOUCH_CONSOLIDATE \| NO_INTERACTION | INTERACT |
| L | First Interaction Time | HH:MM:SS \| N/A | INTERACT |
| M | First Interaction Session | Session label (see Section 2) | INTERACT |
| N | Entry Price ($) | Number (empty Phase 1) | TRADE |
| O | Leverage (X) | Number (empty Phase 1) | TRADE |
| P | Margin Used ($) | Number (empty Phase 1) | TRADE |
| Q | Position Size (Units) | Number (empty Phase 1) | TRADE |
| R | Account Risk | String (empty Phase 1) | TRADE |
| S | Stop Loss Price ($) | Number (empty Phase 1) | TRADE |
| T | Take Profit Price ($) | Number (empty Phase 1) | TRADE |
| U | R | Number (empty Phase 1) | TRADE |
| V | Fees ($) | Number (empty Phase 1) | TRADE |
| W | Exit Price ($) | Number (empty Phase 1) | TRADE |
| X | Exit Date & Time | DateTime (empty Phase 1) | TRADE |
| Y | Gross P/L | Number (empty Phase 1) | TRADE |
| Z | Net P/L | Number (empty Phase 1) | TRADE |
| AA | Decision Begin Type | ATT_BGN_EARLY \| ATT_BGN_DEFAULT \| ATT_IND | DECISION |
| AB | Decision Begin Time | HH:MM:SS \| N/A | DECISION |
| AC | Decision Attempt #1 Output | ACCEPTANCE \| REJECTION \| INDECISIVE | DECISION |
| AD | Decision Confirm Time | HH:MM:SS \| N/A | DECISION |
| AE | Failed Status | ACP_SUCC \| ACP_FAIL_INV \| REJ_SUCC \| REJ_FAIL_INV \| NONE | DECISION |
| AF | Resolved Decision Output | ACCEPTANCE \| REJECTION \| INDECISIVE | DECISION |
| AG | Resolved Decision Strength | ACP_SUCC_IMP \| ACP_SUCC_STR \| ACP_SUCC_WEAK \| REJ_SUCC_IMP \| REJ_SUCC_STR \| REJ_SUCC_WEAK \| IND | DECISION |
| AH | Resolved Outcome Direction | CONTINUATION \| MEAN-REVERSION \| STALL | OUTCOME |
| AI | Resolved Outcome Quality | MS_NOISE \| MS_WEAK \| MS_HEALTHY \| MS_STRONG | OUTCOME |
| AJ | Resolved Outcome Begin Time | HH:MM:SS \| N/A | OUTCOME |
| AK | Outcome Peak Time | HH:MM:SS \| N/A | OUTCOME |
| AL | HTF 4H Edge | EDGE_ALIGN \| EDGE_CONFLICT \| MID_ALIGN \| MID_NEUTRAL | OUTCOME |
| AM | HTF 4H Edge Link | URL | OUTCOME |
| AN | Notes | String | Meta |
| AO | Win | Formula | Stats |
| AP | Loss | Formula | Stats |
| AQ | Win$ | Formula | Stats |
| AR | Loss$ | Formula | Stats |
| AS | In Use | Boolean | Stats |
| AT | Month | String | Stats |
| AU | Consecutive Wins | Formula | Stats |
| AV | Consecutive Losses | Formula | Stats |
| AW | UID Link | Formula | Stats |

---

## 10. Decision Logic Reference

### ATR Calculation
- Uses `ATR(15M, 14)` — a 14-period Average True Range on the 15-minute timeframe
- Measured at the **Resolved Confirm Candle** (close of the 2nd confirming candle)
- Used for: MoveScore normalization, ¼ ATR qualification threshold, 1 ATR speed threshold

### Candle Reference System
After a Decision is confirmed at candle C0 (the 2nd confirming candle closes):

| Label | Meaning |
|---|---|
| C0 | Decision confirmation candle (2nd confirming candle) |
| C1–C4 | Next 4 × 15M candles (first 1 hour = durability + speed window) |
| C5–C6 | Candles 5–6 (part of durability window C3–C6) |
| C1–C8 | Full 8 × 15M candles (2-hour outcome window) |

### Resolved Decision Strength Scoring

For ACCEPTANCE:
| Label | Condition |
|---|---|
| `ACP_SUCC_IMP` | 1 ATR reached within C1–C2 AND 0 retests |
| `ACP_SUCC_STR` | (1 ATR in C1–C2 AND 1 retest) OR (1 ATR in C3–C4 AND ≤1 retest) |
| `ACP_SUCC_WEAK` | 2+ retests OR 1 ATR not reached within C1–C4 |

For REJECTION:
| Label | Condition |
|---|---|
| `REJ_SUCC_IMP` | 1 ATR reached within C1–C2 AND 0 reclaims |
| `REJ_SUCC_STR` | (1 ATR in C1–C2 AND 1 reclaim) OR (1 ATR in C3–C4 AND ≤1 reclaim) |
| `REJ_SUCC_WEAK` | 2+ reclaims OR 1 ATR not reached within C1–C4 |

### MoveScore Calculation
```
MOVE (UP)   = Highest High in C1–C8 window − Decision Level Price
MOVE (DOWN) = Decision Level Price − Lowest Low in C1–C8 window
MoveScore   = MOVE ÷ ATR(15M, 14) at Resolved Confirm Candle
```

### HTF 4H Edge Calculation
```
Rolling Range = Last 12 closed 4H candles (measured at Decision Confirm Time)
RangeWidth    = 4H_RH (highest high) − 4H_RL (lowest low)
EdgeBand      = RangeWidth × 0.20  (top/bottom 20% of range)

Location:
  EDGE → if Decision Level ≥ (4H_RH − EdgeBand) OR ≤ (4H_RL + EdgeBand)
  MID  → otherwise

Bias:
  BULL → 4H EMA55 > 4H EMA200
  BEAR → 4H EMA55 < 4H EMA200
  NEUTRAL → neither (auto = NOT_SUPPORT)

Combined Label:
  EDGE + SUPPORT     → EDGE_ALIGN
  EDGE + NOT_SUPPORT → EDGE_CONFLICT
  MID  + SUPPORT     → MID_ALIGN
  MID  + NOT_SUPPORT → MID_NEUTRAL
```

---

## 11. Phase 2: Trade Execution (Future)

When trade fields are enabled, the bot will execute on **confirmed DECISION events** using Bitunix futures:

| Signal | Action |
|---|---|
| ACCEPTANCE confirmed (PDH) | Long entry at market |
| REJECTION confirmed (PDH) | Short entry at market |
| ACCEPTANCE confirmed (PDL) | Short entry at market |
| REJECTION confirmed (PDL) | Long entry at market |

Trade execution will use:
- `IExchangeAdapter.placeMarketOrder()` — entry
- `IExchangeAdapter.placeStopLossOrder()` — stop at invalidation level
- `IExchangeAdapter.placeTakeProfitOrder()` — TP at MoveScore projection
- `IExchangeAdapter.cancelOrder()` — if ACP_FAIL_INV / REJ_FAIL_INV during C3–C6

The existing `RiskManager`, `PositionManager`, and `OrderExecutor` from `src/core/` will be wired in at that stage.

---

## 12. Error Handling

| Scenario | Behavior |
|---|---|
| Binance API fails during backtest | Retry 3× with exponential backoff; abort with error log |
| Bitunix WebSocket disconnect during live | Auto-reconnect via existing `BitunixWebSocket` reconnection logic |
| Google Sheets API rate limit | Exponential backoff, max 3 retries; log warning if all fail |
| Day cycle with no candle data | Log warning, write row with all fields = "N/A" / "NO_INTERACTION" |
| PDH = PDL (flat day) | Treat as PD_NONE, log warning |

---

## 13. File Dependencies Map

```
behavior/types.ts
  └── behavior/utils.ts
        ├── behavior/analyzer/interactAnalyzer.ts
        ├── behavior/analyzer/decisionAnalyzer.ts
        ├── behavior/analyzer/outcomeAnalyzer.ts
        ├── behavior/analyzer/htfContextAnalyzer.ts
        └── behavior/analyzer/BehaviorAnalyzer.ts  (orchestrates all 4)
              ├── behavior/reporter/BehaviorSheetsReporter.ts
              ├── behavior/scripts/runBehaviorBacktest.ts
              └── behavior/bot/BehaviorBot.ts
                    ├── src/monitoring/TelegramAlerter.ts  (existing)
                    └── src/exchange/BitunixAdapter.ts     (existing)
```
