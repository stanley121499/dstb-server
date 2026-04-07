# S2 Behavior Bot — Bug Analysis & Fix Guide (v4)

> **Supersedes:** `docs/behavior-bot-v3.md`  
> **Why this document exists:** After running the backtest and comparing bot-generated output against Darren's manually-filled journal (Jan 1–4, 2026), several critical logic bugs were identified. This document explains every bug found, its root cause, the cascading effect on downstream columns, and the exact fix required.

---

## 1. How the Bugs Were Found

Darren's manually-filled journal rows for Jan 1–4 were placed side-by-side with the bot's output in a Google Sheet, and a cell-by-cell TRUE/FALSE comparison was run. The mismatch counts per column were:

| Column | Mismatches (out of 4) | Category |
|---|---|---|
| Date (format) | 4 | Formatting |
| Asia Range (verbose label) | 4 | Formatting |
| Session (verbose label) | 4 | Formatting |
| Two-Candle Behavior | 1 | **Logic Bug** |
| Decision Confirm Time | 2 | **Logic Bug** |
| Resolved Decision Strength | 4 | **Logic Bug** |
| Outcome Begin Time | 2 | **Logic Bug** |
| Outcome Peak Time (N/A vs empty) | 2 | Formatting |
| HTF 4H Edge | 2 | **Logic Bug** |
| Month | 4 | **Logic Bug** |

---

## 2. Bug Catalogue

### Bug 1 — PDH/PDL Touch Detection Uses Wicks (CRITICAL)

**File:** `src/behavior/analyzer/interactAnalyzer.ts`, lines 97–98

**Broken code:**
```typescript
const touchesPdh = (c.high >= pdh || c.low >= pdh);
const touchesPdl = (c.low <= pdl || c.high <= pdl);
```

**Root cause:** `c.high >= pdh` fires on any candle whose wick reaches PDH, even if the body/close stayed below it. Darren records a First Interaction **only when a candle closes at or through the level**.

**Cascade effect:** Because C1 is detected too early (wick-based), the wrong candle becomes C1, the wrong candle becomes C2, and the entire Two-Candle Behavior assessment is computed from the wrong pair. This corrupts:
- `twoCandleBehavior`
- `firstInteractionTime`
- `firstInteractionSession`
- `firstInteractionCandleIndex` → everything in the Decision and Outcome phases that depends on this index

**Fix:**
```typescript
const touchesPdh = c.close >= pdh;   // close-only
const touchesPdl = c.close <= pdl;   // close-only
```

---

### Bug 2 — Two-Candle TOUCH_REJECT Logic Is Inverted (CRITICAL)

**File:** `src/behavior/analyzer/interactAnalyzer.ts`, lines 133–140

**Broken code (PDH branch):**
```typescript
if (c1.close > pdh && c2.close > pdh) twoCandleBehavior = "BREAK_HOLD";
else if (c1.close < pdh && c2.close < pdh) twoCandleBehavior = "TOUCH_REJECT";
else twoCandleBehavior = "TOUCH_CONSOLIDATE";
```

**Root cause:** After fixing Bug 1, C1 is always the first candle where `close >= pdh`. So `c1.close < pdh` is **structurally impossible** — the `TOUCH_REJECT` branch can never fire. The definition of TOUCH_REJECT is: C1 touched/closed at-or-above PDH, then C2 closed **back below** PDH.

**Correct definitions:**

For PDH:
- `BREAK_HOLD`: `c1.close > pdh && c2.close > pdh` (both firmly above)
- `TOUCH_REJECT`: `c1.close >= pdh && c2.close < pdh` (touched, then rejected back)
- `TOUCH_CONSOLIDATE`: everything else

For PDL:
- `BREAK_HOLD`: `c1.close < pdl && c2.close < pdl`
- `TOUCH_REJECT`: `c1.close <= pdl && c2.close > pdl`
- `TOUCH_CONSOLIDATE`: everything else

---

### Bug 3 — Asia Range Touch Also Uses Wicks (HIGH)

**File:** `src/behavior/analyzer/interactAnalyzer.ts`, lines 73–74

**Broken code:**
```typescript
const touchesHigh = (c.high >= arHigh || c.close >= arHigh || c.low >= arHigh);
const touchesLow  = (c.low  <= arLow  || c.close <= arLow  || c.high <= arLow);
```

