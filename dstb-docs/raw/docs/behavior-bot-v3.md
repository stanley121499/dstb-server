# S2 Behavior Bot — Architecture & Operations Guide (v3)

> **Supersedes:** `docs/behavior-bot-v2.md`
> Incorporates Darren's lifecycle update: row identity = First Interaction Event (not calendar day),
> no session gate restriction, lifecycle can cross the 08:00 MYT daily boundary, and the new
> "Lifecycle Crossed Day Boundary" column (50 columns total).

---

## 1. Core Principle — Lifecycle Identity

> **A row in the sheet = ONE First Interaction Event, not ONE calendar day.**

- **Row anchor:** The first 15M candle whose `close` crosses PDH or PDL within the 24h MYT cycle window
- **Day Owner:** The MYT calendar date of that First Interaction candle
- **No cutoff at 08:00:** The full lifecycle (Durability C3–C6 + Outcome C1–C8) continues even if it crosses the daily rollover
- **Concurrent lifecycles:** If Day N's lifecycle is still running when Day N+1 starts, both run independently and produce separate rows
- **No row splitting:** One interaction = one row, regardless of how many UTC days it spans

---

## 2. Time Foundation — MYT (UTC+8, No DST)

All analysis is anchored to **Malaysia Time (MYT = UTC+8)**. MYT never observes Daylight Saving Time.

| Concept | UTC | MYT |
|---|---|---|
| Daily cycle start | 00:00:00 UTC day X | 08:00:00 MYT day X |
| Daily cycle end | 23:59:59 UTC day X | 07:59:59 MYT day X+1 |
| Asia Range window | 16:00:00–23:59:59 UTC day X−1 | 00:00:00–07:59:59 MYT day X |
| Overflow window | 00:00:00–01:59:59 UTC day X+1 | 08:00:00–09:59:59 MYT day X+1 |

---

## 3. Candle Window — `allCandles15m`

Each behavior cycle uses a single unified sorted candle array covering **34 hours**:

```
[cycleStartUtcMs − 8h,  cycleStartUtcMs + 26h)
= [16:00 UTC day X−1,  02:00 UTC day X+1]
= [00:00 MYT day X,    10:00 MYT day X+1]
```

This is split into three logical zones:

| Zone | UTC range | MYT range | Purpose |
|---|---|---|---|
| **Asia window** | `[cycleStart−8h, cycleStart)` | 00:00–07:59 MYT | Asia Range calc + First Interaction eligible |
| **Main cycle** | `[cycleStart, cycleStart+24h)` | 08:00 MYT–07:59 MYT next day | First Interaction + all lifecycle phases |
| **Overflow** | `[cycleStart+24h, cycleStart+26h)` | 08:00–09:59 MYT next day | Lifecycle completion only (C3–C6, C1–C8) |

> **Critical rule:** The **First Interaction scan** must be bounded to `[cycleStart−8h, cycleStart+24h)`.
> Overflow zone candles (`timeUtcMs >= cycleStart + 24h`) must NEVER be used to detect a new First Interaction — they belong to the next cycle.

---

## 4. DST-Aware Session Windows

MYT is fixed (UTC+8, no DST). However, UK (London) and US (New York) markets observe DST, which shifts their session start times when viewed in MYT.

### 4.1 DST Schedule Detection

```typescript
// Using Luxon:
const ukOffset = dt.setZone("Europe/London").offset;    // +60 = BST, 0 = GMT
const usOffset = dt.setZone("America/New_York").offset; // −240 = EDT, −300 = EST
// SUMMER     = ukBST && usEDT   (late Mar → late Oct)
// WINTER     = !ukBST && !usEDT (Nov → mid-Mar)
// TRANSITION = one differs       (mid-Mar → late Mar, late Oct → early Nov)
```

### 4.2 Session Windows in MYT

