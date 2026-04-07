# S2 Behavior Bot — Bug Fix Prompts (v4)

> **How to use this file:**
> Each section is a self-contained prompt. Pass them to your implementation agent **one at a time, in order**.
> Each prompt includes all the context that agent needs — do not skip the "Context" sections.
> Complete and verify each task before moving to the next.
> All fixes are described in detail in `docs/behavior-bot-v4.md`.

---

## Prompt 1 of 5 — Fix `interactAnalyzer.ts`: Close-Only Detection + Two-Candle Logic

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript with strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- Double quotes for strings, JSDoc comments on every function and class
- No `any` types, no non-null assertions (`!`), no `as unknown as T` casts

This task fixes **three bugs in `src/behavior/analyzer/interactAnalyzer.ts`** that were discovered by comparing bot output against Darren's manual journal for Jan 1–4 2026.

### Background: What This File Does

`analyzeInteract()` is Phase 1 of the behavior analysis pipeline. It:
1. Computes the **Asia Range** (AR_NONE / AR_SINGLE_H / etc.) by finding which of arHigh/arLow were touched during the Asia window (00:00–07:59 MYT)
2. Finds the **First Interaction** — the first 15M candle that touches PDH or PDL
3. Identifies the **Two-Candle Behavior** (BREAK_HOLD / TOUCH_REJECT / TOUCH_CONSOLIDATE / NO_INTERACTION) using C1 (the interaction candle) and C2 (the next candle)

### Bugs Being Fixed

**Bug 1 (Critical) — PDH/PDL touch detection fires on wicks:**
```typescript
// CURRENT (wrong):
const touchesPdh = (c.high >= pdh || c.low >= pdh);
const touchesPdl = (c.low <= pdl || c.high <= pdl);
```
Darren only marks a First Interaction when a 15M candle **closes** at or through the level. A wick touching PDH without a close is ignored.

**Bug 2 (Critical) — TOUCH_REJECT logic uses an impossible condition:**
```typescript
// CURRENT (wrong):
if (c1.close > pdh && c2.close > pdh) twoCandleBehavior = "BREAK_HOLD";
else if (c1.close < pdh && c2.close < pdh) twoCandleBehavior = "TOUCH_REJECT"; // ← impossible after Bug 1 fix
else twoCandleBehavior = "TOUCH_CONSOLIDATE";
```
After fixing Bug 1, C1 is always a candle where `close >= pdh`. So `c1.close < pdh` is structurally impossible and `TOUCH_REJECT` can never fire. The correct definition is: C1 closed at-or-above PDH, then C2 closed **back below** PDH.

**Bug 3 (High) — Asia Range touch detection also fires on wicks:**
```typescript
// CURRENT (wrong):
const touchesHigh = (c.high >= arHigh || c.close >= arHigh || c.low >= arHigh);
const touchesLow  = (c.low <= arLow  || c.close <= arLow  || c.high <= arLow);
```
Should also be close-only.

### Task

Read the current file at `src/behavior/analyzer/interactAnalyzer.ts` and apply the following three fixes.

**Fix 1: Change the PDH/PDL touch check (in the "Previous Day Level Interaction" section) to close-only:**
```typescript
// CORRECT:
const touchesPdh = c.close >= pdh;
const touchesPdl = c.close <= pdl;
```

**Fix 2: Change the Two-Candle Behavior logic for both the PDH and PDL branches.**

For the **PDH** branch:
```typescript
if (c1.close > pdh && c2.close > pdh) {
  // Both closed firmly above PDH — strong break
  twoCandleBehavior = "BREAK_HOLD";
} else if (c1.close >= pdh && c2.close < pdh) {
  // C1 touched/closed at or above PDH, C2 closed back below — rejected
  twoCandleBehavior = "TOUCH_REJECT";
} else {
  // Mixed / consolidating near the level
  twoCandleBehavior = "TOUCH_CONSOLIDATE";
}
```

For the **PDL** branch (mirror of PDH, direction inverted):
```typescript
if (c1.close < pdl && c2.close < pdl) {
  twoCandleBehavior = "BREAK_HOLD";
} else if (c1.close <= pdl && c2.close > pdl) {
  twoCandleBehavior = "TOUCH_REJECT";
} else {
  twoCandleBehavior = "TOUCH_CONSOLIDATE";
}
```

**Fix 3: Change the Asia Range touch check (in the "For AR Interaction we scan cycle candles" section) to close-only:**
```typescript
// CORRECT:
const touchesHigh = c.close >= arHigh;
const touchesLow  = c.close <= arLow;
```