**Root cause:** Same as Bug 1 — wick-based. The Asia Range touch (AR_SINGLE_H, AR_SINGLE_L, AR_BOTH_*) should also use close-only.

**Fix:**
```typescript
const touchesHigh = c.close >= arHigh;
const touchesLow  = c.close <= arLow;
```

---

### Bug 4 — Decision Confirm Time Is 15 Minutes Too Late (HIGH)

**File:** `src/behavior/analyzer/decisionAnalyzer.ts`, line 107

**Broken code:**
```typescript
decisionConfirmTime = toTimeString(c0.timeUtcMs + 15 * 60 * 1000);
```

**Root cause:** `c0` is the **second** candle in the confirming pair. `c0.timeUtcMs` is its **open time**. Adding 15 minutes converts it to the **close time** of that candle. But Darren records the **open time** of the confirm candle — i.e., the moment you can *see* the confirming pair is complete (when the first candle of the pair has just closed).

**Evidence from CSV:**

| Date | Darren Confirm | Bot Confirm | Gap |
|---|---|---|---|
| Jan 2 | `11:45:00` | `12:00:00` | +15 min |
| Jan 4 | `08:15:00` | `08:30:00` | +15 min |

**Fix:**
```typescript
decisionConfirmTime = toTimeString(c0.timeUtcMs);  // remove the + 15 * 60 * 1000
```

---

### Bug 5 — Resolved Decision Strength Only Calculated for Successful Cases (HIGH)

**File:** `src/behavior/analyzer/decisionAnalyzer.ts`, lines 152–205

**Broken code:**
```typescript
if (failedStatus === "ACP_SUCC" || failedStatus === "REJ_SUCC") {
  // calculate strength (IMP / STR / WEAK)
} else {
  resolvedDecisionStrength = "IND";   // ← all failure cases get IND
}
```

**Root cause:** When `failedStatus === "ACP_FAIL_INV"` (the acceptance attempt failed and reversed to rejection), the code skips strength calculation and returns `"IND"`. But Darren still assesses the strength of the **resolved** direction — e.g., Jan 2 was `ACP_FAIL_INV → REJECTION` with `REJ_SUCC_IMP` strength.

The strength computation is already reading from `resolvedDecisionOutput` (not `decisionOutput`), so the same `next4` window and IMP/STR/WEAK classification applies regardless of whether the original attempt succeeded or failed.

**Fix:** Remove the `if (failedStatus === "ACP_SUCC" || failedStatus === "REJ_SUCC")` guard. Always calculate strength when `pairFound === true`, using `resolvedDecisionOutput` as the direction.

---

### Bug 6 — Friction Checks Use Wicks Instead of Close (MEDIUM)

**File:** `src/behavior/analyzer/decisionAnalyzer.ts`, lines 188–189

**Broken code:**
```typescript
const isRetest  = resOut === "ACCEPTANCE" && (level === "PDH" ? c.low  <= pdh : c.high >= pdl);
const isReclaim = resOut === "REJECTION"  && (level === "PDH" ? c.high >= pdh : c.low  <= pdl);
```

**Root cause:** `c.low <= pdh` for a retest check counts any candle whose wick dips back to the level, even if price closed above it. Darren's friction rule is close-only.

**Fix:**
```typescript
const isRetest  = resOut === "ACCEPTANCE" && (level === "PDH" ? c.close <= pdh : c.close >= pdl);
const isReclaim = resOut === "REJECTION"  && (level === "PDH" ? c.close >= pdh : c.close <= pdl);
```

---

### Bug 7 — `"4h"` Interval Falls Back to `"1h"` (HIGH)

**File:** `src/data/binanceDataSource.ts`, lines 21–32 and `src/data/yahooFinance.ts` line 21

**Broken code:**
```typescript
// yahooFinance.ts
export type YahooInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d";
// ↑ "4h" is missing from this type

// binanceDataSource.ts
const map: Record<YahooInterval, string> = {
  "1m": "1m", "2m": "1m", "5m": "5m", "15m": "15m",
  "30m": "30m", "60m": "1h", "90m": "1h", "1h": "1h", "1d": "1d"
};
return map[interval] ?? "1h";
// ↑ "4h" is not in the map, so it defaults to "1h"
```

**In `runBehaviorBacktest.ts`:**
```typescript
interval: "4h" as any   // ← type hack because "4h" isn't a valid YahooInterval
```

