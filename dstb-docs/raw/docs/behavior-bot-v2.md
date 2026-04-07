# S2 Behavior Bot — Architecture & Operations Guide (v2)

> **Supersedes:** `docs/behavior-bot.md`
> All decisions from the design review are incorporated here. This is the authoritative reference.

---

## 1. Overview

The **S2 Behavior Bot** automatically classifies every daily BTC cycle at **Previous Day High (PDH)** and **Previous Day Low (PDL)** levels on the **Bitunix live exchange**. Phase 1 is observation-only (no live trades). It:

- Classifies every daily cycle using a **3-phase framework** (INTERACT → DECISION → OUTCOME)
- Writes completed rows to Google Sheets tab `S2-BO-BEHAVIOR-BTC` in real time
- Fires Telegram alerts when a directional DECISION is confirmed at a key level

> **Phase 2 (future):** Trade execution will be wired in using the existing `IExchangeAdapter` on Bitunix.

---

## 2. Time Foundation — MYT (UTC+8, No DST)

**All analysis times are in Malaysia Time (MYT = UTC+8).** MYT never observes Daylight Saving Time.

| Rule | UTC | MYT |
|---|---|---|
| Daily cycle start | 00:00:00 UTC | 08:00:00 MYT |
| Daily cycle end | 23:59:59 UTC | 07:59:59 MYT (next calendar day) |
| Asia Range window | 16:00:00 UTC prior day → 23:59:59 UTC prior day | 00:00:00 → 07:59:59 MYT |

The UTC calendar day IS the cycle. Cycle for "Monday" = 00:00 UTC Monday → 23:59 UTC Monday = 08:00 MYT Monday → 07:59 MYT Tuesday.

---

## 3. DST-Aware Session Windows

Although MYT has no DST, the **UK (London)** and **US (New York)** markets observe Daylight Saving Time. This shifts their opening and closing times when viewed in MYT.

### 3.1 DST Schedule Types

| Schedule | When Active | UK Offset | US Offset |
|---|---|---|---|
| **WINTER** | Nov first Sun → ~Mar 8 | GMT = UTC+0 | EST = UTC-5 |
| **TRANSITION** | ~Mar 8 → ~Mar 29, and ~Oct 25 → ~Nov 1 | GMT = UTC+0 | EDT = UTC-4 |
| **SUMMER** | ~Mar 29 → ~Oct 25 | BST = UTC+1 | EDT = UTC-4 |

> **Detection (Luxon):**
> ```typescript
> const isUkBST  = dt.setZone("Europe/London").offset === 60;    // +60 min = BST
> const isUsEDT  = dt.setZone("America/New_York").offset === -240; // -240 min = EDT
> // SUMMER = both; TRANSITION = one differs; WINTER = neither
> ```

### 3.2 Session Windows in MYT

All Asia sessions are fixed (Asia/Singapore has no DST). UK and US sessions shift 1h earlier in summer. During TRANSITION, only US shifts.

| Session | WINTER (MYT) | SUMMER (MYT) | TRANSITION (MYT) |
|---|---|---|---|
| `ASIA_PRE` | 08:00–08:59 | 08:00–08:59 | 08:00–08:59 |
| `ASIA_H1` | 09:00–10:59 | 09:00–10:59 | 09:00–10:59 |
| `ASIA_TP_H1` | 11:00–12:29 | 11:00–12:29 | 11:00–12:29 |
| `ASIA_H2` | 12:30–14:59 | 12:30–14:59 | 12:30–14:59 |
| `ASIA_TP_H2` | 15:00–15:59 | *(superseded by UK_PRE)* | 15:00–15:59 |
| `UK_PRE` | 16:00–16:59 | **15:00–15:59** | 16:00–16:59 |
| `UK_H1` | 17:00–18:59 | **16:00–17:59** | 17:00–18:59 |
| `UK_TP_H1` | 19:00–20:59 | **18:00–19:59** | 19:00–20:59 |
| `UK_H2` | 21:00–21:29 | **20:00–20:29** | *(no window — US_PRE starts at 20:30)* |
| `US_PRE` | 21:30–22:29 | **20:30–21:29** | **20:30–21:29** |
| `US_H1` | 22:30–00:59 | **21:30–23:59 + 00:00** | **21:30–23:59 + 00:00** |
| `UK_TP_H2` | *(absorbed by US_H1)* | *(absorbed by US_H1)* | *(absorbed by US_H1)* |
| `US_TP_H1` | 01:00–02:29 | **00:00–01:29** | **00:00–01:29** |
| `US_H2` | 02:30–03:59 | **01:30–02:59** | **01:30–02:59** |
| `US_TP_H2` | 04:00–04:59 | **03:00–03:59** | **03:00–03:59** |
| `MKT_CLOSED` | 05:00–06:29 | **04:00–05:29** | **04:00–05:29** |
| `MKT_RESET` | 06:30–07:59 | **05:30–07:59** | **05:30–07:59** |