### Verification

After applying all three fixes:
- The logic for `touchesPdh`, `touchesPdl`, `touchesHigh`, `touchesLow` must only reference `c.close`.
- No `c.high`, `c.low` references anywhere in the touch checks.
- The `TOUCH_REJECT` branch for PDH must use `c1.close >= pdh && c2.close < pdh`.
- The `TOUCH_REJECT` branch for PDL must use `c1.close <= pdl && c2.close > pdl`.
- Do not change any other logic in the file.

---

## Prompt 2 of 5 — Fix `decisionAnalyzer.ts`: Confirm Time, Resolved Strength, Friction

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript with strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- Double quotes for strings, JSDoc comments on every function and class
- No `any` types, no non-null assertions (`!`), no `as unknown as T` casts

This task fixes **three bugs in `src/behavior/analyzer/decisionAnalyzer.ts`** discovered by comparing bot output against Darren's manual journal.

### Background: What This File Does

`analyzeDecision()` is Phase 2 of the pipeline. It:
1. Determines the **Decision Begin Type** (`ATT_BGN_EARLY` / `ATT_BGN_DEFAULT` / `ATT_IND`)
2. Scans for the first pair of consecutive candles that both close on the same side of the level → this is the **decision confirm pair**
3. `decisionConfirmCandleIndex` = index of the **second** candle in that pair
4. Evaluates the `next4` window (4 candles after the confirm) for **durability** (did the decision fail/hold?)
5. Computes **Resolved Decision Strength** (IMP / STR / WEAK / IND) based on speed and friction in `next4`

### Bugs Being Fixed

**Bug 4 (High) — Decision Confirm Time adds 15 minutes too many:**
```typescript
// CURRENT (wrong — reports CLOSE time of confirm candle):
decisionConfirmTime = toTimeString(c0.timeUtcMs + 15 * 60 * 1000);
```
`c0` is the confirm candle. `c0.timeUtcMs` is its **open time**. Adding 15 minutes gives its close time — but Darren records the **open time** of the confirm candle (the moment the confirming pair becomes visible).

Evidence: Jan 2 — Darren records `11:45:00`, bot records `12:00:00` (15 min late). Jan 4 — Darren records `08:15:00`, bot records `08:30:00` (15 min late).

**Bug 5 (High) — Resolved strength only calculated for successful outcomes:**
```typescript
// CURRENT (wrong):
if (failedStatus === "ACP_SUCC" || failedStatus === "REJ_SUCC") {
  // ... calculate IMP / STR / WEAK
} else {
  resolvedDecisionStrength = "IND";   // ← all ACP_FAIL_INV and REJ_FAIL_INV cases get IND
}
```
Even when the initial decision fails (e.g., ACCEPTANCE fails → REJECTION), the resolved direction still has measurable strength. The same `next4` window and IMP/STR/WEAK classification logic applies. Jan 2 is `ACP_FAIL_INV → REJECTION` but has `REJ_SUCC_IMP` strength per Darren.

**Bug 6 (Medium) — Friction checks use wicks instead of close:**
```typescript
// CURRENT (wrong — wick-based):
const isRetest  = resOut === "ACCEPTANCE" && (level === "PDH" ? c.low  <= pdh : c.high >= pdl);
const isReclaim = resOut === "REJECTION"  && (level === "PDH" ? c.high >= pdh : c.low  <= pdl);
```
Darren's friction rule is close-only: a candle counts as friction only if it **closes** back through the decision level.

### Task

Read the current file at `src/behavior/analyzer/decisionAnalyzer.ts` and apply the following three fixes.

**Fix 1 (Bug 4): Remove the `+ 15 * 60 * 1000` from the confirm time line:**
```typescript
// CORRECT:
decisionConfirmTime = toTimeString(c0.timeUtcMs);
```

**Fix 2 (Bug 5): Always calculate resolved strength when `pairFound === true`.**

Remove the `if (failedStatus === "ACP_SUCC" || failedStatus === "REJ_SUCC")` condition. The strength calculation block that follows it (including speed check, friction check, and the `IMP` / `STR` / `WEAK` assignment) should run for **all** cases where `pairFound === true`. The `else { resolvedDecisionStrength = "IND"; }` branch must be removed entirely.