**Root cause:** The `YahooInterval` type was originally designed for Yahoo Finance which does not support 4H candles. Binance does support 4H. The workaround `as any` bypasses the type but the value `"4h"` still doesn't match any key in the `map`, so `map["4h"]` is `undefined`, and the fallback `?? "1h"` returns `"1h"`.

**Effect:** The HTF context analyzer receives **1H candles** instead of **4H candles**. The 12-bar rolling range covers 12 hours instead of 48 hours. EMA55 and EMA200 are computed on 1H closes instead of 4H closes. Every `htf4hEdge` value in the sheet is wrong.

**Fix — three files:**
1. `yahooFinance.ts`: Add `"4h"` to the `YahooInterval` type
2. `binanceDataSource.ts`: Add `"4h": "4h"` to the `toBinanceInterval` map
3. `runBehaviorBacktest.ts`: Remove `as any` from the 4H interval fetch call

---

### Bug 8 — Default `htfEdgeStr` Is `"NEUTRAL"` Instead of `"MID_NEUTRAL"` (MEDIUM)

**File:** `src/behavior/analyzer/BehaviorAnalyzer.ts`, line 46

**Broken code:**
```typescript
let htfEdgeStr = "NEUTRAL";
```

`"NEUTRAL"` is a value in the `HtfEdgeSchema` enum (it was left in `types.ts` by accident), but it is **not a meaningful analysis output** — it is semantically different from `"MID_NEUTRAL"` (which means price is at mid-range with no EMA bias support). The default should be `"MID_NEUTRAL"` for all PD_NONE / no-decision cases.

**Fix:**
```typescript
let htfEdgeStr: HtfEdge = "MID_NEUTRAL";
```

Also remove `"NEUTRAL"` from `HtfEdgeSchema` in `types.ts` to prevent it from being written to the sheet.

---

### Bug 9 — HTF Confirm Time Passed with Wrong Offset (MEDIUM)

**File:** `src/behavior/analyzer/BehaviorAnalyzer.ts`, line 50

**Broken code:**
```typescript
const decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs + 15 * 60 * 1000;
```