**Priority rule:** When two sessions overlap, apply in order: US > UK > ASIA. This means `US_H1` takes over at its start time even if a UK label is technically in range.

### 3.3 Valid First Interaction Window

A PDH/PDL first interaction is **only tracked** if it occurs during an active market session (not `MKT_CLOSED` or `MKT_RESET`).

| Schedule | Valid window (MYT) |
|---|---|
| WINTER | 08:00:00 → 04:59:59 |
| SUMMER | 08:00:00 → 03:59:59 |
| TRANSITION | 08:00:00 → 03:59:59 |

If the first touch of PDH/PDL occurs after the active window ends → `NO_INTERACTION`. This also ensures the C3–C6 durability window and C1–C8 outcome window always fit within the remaining cycle (the latest valid confirmation is ~2.5h before cycle end in all schedules).

---

## 4. The Three-Phase Framework

Every daily cycle is analyzed across three sequential phases.

### Phase 1 — INTERACT (Observation)
*Did price interact with PDH or PDL, and how?*

| Field | Description |
|---|---|
| `Asia Range` | Which side of the Asia session range (00:00–07:59 MYT) price touched first. Touch = close at/beyond the level |
| `Previous-Day Level` | PDH or PDL — whichever candle **closed** at/beyond the level first |
| `Two-Candle Behavior` | Behavior of C1 (first interaction candle) and C2 (next candle) |
| `First Interaction Time` | Open time of C1 in MYT (HH:MM:SS) |
| `First Interaction Session` | DST-aware session label at C1's open time |

**Touch definition (all phases):** A candle "touches" a level only if its **close price** crosses the level:
- PDH touch: `close >= pdh`
- PDL touch: `close <= pdl`
- Wicks that reach the level but do not close there are ignored.

**Two-Candle Behavior:**
- `BREAK_HOLD` → C1 and C2 both close BEYOND the level (both `> pdh` or both `< pdl`)
- `TOUCH_REJECT` → C1 and C2 both close BACK INSIDE (both `< pdh` or both `> pdl`)
- `TOUCH_CONSOLIDATE` → one closes beyond, the other doesn't (or both hover at the level)
- `NO_INTERACTION` → no PDH/PDL close interaction during the valid session window

### Phase 2 — DECISION (Permission)
*Did the market commit to a direction?*

| Field | Description |
|---|---|
| `Decision Begin Type` | `ATT_BGN_EARLY` / `ATT_BGN_DEFAULT` / `ATT_IND` |
| `Decision Attempt #1 Output` | Result of the first 2-consecutive-candle scan: `ACCEPTANCE` / `REJECTION` / `INDECISIVE` |
| `Decision Confirm Time` | Close time of the 2nd confirming candle (C0 + 15 min) |
| `Failed Status` | C3–C6 durability result: `ACP_SUCC` / `ACP_FAIL_INV` / `REJ_SUCC` / `REJ_FAIL_INV` / `NONE` |
| `Resolved Decision Output` | Final structural outcome after C3–C6 |
| `Resolved Decision Strength` | Speed + friction quality label |