The logic uses `resolvedDecisionOutput` (not `decisionOutput`) for all direction comparisons, which is already correct — it naturally handles failure cases because `resolvedDecisionOutput` already stores the final resolved direction.

**Fix 3 (Bug 6): Change friction checks to close-only:**
```typescript
// CORRECT:
const isRetest  = resOut === "ACCEPTANCE" && (level === "PDH" ? c.close <= pdh : c.close >= pdl);
const isReclaim = resOut === "REJECTION"  && (level === "PDH" ? c.close >= pdh : c.close <= pdl);
```

### Verification

After applying all three fixes:
- `decisionConfirmTime = toTimeString(c0.timeUtcMs)` — no `+ 15 * 60 * 1000`.
- The strength calculation runs inside `if (pairFound)` with no inner `if (failedStatus === ...)` guard.
- `isRetest` and `isReclaim` only reference `c.close`.
- Do not change any other logic in the file (the `next4` window, ATR, speed thresholds, etc. remain unchanged).

---

## Prompt 3 of 5 — Fix 4H Interval Bug Across Three Files

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript with strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- Double quotes for strings, JSDoc comments on every function and class
- No `any` types, no non-null assertions (`!`), no `as unknown as T` casts

This task fixes **Bug 7** — the `"4h"` candle interval falls through to `"1h"` — across three files.

### Background: The Problem

`fetchBinanceCandles()` in `src/data/binanceDataSource.ts` accepts an `interval: YahooInterval` parameter.

`YahooInterval` in `src/data/yahooFinance.ts` is defined as:
```typescript
export type YahooInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d";
```

`"4h"` is not in this type. Inside `toBinanceInterval()`, the map has no entry for `"4h"`, so:
```typescript
return map[interval] ?? "1h";  // "4h" → map["4h"] is undefined → falls back to "1h"
```

The backtest script works around this with:
```typescript
interval: "4h" as any,
```

But the `as any` doesn't fix the runtime behaviour — `"4h"` still misses the map and returns `"1h"`. Result: every "4H candle" the HTF analyzer receives is actually a **1H candle**. The 12-bar rolling range covers 12 hours instead of 48 hours. EMA55 and EMA200 are computed on 1H data. Every `htf4hEdge` value written to the sheet is wrong.

### Task

Apply the following changes to three files.

**File 1: `src/data/yahooFinance.ts`**

Find the line:
```typescript
export type YahooInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d";
```

Change it to:
```typescript
export type YahooInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "4h" | "1d";
```

**File 2: `src/data/binanceDataSource.ts`**

In the `toBinanceInterval()` function, find the `map` object:
```typescript
const map: Record<YahooInterval, string> = {
  "1m": "1m",
  "2m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "60m": "1h",
  "90m": "1h",
  "1h": "1h",
  "1d": "1d"
};
```

Add `"4h": "4h"` to the map:
```typescript
const map: Record<YahooInterval, string> = {
  "1m": "1m",
  "2m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "60m": "1h",
  "90m": "1h",
  "1h": "1h",
  "4h": "4h",   // ← Binance supports 4h natively
  "1d": "1d"
};
```

**File 3: `src/behavior/scripts/runBehaviorBacktest.ts`**

Find the 4H fetch call:
```typescript
const result4h = await fetchBinanceCandles({
  symbol: pair,
  interval: "4h" as any,
  startTimeUtc: fetch4hStart,
  endTimeUtc: backtestEnd,
});
```

Remove the `as any` type cast:
```typescript
const result4h = await fetchBinanceCandles({
  symbol: pair,
  interval: "4h",
  startTimeUtc: fetch4hStart,
  endTimeUtc: backtestEnd,
});
```

Also find the 15M fetch call and remove its `as any`:
```typescript
// CURRENT:
interval: "15m" as any,
// CORRECT:
interval: "15m",
```

### Verification

After applying all three changes:
- `YahooInterval` includes `"4h"`.
- `toBinanceInterval("4h")` returns `"4h"` (confirmed by the map entry).
- No `as any` casts remain in `runBehaviorBacktest.ts` for the interval field.
- TypeScript should compile without errors on these three files.

---

## Prompt 4 of 5 — Fix `BehaviorAnalyzer.ts`: Default HTF Edge, Confirm Time, Month Field

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript with strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- Double quotes for strings, JSDoc comments on every function and class
- No `any` types, no non-null assertions (`!`), no `as unknown as T` casts

This task fixes **three bugs in `src/behavior/analyzer/BehaviorAnalyzer.ts`** and **one cleanup in `src/behavior/types.ts`**.