| Session | WINTER | SUMMER | TRANSITION |
|---|---|---|---|
| `ASIA_PRE` | 08:00–08:59 | 08:00–08:59 | 08:00–08:59 |
| `ASIA_H1` | 09:00–10:59 | 09:00–10:59 | 09:00–10:59 |
| `ASIA_TP_H1` | 11:00–12:29 | 11:00–12:29 | 11:00–12:29 |
| `ASIA_H2` | 12:30–14:59 | 12:30–14:59 | 12:30–14:59 |
| `ASIA_TP_H2` | 15:00–15:59 | *(superseded by UK_PRE)* | 15:00–15:59 |
| `UK_PRE` | 16:00–16:59 | **15:00–15:59** | 16:00–16:59 |
| `UK_H1` | 17:00–18:59 | **16:00–17:59** | 17:00–18:59 |
| `UK_TP_H1` | 19:00–20:59 | **18:00–19:59** | 19:00–20:59 |
| `UK_H2` | 21:00–21:29 | **20:00–20:29** | *(no window — US_PRE starts 20:30)* |
| `US_PRE` | 21:30–22:29 | **20:30–21:29** | **20:30–21:29** |
| `US_H1` | 22:30–23:59 + 00:00 | **21:30–23:59** | **21:30–23:59** |
| `US_TP_H1` | 01:00–02:29 | **00:00–01:29** | **00:00–01:29** |
| `US_H2` | 02:30–03:59 | **01:30–02:59** | **01:30–02:59** |
| `US_TP_H2` | 04:00–04:59 | **03:00–03:59** | **03:00–03:59** |
| `MKT_CLOSED` | 05:00–06:29 | **04:00–05:29** | **04:00–05:29** |
| `MKT_RESET` | 06:30–07:59 | **05:30–07:59** | **05:30–07:59** |

**Priority rule (when sessions overlap):** US > UK > ASIA

> **US_H1 midnight crossing:** Only in WINTER does US_H1 cross midnight MYT (22:30–00:59). In SUMMER and TRANSITION, US_H1 opens at 21:30 MYT and ends at 23:59 MYT (no crossing needed; US_TP_H1 starts at 00:00 MYT).

### 4.3 Session Labels for First Interaction

The session label is informational only. **All sessions — including `MKT_CLOSED` and `MKT_RESET` — are valid** for a First Interaction. There is no session gate that rejects an interaction. If the first PDH/PDL close occurs at 06:55 MYT (MKT_RESET), the label is `"MKT_RESET"` and the lifecycle proceeds normally.

---

## 5. The Three-Phase Framework

### Phase 1 — INTERACT

*Did price interact with PDH or PDL, and how?*

**Touch rule (all phases):** A candle "touches" a level only if its **close price** crosses it:
- PDH: `close >= pdh`
- PDL: `close <= pdl`
- Wick-only touches (intrabar) are ignored.

**First Interaction:** The first candle in `allCandles15m` (within the scan boundary) whose close crosses PDH or PDL.

**Asia Range:** High and Low of the Asia window candles only (`timeUtcMs < cycleStartUtcMs`). Touch detection for Asia Range uses the same close rule.

**Two-Candle Behavior:**
- C1 = first interaction candle; C2 = next candle in `allCandles15m`
- Both close BEYOND level → `BREAK_HOLD`
- Both close INSIDE level → `TOUCH_REJECT`
- Mixed or one missing → `TOUCH_CONSOLIDATE`
- No interaction → `NO_INTERACTION`

**Day Owner / Date Owner:**
- Interaction MYT hour < 8 → `DAY_PREV` / `DATE_PREV`
- Interaction MYT hour >= 8 → `DAY_CURR` / `DATE_CURR`
- No interaction → `DAY_CURR` / `DATE_CURR`

### Phase 2 — DECISION

*Did the market commit to a direction?*

**Decision Begin Type:**
- `ATT_IND` → no first interaction
- `ATT_BGN_EARLY` → C1 and C2 both close cleanly on same side of level
- `ATT_BGN_DEFAULT` → C1/C2 mixed; begin = first later candle closing fully on one side