**Only Attempt #1 is tracked.** No second attempt after invalidation.

**Decision Begin Type rules:**
- `ATT_IND` → no interaction (firstInteractionCandleIndex = -1)
- `ATT_BGN_EARLY` → C1 and C2 both close cleanly on the same side of the level
- `ATT_BGN_DEFAULT` → C1/C2 are mixed; begin time is the first later "clean" candle
  - "Clean candle" = first candle that closes fully on one side: `close > pdh` OR `close < pdh` for PDH

**2-Consecutive-Candle Rule (Decision Output):**
- Scan forward from first interaction
- `ACCEPTANCE` → two consecutive candles both close BEYOND the level (`close > pdh` for PDH, `close < pdl` for PDL)
- `REJECTION` → two consecutive candles both close BACK INSIDE (`close < pdh` for PDH, `close > pdl` for PDL)
- `INDECISIVE` → no qualifying pair found within the cycle

**C3–C6 Durability Window:**
- C3 = `candles[confirmIndex + 1]` through C6 = `candles[confirmIndex + 4]`
- For `ACCEPTANCE`: two consecutive closes BACK INSIDE → `ACP_FAIL_INV`; else → `ACP_SUCC`
- For `REJECTION`: two consecutive closes BEYOND → `REJ_FAIL_INV`; else → `REJ_SUCC`
- If window has fewer than 4 candles (cycle end): use available candles; no pair found = success

**Retest/Reclaim definition (for strength scoring):**
- Retest (ACCEPTANCE): a candle within C1–C4 that **closes back at or below pdh** (after breaking above)
- Reclaim (REJECTION): a candle within C1–C4 that **closes back at or above pdl** (after dropping below)
- Wick-only touches do NOT count as retests or reclaims.

### Phase 3 — OUTCOME (Result)
*How much move followed the confirmed decision?*

| Field | Description |
|---|---|
| `Resolved Outcome Direction` | `CONTINUATION` / `MEAN-REVERSION` / `STALL` |
| `Resolved Outcome Quality` | MoveScore bucket: `MS_NOISE` / `MS_WEAK` / `MS_HEALTHY` / `MS_STRONG` |
| `Resolved Outcome Begin Time` | First candle in C1–C8 that qualifies as move start (HH:MM:SS or N/A) |
| `Outcome Peak Time` | Candle with highest high (UP) or lowest low (DOWN) within C1–C8 |
| `HTF 4H Edge` | `EDGE_ALIGN` / `EDGE_CONFLICT` / `MID_ALIGN` / `MID_NEUTRAL` |

**Expected Direction derivation:**
| Level | Decision | Expected Direction |
|---|---|---|
| PDH | ACCEPTANCE | UP (broke above PDH → continuation up) |
| PDH | REJECTION | DOWN (rejected at PDH → reversion down) |
| PDL | ACCEPTANCE | DOWN (broke below PDL → continuation down) |
| PDL | REJECTION | UP (rejected at PDL → reversion up) |
| Any | INDECISIVE | N/A |

**MoveScore:**
- Window = C1 to C8 (up to 8 × 15M candles = 2 hours after C0)
- If fewer than 8 candles remain in the cycle, use all available candles
- `MOVE (UP) = max(high, C1–C8) − decisionLevelPrice`
- `MOVE (DOWN) = decisionLevelPrice − min(low, C1–C8)`
- Clamp MOVE to 0 if negative (market went the wrong way)
- `MoveScore = MOVE ÷ ATR(15M, 14) at C0`
- Classify: `< 0.5` → `MS_NOISE`; `0.5–<1.0` → `MS_WEAK`; `1.0–<2.0` → `MS_HEALTHY`; `≥2.0` → `MS_STRONG`
- If ATR is null or 0 → MoveScore = 0
- If MoveScore < 0.5 → override direction to `STALL`