### Background: What This File Does

`BehaviorAnalyzer.analyze()` orchestrates all four analyzers (interact, decision, outcome, HTF context) and builds the final `BehaviorRow` for one daily cycle.

### Bugs Being Fixed

**Bug 8 — Default `htfEdgeStr` is `"NEUTRAL"` instead of `"MID_NEUTRAL"`:**
```typescript
// CURRENT (wrong):
let htfEdgeStr = "NEUTRAL";
```
`"NEUTRAL"` is semantically meaningless as an output value — it was left in the enum accidentally. The correct default for all no-decision or no-data cases is `"MID_NEUTRAL"`.

Also: `"NEUTRAL"` should be removed from `HtfEdgeSchema` in `src/behavior/types.ts`.

**Bug 9 — HTF confirm time passed with wrong offset:**
```typescript
// CURRENT (wrong):
const decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs + 15 * 60 * 1000;
```
After fixing Bug 4 in Prompt 2, the Decision Confirm Time is now the **open time** of the confirm candle (not the close time). The `decisionConfirmTimeUtcMs` passed to `analyzeHtfContext()` should also use the open time.

**Bug 10 — `month` field is always empty string:**
```typescript
// CURRENT (wrong):
month: "",
```
`toMonthString()` already exists in `utils.ts` but was never called here.

### Task

**Step 1: Edit `src/behavior/types.ts`**

Find:
```typescript
export const HtfEdgeSchema = z.enum(["EDGE_ALIGN", "EDGE_CONFLICT", "MID_ALIGN", "MID_NEUTRAL", "NEUTRAL"]);
```
Change to (remove `"NEUTRAL"`):
```typescript
export const HtfEdgeSchema = z.enum(["EDGE_ALIGN", "EDGE_CONFLICT", "MID_ALIGN", "MID_NEUTRAL"]);
```

**Step 2: Edit `src/behavior/analyzer/BehaviorAnalyzer.ts`**

2a. Fix the `htfEdgeStr` default (Bug 8):

Find:
```typescript
let htfEdgeStr = "NEUTRAL";
```
Change to:
```typescript
let htfEdgeStr: HtfEdge = "MID_NEUTRAL";
```

Make sure `HtfEdge` is imported from `"../types"`.

2b. Fix the HTF confirm time (Bug 9):

Find:
```typescript
const decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs + 15 * 60 * 1000;
```
Change to:
```typescript
const decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs;
```

2c. Fix the `month` field (Bug 10):

Find:
```typescript
month: "",
```
Change to:
```typescript
month: toMonthString(input.cycleStartUtcMs),
```

Make sure `toMonthString` is in the import from `"../utils"`. The existing import line is:
```typescript
import { toDateString, toDayString } from "../utils";
```
Add `toMonthString` to it:
```typescript
import { toDateString, toDayString, toMonthString } from "../utils";
```

### Verification

After applying all changes:
- `HtfEdgeSchema` no longer contains `"NEUTRAL"`.
- `htfEdgeStr` is typed as `HtfEdge` and defaults to `"MID_NEUTRAL"`.
- `decisionConfirmTimeUtcMs = confirmCandle.timeUtcMs` (no `+ 15 * 60 * 1000`).
- `month: toMonthString(input.cycleStartUtcMs)` is in the returned `BehaviorRow`.
- TypeScript compiles without errors.

---

## Prompt 5 of 5 — Fix `outcomeAnalyzer.ts`: Outcome Begin Time Logic + Empty String Formatting

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript with strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- Double quotes for strings, JSDoc comments on every function and class
- No `any` types, no non-null assertions (`!`), no `as unknown as T` casts

This task fixes **two bugs in `src/behavior/analyzer/outcomeAnalyzer.ts`**.

### Background: What This File Does

`analyzeOutcome()` is Phase 3 of the pipeline. It:
1. Determines the **outcome direction** (CONTINUATION / MEAN-REVERSION / STALL) based on `resolvedDecisionOutput`
2. Measures the **MoveScore** (max favorable excursion / ATR) over a window of 8 candles after the decision confirm
3. Records `resolvedOutcomeBeginTime` — when the outcome move visibly begins
4. Records `outcomePeakTime` — when the price reaches its maximum favorable extension

### Bugs Being Fixed

**Bug 11 — Outcome Begin Time starts scanning before durability resolves:**

The current code scans for the begin time starting from `c0Index + 1` (immediately after the decision confirm candle). However:

- For **`ACP_SUCC`** or **`REJ_SUCC`** cases (no failure): Darren records `""` (empty) for outcome begin time. The outcome is a direct, uninterrupted continuation — there is no distinct "start" that needs to be marked separately from the decision confirm.

- For **`ACP_FAIL_INV`** or **`REJ_FAIL_INV`** cases (initial decision failed, reversed): Darren records the outcome begin as the open time of the candle **immediately after the failure pair closes**. The failure pair is two consecutive candles (within `next4`) that close back against the initial decision. The outcome begins the moment this failure is fully confirmed.

The current code does not distinguish these cases — it always starts scanning from `c0Index + 1` and finds the first movement threshold crossing, which causes it to record an outcome begin that is 1–2 candles too early for failure cases.

**Evidence from CSV:**

| Date | Failed Status | Darren Begin | Bot Begin | Fix |
|---|---|---|---|---|
| Jan 2 | ACP_FAIL_INV | `12:30:00` | `12:00:00` | Find failure pair end, use next candle open |
| Jan 4 | ACP_SUCC | `""` (empty) | `08:30:00` | No begin for direct success |

**Bug 12 — Time fields use `"N/A"` instead of `""` (empty string):**

Darren's sheet leaves empty cells blank, not `"N/A"`. The comparison formulas in the sheet produce FALSE when comparing `""` (Darren) vs `"N/A"` (bot). All time fields that have no value should be `""`.

### Task

Read the current file at `src/behavior/analyzer/outcomeAnalyzer.ts` and apply the following changes.

**Change 1 (Bug 12): Change all default `"N/A"` initialisations for time fields to `""`.**

Find and replace throughout the file:
```typescript
// CURRENT:
let resolvedOutcomeBeginTime = "N/A";
let outcomePeakTime = "N/A";
```
Change to:
```typescript
let resolvedOutcomeBeginTime = "";
let outcomePeakTime = "";
```
Also update the early-return objects that use `"N/A"` for these fields — they should also return `""`.

**Change 2 (Bug 11): Rewrite the outcome begin time logic.**

The `OutcomeInput` type already contains `decisionResult` which has `failedStatus` and `decisionConfirmCandleIndex`. Use these to determine the correct begin time.

Replace the current `beginTimeCandle` scan logic (the `for` loop that uses `atrThreshold`) with the following logic:

```typescript
/** 
 * Outcome Begin Time:
 *  - ACP_SUCC / REJ_SUCC: no explicit begin — outcome is immediate continuation → ""
 *  - ACP_FAIL_INV / REJ_FAIL_INV: begin = open time of the candle right after the
 *    failure pair closes (i.e., the candle at failurePairSecondIndex + 1 in allCandles15m)
 */
const failedStatus = decisionResult.failedStatus;
const isFailed = failedStatus === "ACP_FAIL_INV" || failedStatus === "REJ_FAIL_INV";

if (isFailed) {
  // The failure pair is two consecutive candles in next4 (decisionConfirmCandleIndex+1 .. +4)
  // that both close against the initial decision direction.
  // We need to determine "closes against" based on the initial decisionOutput:
  //   ACP_FAIL_INV: initial was ACCEPTANCE, failure = two closes back below level
  //   REJ_FAIL_INV: initial was REJECTION, failure = two closes back above level
  const failureIsBelow = failedStatus === "ACP_FAIL_INV";  // failure = price below level
  const closesAgainst = (c: Candle): boolean =>
    failureIsBelow
      ? (decisionResult.resolvedDecisionOutput === "REJECTION" && c.close < (interactResult.previousDayLevel === "PDH" ? pdh : pdl))
      : (decisionResult.resolvedDecisionOutput === "ACCEPTANCE" && c.close > (interactResult.previousDayLevel === "PDH" ? pdh : pdl));

  // Search next4 for the failure pair
  const next4Start = c0Index + 1;
  const next4End   = Math.min(c0Index + 4, allCandles15m.length - 1);

  let failurePairEndIndex = -1;
  for (let i = next4Start; i < next4End; i++) {
    const cur = allCandles15m[i];
    const nxt = allCandles15m[i + 1];
    if (cur && nxt && closesAgainst(cur) && closesAgainst(nxt)) {
      failurePairEndIndex = i + 1;  // index of the second failure candle
      break;
    }
  }

  if (failurePairEndIndex !== -1) {
    // Outcome begins at the open of the candle RIGHT AFTER the failure pair closes
    const beginIdx = failurePairEndIndex + 1;
    const beginCandle = allCandles15m[beginIdx];
    if (beginCandle) {
      resolvedOutcomeBeginTime = toTimeString(beginCandle.timeUtcMs);
    }
  }
} else {
  // ACP_SUCC or REJ_SUCC: outcome is immediate — no distinct begin time
  resolvedOutcomeBeginTime = "";
}
```