**Root cause:** Same root cause as Bug 4. The HTF context analyzer receives the CLOSE time of the confirm candle as the reference timestamp for finding the correct 4H candle. Since `decisionConfirmTime` is now defined as the OPEN time of the confirm candle (after Bug 4's fix), the HTF time should also use the open time.

**Fix:**
```typescript
const decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs;  // open time of confirm candle
```

---

### Bug 10 — `month` Field Is Always Empty String (MEDIUM)

**File:** `src/behavior/analyzer/BehaviorAnalyzer.ts`, line 142

**Broken code:**
```typescript
month: "",
```

**Root cause:** The field was never populated. `toMonthString()` exists in `utils.ts` but was not called.

**Fix:**
```typescript
month: toMonthString(input.cycleStartUtcMs),
```

Also add `toMonthString` to the import from `"../utils"`.

---

### Bug 11 — Outcome Begin Time Starts Before Durability Resolves (MEDIUM)

**File:** `src/behavior/analyzer/outcomeAnalyzer.ts`, lines 130–154

**Root cause:** The `resolvedOutcomeBeginTime` scan begins at `c0Index + 1` (the candle immediately after the decision confirm). For failure cases (`ACP_FAIL_INV` or `REJ_FAIL_INV`), the outcome direction only becomes clear **after the failure pair has confirmed** — which happens inside the `next4` window (up to 4 candles after confirm). Starting the scan immediately after confirm causes the bot to record an outcome begin time that is 1–2 candles too early.

**Evidence from CSV:**

| Date | Failed Status | Darren Begin | Bot Begin | Gap |
|---|---|---|---|---|
| Jan 2 | ACP_FAIL_INV | `12:30:00` | `12:00:00` | +2 candles early |
| Jan 4 | ACP_SUCC | `N/A` | `08:30:00` | Should be N/A |

**Correct logic:**
- If `failedStatus === "ACP_SUCC"` or `"REJ_SUCC"`: outcome begin = `""` (empty, not "N/A" — Darren leaves it blank for direct continuations)
- If `failedStatus === "ACP_FAIL_INV"` or `"REJ_FAIL_INV"`: find the failure pair in `next4`, outcome begin = open time of the candle **immediately after the second failure candle** (= the moment failure is confirmed)

---

### Bug 12 — Empty Time Fields Use `"N/A"` Instead of `""` (LOW)

**Files:** `outcomeAnalyzer.ts`, `decisionAnalyzer.ts`

**Root cause:** All "not applicable" time fields are initialised as `"N/A"`. Darren's sheet leaves these cells blank (empty string `""`). The mismatch causes FALSE in the cell comparison for PD_NONE rows (Jan 1, Jan 3) and all other rows where there is no value.

**Affected fields:** `resolvedOutcomeBeginTime`, `outcomePeakTime`, `decisionBeginTime`, `decisionConfirmTime`.

**Fix:** Change all default initialisations from `"N/A"` to `""` for these time string fields.

---

## 3. Bug Impact Summary

| Bug | Critical? | Columns Affected |
|---|---|---|
| 1 — Wick PDH/PDL detection | ✅ Yes | Two-Candle Behavior, all decision/outcome fields |
| 2 — TOUCH_REJECT logic inverted | ✅ Yes | Two-Candle Behavior |
| 3 — Wick Asia Range detection | ⚠️ Medium | Asia Range label |
| 4 — Confirm time +15min | ✅ Yes | Decision Confirm Time, all outcome timing |
| 5 — Strength only for success | ✅ Yes | Resolved Decision Strength (all 4 comparison rows wrong) |
| 6 — Wick friction checks | ⚠️ Medium | Resolved Decision Strength (speed/friction score) |
| 7 — 4H → 1H interval | ✅ Yes | HTF 4H Edge (all rows wrong) |
| 8 — Default NEUTRAL htfEdge | ⚠️ Medium | HTF 4H Edge for PD_NONE rows |
| 9 — HTF confirm time offset | ⚠️ Medium | HTF 4H Edge |
| 10 — Month empty | ⚠️ Medium | Month column |
| 11 — Outcome begin too early | ⚠️ Medium | Outcome Begin Time |
| 12 — N/A vs empty string | 🟢 Low | All time fields in PD_NONE rows |

---

## 4. Files To Change

| File | Bugs Fixed |
|---|---|
| `src/behavior/analyzer/interactAnalyzer.ts` | 1, 2, 3 |
| `src/behavior/analyzer/decisionAnalyzer.ts` | 4, 5, 6 |
| `src/behavior/analyzer/BehaviorAnalyzer.ts` | 8, 9, 10 |
| `src/behavior/analyzer/outcomeAnalyzer.ts` | 11, 12 |
| `src/data/yahooFinance.ts` | 7 |
| `src/data/binanceDataSource.ts` | 7 |
| `src/behavior/scripts/runBehaviorBacktest.ts` | 7 |
| `src/behavior/types.ts` | 8 (remove "NEUTRAL" from HtfEdgeSchema) |

---

## 5. How to Verify After Fixes

1. Run `npm run behavior:backtest -- --dry-run --verbose`
2. Compare output for Jan 1–4 against Darren's CSV:

| Date | Expected Output |
|---|---|
| 01/01/2026 | `PD_NONE NO_INTERACTION → INDECISIVE MS_NOISE` |
| 02/01/2026 | `PDH TOUCH_REJECT → REJECTION MS_HEALTHY` |
| 03/01/2026 | `PD_NONE NO_INTERACTION → INDECISIVE MS_NOISE` |
| 04/01/2026 | `PDH BREAK_HOLD → ACCEPTANCE MS_STRONG` |

3. For Jan 2, confirm these specific values:
   - `twoCandleBehavior = "TOUCH_REJECT"` (was TOUCH_CONSOLIDATE)
   - `decisionConfirmTime = "11:45:00"` (was 12:00:00)
   - `resolvedDecisionStrength = "REJ_SUCC_IMP"` (was IND)
   - `resolvedOutcomeBeginTime = "12:30:00"` (was 12:00:00)

4. For Jan 4, confirm:
   - `decisionConfirmTime = "08:15:00"` (was 08:30:00)
   - `resolvedOutcomeBeginTime = ""` (was 08:30:00)
   - `htf4hEdge = "MID_NEUTRAL"` (previously wrong due to 1H data)

5. Re-run `npm run behavior:backtest` (without `--dry-run`) to write the corrected data to Google Sheets.