**Outcome Begin Time (first qualifying expansion candle, C1–C8):**
For UP direction, a candle qualifies if ALL THREE:
1. `close > previousClose`
2. `close > decisionLevelPrice`
3. `close − decisionLevelPrice ≥ ATR × 0.25`

For DOWN direction (flip all comparisons).

---

## 5. Module Architecture

```
src/
├── behavior/
│   ├── types.ts                              # All Zod schemas + enums + BehaviorRow + DailyCycleInput
│   ├── utils.ts                              # UTC+8 helpers, DST schedule, ATR, EMA, session classifier
│   ├── analyzer/
│   │   ├── interactAnalyzer.ts               # Phase 1: Asia Range, PDH/PDL close-touch, 2-candle, session
│   │   ├── decisionAnalyzer.ts               # Phase 2: begin type, 2-candle rule, C3-C6, resolved
│   │   ├── outcomeAnalyzer.ts                # Phase 3: MoveScore, direction, begin/peak time
│   │   ├── htfContextAnalyzer.ts             # 4H rolling range (N=12), EMA55/200, EDGE/MID label
│   │   └── BehaviorAnalyzer.ts               # Orchestrator: DailyCycleInput → BehaviorRow
│   ├── reporter/
│   │   └── BehaviorSheetsReporter.ts         # Google Sheets writer (bulk + incremental)
│   ├── bot/
│   │   └── BehaviorBot.ts                    # Live: Bitunix 15M subscription, cycle management
│   └── scripts/
│       └── runBehaviorBacktest.ts            # Standalone backtest script (Binance data → Sheets)
```

---

## 6. Integration Points

### 6.1 Candle Data

| Mode | Source | Why |
|---|---|---|
| **Backtest** | `fetchBinanceCandles()` (`src/data/binanceDataSource.ts`) | Full public history, no API key |
| **Live** | `BitunixAdapter.subscribeToCandles()` via `IExchangeAdapter` | Connected to the live exchange |

Both 15M and 4H candles are required per cycle:
- **15M** → INTERACT + DECISION + OUTCOME
- **4H** → HTF rolling range (N=12) + EMA55 + EMA200

> **EMA200 on 4H requires 200+ candles.** The `DailyCycleInput.candles4h` must contain at least **250 × 4H candles** (covering ~42 days before the cycle). Backtest fetches 4H data starting 45 days before `backtestStart`.

### 6.2 Asia Window Candles

The Asia Range window (00:00–07:59 MYT = 16:00–23:59 UTC prior day) falls OUTSIDE the current cycle's UTC range. These candles must be fetched and passed separately. `DailyCycleInput` includes `asiaCandles15m: readonly Candle[]` alongside `candles15m`.

### 6.3 Google Sheets

`BehaviorSheetsReporter` follows the same pattern as `src/monitoring/GoogleSheetsReporter.ts`:
- Same `SheetsClient`, `google.auth.GoogleAuth`, env vars
- **Bulk mode** (backtest): clear tab → write header → write rows in batches of 50 with 1s delay
- **Incremental mode** (live): append one row per completed daily cycle
- Always calls `ensureTab()` before any write operation
- Freezes row 1 (header) on tab creation

### 6.4 Telegram Alerts

| Event | Alert |
|---|---|
| Decision confirmed | `🔔 BTC PDH REJECTION confirmed @ 11:45 ASIA_TP_H1 → REJ_SUCC_IMP → MEAN-REVERSION expected` |
| Outcome begin confirmed | `📈 BTC Outcome started @ 12:30 — MEAN-REVERSION — MS_HEALTHY (1.4) — EDGE_ALIGN` |
| Daily cycle complete | `📋 BTC 02/01/2026 Summary: PDH REJECTION → MEAN-REVERSION MS_STRONG EDGE_ALIGN` |
| No interaction | `⚪ BTC 04/01/2026: No PDH/PDL interaction during active sessions` |

---

## 7. HTF 4H Edge — Full Logic

**Input:** Last 12 closed 4H candles at the decision confirm time.