Note: `Candle` is already imported in this file. `pdh` and `pdl` are already in scope from `OutcomeInput`. `interactResult` and `decisionResult` are already destructured from `input`. `c0Index` is the `decisionConfirmCandleIndex`.

**Change 3 (Bug 12 continued): Fix `"N/A"` in `decisionAnalyzer.ts` default time fields.**

While you have the `outcomeAnalyzer.ts` file open, also note that `decisionAnalyzer.ts` initialises:
```typescript
let decisionBeginTime = "N/A";
let decisionConfirmTime = "N/A";
```
These should also be `""`. However, only change these **in `decisionAnalyzer.ts`** (which you already edited in Prompt 2). For this Prompt 5, only change `outcomeAnalyzer.ts`.

**Change 4: Also fix `"N/A"` in `decisionAnalyzer.ts`.**

Open `src/behavior/analyzer/decisionAnalyzer.ts` and find:
```typescript
let decisionBeginTime = "N/A";
let decisionConfirmTime = "N/A";
```
Change both to:
```typescript
let decisionBeginTime = "";
let decisionConfirmTime = "";
```

### Verification

After all changes:

1. In `outcomeAnalyzer.ts`:
   - All default time fields are `""` (not `"N/A"`).
   - The `beginTimeCandle` / `atrThreshold` scan loop is replaced by the `isFailed` branch logic.
   - For `ACP_SUCC` / `REJ_SUCC`: `resolvedOutcomeBeginTime` remains `""`.
   - For failure cases: `resolvedOutcomeBeginTime` = open time of the candle after the failure pair.

2. In `decisionAnalyzer.ts`:
   - `decisionBeginTime` and `decisionConfirmTime` default to `""`.

3. Run the dry-run backtest and verify Jan 2:
   - `resolvedOutcomeBeginTime = "12:30:00"` ✓
4. Verify Jan 4:
   - `resolvedOutcomeBeginTime = ""` ✓
5. Verify Jan 1 (PD_NONE):
   - `decisionBeginTime = ""`, `decisionConfirmTime = ""`, `resolvedOutcomeBeginTime = ""`, `outcomePeakTime = ""` ✓

---

## After All 5 Prompts — Run the Full Backtest

Once all five prompts have been applied and TypeScript compiles cleanly, run:

```powershell
# Dry run first — no writes to Google Sheets
npm run behavior:backtest -- --dry-run --verbose

# Check Jan 1–4 output matches:
# [01/01/2026] PD_NONE NO_INTERACTION → INDECISIVE MS_NOISE
# [02/01/2026] PDH TOUCH_REJECT → REJECTION MS_HEALTHY
# [03/01/2026] PD_NONE NO_INTERACTION → INDECISIVE MS_NOISE
# [04/01/2026] PDH BREAK_HOLD → ACCEPTANCE MS_STRONG

# If output matches, write to Google Sheets:
npm run behavior:backtest -- --verbose
```

**Expected results for Jan 2 after all fixes:**

| Field | Before | After | Darren |
|---|---|---|---|
| `twoCandleBehavior` | TOUCH_CONSOLIDATE | TOUCH_REJECT | TOUCH_REJECT |
| `decisionConfirmTime` | `12:00:00` | `11:45:00` | `11:45:00` |
| `resolvedDecisionStrength` | IND | REJ_SUCC_IMP | REJ_SUCC_IMP |
| `resolvedOutcomeBeginTime` | `12:00:00` | `12:30:00` | `12:30:00` |
| `month` | `` | `January` | (bot-populated) |

**Expected results for Jan 4 after all fixes:**

| Field | Before | After | Darren |
|---|---|---|---|
| `decisionConfirmTime` | `08:30:00` | `08:15:00` | `08:15:00` |
| `resolvedOutcomeBeginTime` | `08:30:00` | `` | `` |
| `htf4hEdge` | EDGE_ALIGN (wrong, was 1H data) | MID_NEUTRAL | MID_NEUTRAL |
| `month` | `` | `January` | (bot-populated) |