**2-Consecutive-Candle Rule (only Attempt #1 tracked):**
Scan forward from C1. Two consecutive candles both closing beyond → `ACCEPTANCE`. Both inside → `REJECTION`. No pair by end of `allCandles15m` → `INDECISIVE`.

**C3–C6 Durability (uses `allCandles15m` including overflow):**
C3–C6 = confirmIndex+1 through confirmIndex+4. If fewer than 4 candles available (rare), use what exists — no pair = success.

**Retest/Reclaim:** Close-touch only (not wick).
**Clean candle:** First candle after a mixed pair whose close is fully on one side.

### Phase 3 — OUTCOME

*How much move followed?*

**MoveScore window:** C1–C8 from `allCandles15m` after C0 (up to 8 × 15M candles; uses overflow if needed). All available candles used — no hard cutoff.

**MOVE clamped to ≥ 0.** MoveScore = MOVE ÷ ATR(14). Classify: `<0.5` → `MS_NOISE`; `0.5–<1.0` → `MS_WEAK`; `1.0–<2.0` → `MS_HEALTHY`; `≥2.0` → `MS_STRONG`. Score < 0.5 → direction forced to `STALL`.

### Lifecycle Crossed Day Boundary

After running all phases, set:
```
lifecycleCrossedDayBoundary = "YES"
  if any candle used in C3-C6 OR C1-C8 has timeUtcMs >= cycleStartUtcMs + 24h
                                         (i.e., timeUtcMs >= 00:00 UTC next day
                                                           = 08:00 MYT next day)
else = "NO"
```

---

## 6. Module Architecture

```
src/
├── behavior/
│   ├── types.ts                              # Zod schemas, enums, BehaviorRow (50 fields), DailyCycleInput
│   ├── utils.ts                              # MYT helpers, getDSTSchedule, classifySession, ATR, EMA
│   ├── analyzer/
│   │   ├── interactAnalyzer.ts               # Asia Range, PDH/PDL close-touch, 2-candle, scan boundary
│   │   ├── decisionAnalyzer.ts               # Begin type, 2-candle rule, C3-C6, resolved output + strength
│   │   ├── outcomeAnalyzer.ts                # MoveScore, clamped MOVE, begin time, peak time
│   │   ├── htfContextAnalyzer.ts             # 4H range (N=12), EMA55/200, EDGE/MID, guards
│   │   └── BehaviorAnalyzer.ts               # Orchestrator: DailyCycleInput → BehaviorRow (50 fields)
│   ├── reporter/
│   │   └── BehaviorSheetsReporter.ts         # 50-col header, bulk + incremental, ensureTab, freeze row 1
│   ├── bot/
│   │   └── BehaviorBot.ts                    # Bitunix 15M subscription, concurrent lifecycle states
│   └── scripts/
│       └── runBehaviorBacktest.ts            # Binance fetch (+2h), buildCycles, analyze, sheet write
```

---

## 7. Integration Points

### 7.1 Candle Data

| Mode | Source |
|---|---|
| **Backtest** | `fetchBinanceCandles()` — public Binance API; handles pagination |
| **Live** | `BitunixAdapter.subscribeToCandles()` |

Both 15M and 4H required. 4H: ≥250 candles for EMA200 (200 bars × 4h = 33 days, 250 bars = buffer).

### 7.2 PDH / PDL

- **Backtest:** `pdh = max(c.high)` and `pdl = min(c.low)` over the prior UTC calendar day's 15M candles
- **Live:** Refreshed at cycle rollover from completed cycle's candles

### 7.3 Google Sheets

`BehaviorSheetsReporter` follows the same pattern as `src/monitoring/GoogleSheetsReporter.ts`. **50 columns.** Bulk mode (backtest): clear → header → rows in batches of 50 with 1s delay. Incremental mode (live): `appendRow()` after each lifecycle completes. `ensureTab()` called before every write; row 1 frozen on creation.

### 7.4 Telegram Alerts

| Event | Alert |
|---|---|
| Decision confirmed | `🔔 BTC PDH REJECTION confirmed @ 11:45 ASIA_TP_H1 → REJ_SUCC_IMP → MEAN-REVERSION expected` |
| Outcome begin | `📈 BTC Outcome started @ 12:30 — MEAN-REVERSION — MS_HEALTHY (1.4) — EDGE_ALIGN` |
| Cycle finalized | `📋 BTC 02/01/2026 Summary: PDH REJECTION → MEAN-REVERSION MS_STRONG EDGE_ALIGN [Crossed: NO]` |
| No interaction | `⚪ BTC 04/01/2026: No PDH/PDL interaction` |

---

## 8. Live Bot — Concurrent Lifecycle Design

Because a lifecycle that starts in the Asia window (e.g., 06:55 MYT) can extend past the 08:00 rollover, the live bot maintains **two lifecycle slots**:

```
activeState:  CycleState   — the current day's lifecycle (always present)
pendingState: CycleState | null — previous day's lifecycle still completing (rare)
```

**At cycle rollover (first candle with timeUtcMs >= cycleStartUtcMs + 24h):**
1. If `activeState` lifecycle is NOT fully resolved (C3–C6 incomplete or C1–C8 incomplete):
   - Move `activeState` → `pendingState`
2. Else: finalize `activeState` normally (append row, send daily summary alert)
3. Initialize fresh `activeState` for the new cycle

**On each new candle:**
- Feed to `activeState` (normal processing)
- If `pendingState` exists: feed overflow candles to it; when its lifecycle completes → append its row → clear `pendingState`

**Both lifecycles receive the same incoming candles** (since overflow candles for Day N are Day N+1's early candles). No special routing needed.

---

## 9. HTF 4H Edge Logic

```
Reference candle: latest CLOSED 4H candle before decisionConfirmTime
  (closed = candle.timeUtcMs + 4h ≤ decisionConfirmTimeUtcMs)

Rolling range (last 12 × 4H candles ending at reference):
  RangeHigh = max(high), RangeLow = min(low)
  RangeWidth = RangeHigh − RangeLow
  EdgeBand = RangeWidth × 0.20

Guards:
  refIndex < 0              → "MID_NEUTRAL" + warn
  < 12 candles available    → "MID_NEUTRAL" + warn (if < 2 candles)
  RangeWidth < 1.0          → "MID_NEUTRAL" + warn (degenerate range)

Location:
  EDGE if price ≥ (RangeHigh − EdgeBand) OR price ≤ (RangeLow + EdgeBand)
  MID  otherwise

Bias (EMA55 / EMA200 on 4H at reference index):
  EMA55 > EMA200 → BULL; < → BEAR; null or equal → NEUTRAL

Support:
  UP + BULL, DOWN + BEAR → SUPPORT; all else → NOT_SUPPORT

Combined:
  EDGE + SUPPORT     → "EDGE_ALIGN"
  EDGE + NOT_SUPPORT → "EDGE_CONFLICT"
  MID  + SUPPORT     → "MID_ALIGN"
  MID  + NOT_SUPPORT → "MID_NEUTRAL"
  No decision / N/A  → "MID_NEUTRAL"
```

---

## 10. Strength Scoring

**Window:** C1–C4 (1 hour after C0). Uses `allCandles15m` — overflow if needed.

**Speed:** ATR threshold = `decisionLevelPrice ± ATR(15M,14)`. Check if any C1/C2 high/low crosses threshold → `FAST`; C3/C4 → `MODERATE`; none → `SLOW`.

**Friction (close-touch only):**
- ACCEPTANCE: count candles in C1–C4 that `close < pdh` (closed back below)
- REJECTION: count candles in C1–C4 that `close > pdl` (closed back above)

**Label:**
| Speed | Friction | ACCEPTANCE | REJECTION |
|---|---|---|---|
| FAST | 0 | ACP_SUCC_IMP | REJ_SUCC_IMP |
| FAST | 1 | ACP_SUCC_STR | REJ_SUCC_STR |
| MODERATE | ≤1 | ACP_SUCC_STR | REJ_SUCC_STR |
| any | ≥2 or SLOW | ACP_SUCC_WEAK | REJ_SUCC_WEAK |
| INDECISIVE | — | IND | IND |

---

## 11. Google Sheet — 50-Column Layout

Tab name: `S2-BO-BEHAVIOR-BTC`

| Col | Field | Phase |
|---|---|---|
| A | Entry Date | Meta |
| B | UID | Meta |
| C | TradingView Link | Meta |
| D | Pair | Meta |
| E | Day | Meta |
| F | Day Owner | INTERACT |
| G | Date (dd/mm/yyyy) | INTERACT |
| H | Date Owner | INTERACT |
| I | Asia Range | INTERACT |
| J | Previous-Day Level | INTERACT |
| K | Two-Candle First Interaction Behavior | INTERACT |
| L | First Interaction Time | INTERACT |
| M | First Interaction Market Session | INTERACT |
| N | Entry Price ($) | TRADE |
| O | Leverage (X) | TRADE |
| P | Margin Used ($) | TRADE |
| Q | Position Size (Units) | TRADE |
| R | Account Risk | TRADE |
| S | Stop Loss Price ($) | TRADE |
| T | Take Profit Price ($) | TRADE |
| U | R | TRADE |
| V | Fees ($) | TRADE |
| W | Exit Price ($) | TRADE |
| X | Exit Date & Time | TRADE |
| Y | Gross P/L | TRADE |
| Z | Net P/L | TRADE |
| AA | Decision Attempt #1 Begin Type | DECISION |
| AB | Decision Attempt #1 Begin Time | DECISION |
| AC | Decision Attempt #1 Output | DECISION |
| AD | Decision #1 Confirm Time | DECISION |
| AE | Decision Attempt #1 Failed Status | DECISION |
| AF | Resolved Decision Output | DECISION |
| AG | Resolved Decision Strength | DECISION |
| AH | Resolved Outcome Direction | OUTCOME |
| AI | Resolved Outcome Quality | OUTCOME |
| AJ | Resolved Outcome Begin Time | OUTCOME |
| AK | Outcome Peak Time | OUTCOME |
| AL | HTF 4H Edge | OUTCOME |
| AM | HTF 4H Edge Link | OUTCOME |
| **AN** | **Lifecycle Crossed Day Boundary** | **Meta** |
| AO | Notes | Meta |
| AP | Win | Stats (formula) |
| AQ | Loss | Stats (formula) |
| AR | Win$ | Stats (formula) |
| AS | Loss$ | Stats (formula) |
| AT | In Use | Stats (formula) |
| AU | Month | Stats (bot-populated, NOT formula) |
| AV | Consecutive Wins | Stats (formula) |
| AW | Consecutive Losses | Stats (formula) |
| AX | UID Link | Stats (formula) |

> **Column AN** (Lifecycle Crossed Day Boundary): `"YES"` if any candle used in C3–C6 or C1–C8 has `timeUtcMs >= cycleStartUtcMs + 24h`; `"NO"` otherwise.
> **Column AU** (Month): plain string `"January"`, `"February"`, etc. — populated by the bot via `toMonthString()`, not a sheet formula.

---

## 12. Configuration

```bash
# .env additions
BEHAVIOR_PAIR=BTCUSDT
BEHAVIOR_BACKTEST_START=2026-01-01
BEHAVIOR_SHEET_TAB=S2-BO-BEHAVIOR-BTC
BEHAVIOR_TELEGRAM_ALERTS=true
BEHAVIOR_START_UID=1        # UID to start from on live bot restart
```

---

## 13. Running the Backtest

```powershell
# Dry run (no sheet write)
npm run bot -- behavior:backtest --dry-run --verbose

# Full run (Jan 1 2026 → today)
npm run bot -- behavior:backtest --verbose

# Custom range
npm run bot -- behavior:backtest --start 2026-01-01 --end 2026-03-01
```

**What happens:**
1. Fetches 15M candles: `backtestStart − 1 day` → `backtestEnd + 2h` (extra day before for PDH/PDL, +2h after for lifecycle overflow)
2. Fetches 4H candles: `backtestStart − 45 days` → `backtestEnd` (270 bars for EMA200 warmup)
3. For each UTC calendar day: builds 34h `allCandles15m` (Asia + main + overflow), computes PDH/PDL from prior day 15M candles
4. Runs all 4 analyzers → `BehaviorRow` with 50 fields
5. Clears and rewrites `S2-BO-BEHAVIOR-BTC` tab in batches of 50

---

## 14. Going Live

```powershell
# Start
npm run bot -- behavior:live --config configs/bot-live-btc-bitunix.json --verbose

# Graceful stop (Ctrl+C or SIGTERM)
```

**Live bot lifecycle:**
- At `start()`: load last 200 × 15M + 270 × 4H candles; filter to current cycle; subscribe
- Each candle: closed-candle filter → dedup by `timeUtcMs` → run incremental INTERACT/DECISION check → send alerts if thresholds met
- At rollover: if old lifecycle incomplete → move to `pendingState`; start fresh `activeState`
- When lifecycle resolves: append row to sheet → send daily summary

---

## 15. Error Handling

| Scenario | Behavior |
|---|---|
| Empty cycle (0 candles for main window) | Skip; log warning; no row |
| Empty Asia window (0 candles) | Asia Range = `AR_NONE`; still scan main cycle for First Interaction |
| EMA200 null (insufficient 4H history) | Bias = `NEUTRAL`; htfEdge = `"MID_NEUTRAL"`; warn |
| RangeWidth < 1.0 (degenerate 4H range) | htfEdge = `"MID_NEUTRAL"`; warn |
| C3–C6 / C1–C8 incomplete (fewer candles) | Use available; no pair = success (C3–C6) / fewer candles measured (C1–C8) |
| Bitunix disconnect | Reconnect every 5s; Telegram CRITICAL once per event; keep retrying |
| Google Sheets failure | Retry 3×; rethrow on persistent failure |
| Backtest Binance rate limit | Retry 3× with backoff |