```
RangeHigh  = max(high) over last 12 × 4H candles
RangeLow   = min(low)  over last 12 × 4H candles
RangeWidth = RangeHigh − RangeLow
EdgeBand   = RangeWidth × 0.20

Location:
  EDGE → decisionLevelPrice ≥ (RangeHigh − EdgeBand)
       OR decisionLevelPrice ≤ (RangeLow + EdgeBand)
  MID  → otherwise
  Guard: if RangeWidth < 1.0 (flat/degenerate range) → MID_NEUTRAL + warning

Bias (EMA55 / EMA200 on 4H closes at refIndex):
  EMA55 > EMA200 → BULL
  EMA55 < EMA200 → BEAR
  equal OR either null → NEUTRAL

Support:
  expectedDirection=UP  AND BULL  → SUPPORT
  expectedDirection=DOWN AND BEAR → SUPPORT
  all other combos                → NOT_SUPPORT

Combined:
  EDGE + SUPPORT     → EDGE_ALIGN
  EDGE + NOT_SUPPORT → EDGE_CONFLICT
  MID  + SUPPORT     → MID_ALIGN
  MID  + NOT_SUPPORT → MID_NEUTRAL

Fallbacks:
  refIndex < 0 (no 4H data)         → MID_NEUTRAL + warning
  fewer than 12 4H candles available → MID_NEUTRAL + warning
  expectedDirection = "N/A"          → MID_NEUTRAL
```

---

## 8. Strength Scoring — Full Logic

**Computed over C1–C4 (first 4 × 15M candles after C0, i.e., 1 hour).**

`ATR threshold = decisionLevelPrice ± ATR(15M,14)` — above for UP, below for DOWN.

**Speed classification:**
- `FAST` → threshold crossed by C1 or C2 high/low
- `MODERATE` → threshold crossed by C3 or C4 high/low
- `SLOW` → not crossed within C1–C4

**Friction (retest/reclaim) count within C1–C4:**
- Count only candles that CLOSE back through the decision level (see Section 4)

**Label assignment:**
| Resolved | Speed | Friction | Label |
|---|---|---|---|
| ACCEPTANCE | FAST | 0 | ACP_SUCC_IMP |
| ACCEPTANCE | FAST | 1 | ACP_SUCC_STR |
| ACCEPTANCE | MODERATE | ≤ 1 | ACP_SUCC_STR |
| ACCEPTANCE | any | ≥ 2 or SLOW | ACP_SUCC_WEAK |
| REJECTION | FAST | 0 | REJ_SUCC_IMP |
| REJECTION | FAST | 1 | REJ_SUCC_STR |
| REJECTION | MODERATE | ≤ 1 | REJ_SUCC_STR |
| REJECTION | any | ≥ 2 or SLOW | REJ_SUCC_WEAK |
| INDECISIVE | — | — | IND |

If C1–C4 window is incomplete (fewer than 4 candles at cycle end): use available candles.

---

## 9. Google Sheet — 49-Column Layout

The `S2-BO-BEHAVIOR-BTC` tab uses exactly 49 columns:

| Col | Field | Phase | Notes |
|---|---|---|---|
| A | Entry Date | Meta | `dd/mm/yyyy` — date the row was written |
| B | UID | Meta | Sequential number |
| C | TradingView Link | Meta | URL or blank |
| D | Pair | Meta | `$BTC` |
| E | Day | Meta | `Mon`, `Tue`, etc. |
| F | Day Owner | INTERACT | `DAY_PREV` / `DAY_CURR` |
| G | Date | INTERACT | `dd/mm/yyyy` of cycle |
| H | Date Owner | INTERACT | `DATE_PREV` / `DATE_CURR` |
| I | Asia Range | INTERACT | `AR_NONE` / `AR_SINGLE_H` / `AR_SINGLE_L` / `AR_BOTH_HL` / `AR_BOTH_LH` |
| J | Previous-Day Level | INTERACT | `PDH` / `PDL` / `PD_NONE` |
| K | Two-Candle Behavior | INTERACT | `BREAK_HOLD` / `TOUCH_REJECT` / `TOUCH_CONSOLIDATE` / `NO_INTERACTION` |
| L | First Interaction Time | INTERACT | `HH:MM:SS` or `N/A` |
| M | First Interaction Session | INTERACT | DST-aware session label |
| N | Entry Price ($) | TRADE | blank (Phase 1) |
| O | Leverage (X) | TRADE | blank |
| P | Margin Used ($) | TRADE | blank |
| Q | Position Size (Units) | TRADE | blank |
| R | Account Risk | TRADE | blank |
| S | Stop Loss Price ($) | TRADE | blank |
| T | Take Profit Price ($) | TRADE | blank |
| U | R | TRADE | blank |
| V | Fees ($) | TRADE | blank |
| W | Exit Price ($) | TRADE | blank |
| X | Exit Date & Time | TRADE | blank |
| Y | Gross P/L | TRADE | blank |
| Z | Net P/L | TRADE | blank |
| AA | Decision Begin Type | DECISION | `ATT_BGN_EARLY` / `ATT_BGN_DEFAULT` / `ATT_IND` |
| AB | Decision Begin Time | DECISION | `HH:MM:SS` or `N/A` |
| AC | Decision Attempt #1 Output | DECISION | `ACCEPTANCE` / `REJECTION` / `INDECISIVE` |
| AD | Decision Confirm Time | DECISION | `HH:MM:SS` or `N/A` |
| AE | Failed Status | DECISION | `ACP_SUCC` / `ACP_FAIL_INV` / `REJ_SUCC` / `REJ_FAIL_INV` / `NONE` |
| AF | Resolved Decision Output | DECISION | `ACCEPTANCE` / `REJECTION` / `INDECISIVE` |
| AG | Resolved Decision Strength | DECISION | `ACP_SUCC_IMP` etc. |
| AH | Resolved Outcome Direction | OUTCOME | `CONTINUATION` / `MEAN-REVERSION` / `STALL` |
| AI | Resolved Outcome Quality | OUTCOME | `MS_NOISE` / `MS_WEAK` / `MS_HEALTHY` / `MS_STRONG` |
| AJ | Resolved Outcome Begin Time | OUTCOME | `HH:MM:SS` or `N/A` |
| AK | Outcome Peak Time | OUTCOME | `HH:MM:SS` or `N/A` |
| AL | HTF 4H Edge | OUTCOME | `EDGE_ALIGN` / `EDGE_CONFLICT` / `MID_ALIGN` / `MID_NEUTRAL` |
| AM | HTF 4H Edge Link | OUTCOME | URL or blank |
| AN | Notes | Meta | Auto-generated summary string |
| AO | Win | Stats | Sheet formula |
| AP | Loss | Stats | Sheet formula |
| AQ | Win$ | Stats | Sheet formula |
| AR | Loss$ | Stats | Sheet formula |
| AS | In Use | Stats | Sheet formula |
| AT | Month | Stats | `toMonthString()` — populated by bot, NOT a formula |
| AU | Consecutive Wins | Stats | Sheet formula |
| AV | Consecutive Losses | Stats | Sheet formula |
| AW | UID Link | Stats | Sheet formula |

> **Note on column AT (Month):** This is a plain string (`"January"`, `"February"`, etc.) derived from the cycle date, not a sheet formula. The bot populates it directly.

---

## 10. Configuration

```bash
# .env additions for the behavior bot (auth env vars already exist)
BEHAVIOR_PAIR=BTCUSDT
BEHAVIOR_BACKTEST_START=2026-01-01
BEHAVIOR_SHEET_TAB=S2-BO-BEHAVIOR-BTC
BEHAVIOR_TELEGRAM_ALERTS=true
```

---

## 11. Running the Backtest

### Prerequisites
1. `.env` configured with `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`
2. Service account JSON file present
3. Google Sheet has service account as **Editor**

### Commands

```powershell
# Dry run (analyze only, no sheet write)
npm run bot -- behavior:backtest --dry-run --verbose

# Full run (Jan 1 2026 → today)
npm run bot -- behavior:backtest --verbose

# Custom date range
npm run bot -- behavior:backtest --start 2026-01-01 --end 2026-03-01
```

### What Happens

1. Fetches 15M candles from Binance: `backtestStart - 1 day` → `backtestEnd` (the extra day provides Dec 31 data for Jan 1 PDH/PDL)
2. Fetches 4H candles from Binance: `backtestStart - 45 days` → `backtestEnd` (45 days × 6 bars/day = 270 bars for EMA200 warm-up)
3. For each daily cycle:
   - PDH = `max(high)` of all 15M candles in the prior UTC cycle
   - PDL = `min(low)` of all 15M candles in the prior UTC cycle
   - Runs INTERACT → DECISION → OUTCOME → HTF analyzers
4. Clears and rewrites the `S2-BO-BEHAVIOR-BTC` sheet tab
5. Sends Telegram completion summary

---

## 12. Going Live

### Start

```powershell
# Start behavior live bot
npm run bot -- behavior:live --config configs/bot-live-btc-bitunix.json --verbose
```

### Stop

```powershell
# Graceful stop (SIGINT or SIGTERM)
npm run bot -- stop <bot-id>
# OR press Ctrl+C in the terminal
```

### Live Bot Behavior

| Event | Action |
|---|---|
| 15M candle closes on Bitunix | Add to accumulator; run incremental INTERACT/DECISION check |
| Decision confirmed | Send Telegram alert immediately |
| Outcome Begin confirmed | Send Telegram alert |
| Cycle rollover (00:00 UTC) | Finalize cycle, append row to Sheet, reset state |
| WebSocket disconnect | Auto-reconnect; Telegram CRITICAL alert once per event |

---

## 13. Error Handling

| Scenario | Behavior |
|---|---|
| Binance rate limit during backtest | Retry 3× with exponential backoff |
| Bitunix WebSocket disconnect | Reconnect indefinitely every 5s; Telegram alert once per event |
| Google Sheets API failure | Retry 3×; log warning on all failures |
| Empty cycle (no 15M candles) | Write `"NO_DATA"` row with all fields `"N/A"` |
| No valid interaction (outside session window) | All INTERACT/DECISION/OUTCOME fields = `"N/A"` / `"NO_INTERACTION"` |
| EMA200 insufficient 4H candles (< 200 at refIndex) | Bias = `NEUTRAL`; htfEdge = `"MID_NEUTRAL"`; log warning |

---

## 14. Module Dependency Map

```
behavior/types.ts
  └── behavior/utils.ts (DST schedule, session classifier, ATR, EMA, time helpers)
        ├── behavior/analyzer/interactAnalyzer.ts
        │     (needs: types, utils — asiaCandles + candles15m, close-touch rule)
        ├── behavior/analyzer/decisionAnalyzer.ts
        │     (needs: types, utils, InteractResult — close-touch, ATR, strength)
        ├── behavior/analyzer/outcomeAnalyzer.ts
        │     (needs: types, utils, DecisionResult — MoveScore, clamped MOVE)
        ├── behavior/analyzer/htfContextAnalyzer.ts
        │     (needs: types, utils — 250+ 4H candles, EMA200, range guard)
        └── behavior/analyzer/BehaviorAnalyzer.ts  (orchestrates all 4)
              ├── behavior/reporter/BehaviorSheetsReporter.ts
              │     (ensureTab on every write, freeze row 1, batch 50)
              ├── behavior/scripts/runBehaviorBacktest.ts
              │     (Binance, 15M-1day pre-fetch, 250+ 4H, PDH/PDL from 15M)
              └── behavior/bot/BehaviorBot.ts
                    (closed-candle filter, dedup, SIGTERM, cycle-only candles on startup)
```
