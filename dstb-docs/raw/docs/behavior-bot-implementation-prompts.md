# S2 Behavior Bot — Implementation Prompts

> **How to use this file:**
> Each section is a self-contained prompt. Pass them to your implementation agent **one at a time, in order**.
> Each prompt includes all the context that agent needs — do not skip the "Context" sections.
> Complete and verify each task before moving to the next.

---

## Prompt 1 of 11 — Types & Zod Schemas

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript with strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- `zod` for runtime validation
- Double quotes for strings, JSDoc comments on every function and class
- No `any` types, no non-null assertions (`!`), no `as unknown as T` casts

This is the **first task** in building a behavior journaling system. You need to create the foundational types file.

### Task

Create the file `src/behavior/types.ts`.

This file defines ALL types and Zod schemas for the S2 Behavior Bot journaling system. Every enum must be defined as a `z.enum()` schema, with the TypeScript type derived via `z.infer<typeof schema>`.

Define the following schemas and types:

**INTERACT Phase Enums:**
```
AsiaRangeSchema = z.enum(["AR_NONE", "AR_SINGLE_H", "AR_SINGLE_L", "AR_BOTH_HL", "AR_BOTH_LH"])
PreviousDayLevelSchema = z.enum(["PDH", "PDL", "PD_NONE"])
TwoCandleBehaviorSchema = z.enum(["BREAK_HOLD", "TOUCH_REJECT", "TOUCH_CONSOLIDATE", "NO_INTERACTION"])
DayOwnerSchema = z.enum(["DAY_PREV", "DAY_CURR"])
DateOwnerSchema = z.enum(["DATE_PREV", "DATE_CURR"])
MarketSessionSchema = z.enum([
  "ASIA_PRE",     // 08:00–08:59 UTC+8
  "ASIA_H1",      // 09:00–10:59 UTC+8
  "ASIA_TP_H1",   // 11:00–12:29 UTC+8
  "ASIA_H2",      // 12:30–14:59 UTC+8
  "ASIA_TP_H2",   // 15:00–15:59 UTC+8
  "UK_PRE",       // 16:00–16:59 UTC+8
  "UK_H1",        // 17:00–18:59 UTC+8
  "UK_TP_H1",     // 19:00–20:59 UTC+8
  "UK_H2",        // 21:00–22:59 UTC+8
  "UK_TP_H2",     // 23:00–23:59 UTC+8
  "US_PRE",       // 21:30–22:29 UTC+8
  "US_H1",        // 22:30–00:59 UTC+8
  "US_TP_H1",     // 01:00–02:29 UTC+8
  "US_H2",        // 02:30–03:59 UTC+8
  "US_TP_H2",     // 04:00–04:59 UTC+8
  "MKT_CLOSED",   // 05:00–06:29 UTC+8
  "MKT_RESET",    // 06:30–07:59 UTC+8
  "N/A"
])
```

**DECISION Phase Enums:**
```
DecisionBeginTypeSchema = z.enum(["ATT_BGN_EARLY", "ATT_BGN_DEFAULT", "ATT_IND"])
DecisionOutputSchema = z.enum(["ACCEPTANCE", "REJECTION", "INDECISIVE"])
FailedStatusSchema = z.enum(["ACP_SUCC", "ACP_FAIL_INV", "REJ_SUCC", "REJ_FAIL_INV", "NONE"])
ResolvedStrengthSchema = z.enum([
  "ACP_SUCC_IMP", "ACP_SUCC_STR", "ACP_SUCC_WEAK",
  "REJ_SUCC_IMP", "REJ_SUCC_STR", "REJ_SUCC_WEAK",
  "IND"
])
```

**OUTCOME Phase Enums:**
```
OutcomeDirectionSchema = z.enum(["CONTINUATION", "MEAN-REVERSION", "STALL"])
MoveScoreSchema = z.enum(["MS_NOISE", "MS_WEAK", "MS_HEALTHY", "MS_STRONG"])
HtfEdgeSchema = z.enum(["EDGE_ALIGN", "EDGE_CONFLICT", "MID_ALIGN", "MID_NEUTRAL", "NEUTRAL"])
HtfLocationSchema = z.enum(["EDGE", "MID"])
HtfBiasSchema = z.enum(["BULL", "BEAR", "NEUTRAL"])
```

**Candle Type** (used by all analyzers):
```typescript
// A single OHLCV 15M or 4H candle. timeUtcMs is the candle open time in UTC milliseconds.
type Candle = {
  timeUtcMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**BehaviorRow** — the complete output of one daily cycle analysis (49 fields matching the Google Sheet column layout in docs/behavior-bot.md). All fields are `string` for sheet compatibility. Use empty string `""` for trade fields in Phase 1.

```typescript
type BehaviorRow = {
  // Meta
  entryDate: string;        // "dd/mm/yyyy" of the calendar date
  uid: string;              // sequential number as string, e.g. "1"
  tradingViewLink: string;  // URL or ""
  pair: string;             // "$BTC"
  day: string;              // "Mon", "Tue", etc.
  // INTERACT
  dayOwner: string;
  date: string;             // "dd/mm/yyyy"
  dateOwner: string;
  asiaRange: string;
  previousDayLevel: string;
  twoCandleBehavior: string;
  firstInteractionTime: string;    // "HH:MM:SS" or "N/A"
  firstInteractionSession: string;
  // Trade fields (Phase 2) — all empty string in Phase 1
  entryPrice: string;
  leverage: string;
  marginUsed: string;
  positionSize: string;
  accountRisk: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  r: string;
  fees: string;
  exitPrice: string;
  exitDateTime: string;
  grossPnl: string;
  netPnl: string;
  // DECISION
  decisionBeginType: string;
  decisionBeginTime: string;        // "HH:MM:SS" or "N/A"
  decisionOutput: string;
  decisionConfirmTime: string;      // "HH:MM:SS" or "N/A"
  failedStatus: string;
  resolvedDecisionOutput: string;
  resolvedDecisionStrength: string;
  // OUTCOME
  resolvedOutcomeDirection: string;
  resolvedOutcomeQuality: string;
  resolvedOutcomeBeginTime: string; // "HH:MM:SS" or "N/A"
  outcomePeakTime: string;          // "HH:MM:SS" or "N/A"
  htf4hEdge: string;
  htf4hEdgeLink: string;            // URL or ""
  notes: string;
  // Stats (formula-driven in sheet — written as empty string)
  win: string;
  loss: string;
  winDollar: string;
  lossDollar: string;
  inUse: string;
  month: string;
  consecutiveWins: string;
  consecutiveLosses: string;
  uidLink: string;
}
```

Also define the `DailyCycleInput` type that will be passed to the `BehaviorAnalyzer`:
```typescript
type DailyCycleInput = {
  cycleStartUtcMs: number;    // 00:00:00 UTC (= 08:00:00 UTC+8)
  cycleEndUtcMs: number;      // 23:59:59 UTC (= 07:59:59 UTC+8 next day)
  candles15m: readonly Candle[];   // All 15M candles within the cycle
  candles4h: readonly Candle[];    // Last 50+ 4H candles (for rolling range + EMA)
  pdh: number;                // Previous Day High (UTC+8 1D candle)
  pdl: number;                // Previous Day Low  (UTC+8 1D candle)
  uid: number;                // Sequential row number
}
```

Export all schemas and types. Add JSDoc comments explaining each enum value.

---

## Prompt 2 of 11 — Utility Functions

### Context

You are working in `dstb-server`, a TypeScript project with strict mode.
- `luxon` is already a dependency (`import { DateTime } from "luxon"`)
- No `any` types, no non-null assertions, double quotes for strings
- The project timezone is **UTC+8 (Asia/Singapore)**

Reference the `Candle` type from `src/behavior/types.ts` (created in Prompt 1).

### Task

Create the file `src/behavior/utils.ts`.

Implement the following pure utility functions:

**1. UTC+8 time helpers:**
```typescript
/**
 * Converts a UTC timestamp (ms) to a DateTime in UTC+8.
 */
function toUtc8(timestampMs: number): DateTime

/**
 * Returns "HH:MM:SS" string from a UTC timestamp (ms), in UTC+8.
 */
function toTimeString(timestampMs: number): string

/**
 * Returns "dd/mm/yyyy" date string from a UTC timestamp (ms), in UTC+8.
 */
function toDateString(timestampMs: number): string

/**
 * Returns the day-of-week abbreviation ("Mon", "Tue", ...) from a UTC timestamp (ms), in UTC+8.
 */
function toDayString(timestampMs: number): string

/**
 * Returns the month string ("January", "February", ...) from a UTC timestamp (ms), in UTC+8.
 */
function toMonthString(timestampMs: number): string

/**
 * Returns the UTC+8 daily cycle start (08:00:00 UTC+8 = 00:00:00 UTC) for a given date.
 * Input: any UTC ms within the cycle.
 * Output: UTC ms of 00:00:00 UTC on that same UTC calendar day.
 */
function getCycleStartUtcMs(timestampMs: number): number
```

**2. Market session classifier:**
```typescript
/**
 * Given a UTC+8 time-of-day in HH:MM:SS format, returns the matching MarketSession label.
 * Mapping (Oct-Mar schedule, UTC+8):
 *   08:00–08:59 → ASIA_PRE
 *   09:00–10:59 → ASIA_H1
 *   11:00–12:29 → ASIA_TP_H1
 *   12:30–14:59 → ASIA_H2
 *   15:00–15:59 → ASIA_TP_H2
 *   16:00–16:59 → UK_PRE
 *   17:00–18:59 → UK_H1
 *   19:00–20:59 → UK_TP_H1
 *   21:00–22:29 → UK_H2  (NOTE: US_PRE overlaps 21:30; UK_H2 takes priority for 21:00–21:29)
 *   21:30–22:29 → US_PRE
 *   22:30–23:59 → UK_TP_H2 / US_H1 (use US_H1 when hour >= 22:30)
 *   23:00–23:59 → UK_TP_H2
 *   00:00–00:59 → US_H1
 *   01:00–02:29 → US_TP_H1
 *   02:30–03:59 → US_H2
 *   04:00–04:59 → US_TP_H2
 *   05:00–06:29 → MKT_CLOSED
 *   06:30–07:59 → MKT_RESET
 * Use the FIRST matching rule; for overlapping (UK_H2 vs US_PRE) default to US_PRE at 21:30.
 */
function classifySession(timestampMs: number): MarketSession
```

**3. ATR calculation:**
```typescript
/**
 * Computes the ATR(14) using Wilder's smoothing method on an array of candles.
 * Returns null if fewer than 15 candles are provided.
 * The ATR is calculated at the candle at the given index (inclusive).
 */
function computeAtr(candles: readonly Candle[], atIndex: number, period: number): number | null
```

**4. EMA calculation:**
```typescript
/**
 * Computes EMA for a given period over the close prices of candles.
 * Uses standard EMA formula: multiplier = 2 / (period + 1).
 * Returns null if fewer candles than period are provided.
 * The EMA is computed at the candle at the given index (inclusive).
 */
function computeEma(candles: readonly Candle[], atIndex: number, period: number): number | null
```

**5. Candle boundary helpers:**
```typescript
/**
 * Given an array of 15M candles and a UTC+8 cycle start (00:00:00 UTC),
 * returns only the candles that fall within [cycleStartUtcMs, cycleStartUtcMs + 24h).
 */
function filterCycleCandles(candles: readonly Candle[], cycleStartUtcMs: number): readonly Candle[]

/**
 * Returns candles that fall within the Asia Range window:
 * 16:00:00 UTC (previous calendar day) to 23:59:59 UTC (= 00:00–07:59 UTC+8).
 */
function filterAsiaCandles(candles: readonly Candle[], cycleStartUtcMs: number): readonly Candle[]

/**
 * Finds the index of a candle whose open time matches the given UTC timestamp (ms).
 * Returns -1 if not found.
 */
function findCandleIndex(candles: readonly Candle[], openTimeUtcMs: number): number
```

Export all functions. Use JSDoc on each. No `any`, no `!`.

---

## Prompt 3 of 11 — INTERACT Analyzer

### Context

You are implementing `src/behavior/analyzer/interactAnalyzer.ts` in `dstb-server`.

You have access to:
- `src/behavior/types.ts` — all enums and types
- `src/behavior/utils.ts` — `toTimeString`, `classifySession`, `filterAsiaCandles`, `toUtc8`

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/analyzer/interactAnalyzer.ts`.

This analyzer implements **Phase 1 (INTERACT)** of the behavior journal.

**Input type:**
```typescript
type InteractInput = Readonly<{
  candles15m: readonly Candle[];   // All 15M candles for the daily cycle (08:00 UTC+8 → 07:59 UTC+8)
  cycleStartUtcMs: number;         // 00:00:00 UTC (= 08:00:00 UTC+8 cycle start)
  pdh: number;                     // Previous Day High price
  pdl: number;                     // Previous Day Low price
}>
```

**Output type:**
```typescript
type InteractResult = Readonly<{
  dayOwner: DayOwner;
  dateOwner: DateOwner;
  date: string;                      // "dd/mm/yyyy"
  day: string;                       // "Mon", "Tue", etc.
  asiaRange: AsiaRange;
  previousDayLevel: PreviousDayLevel;
  twoCandleBehavior: TwoCandleBehavior;
  firstInteractionTime: string;      // "HH:MM:SS" or "N/A"
  firstInteractionSession: MarketSession;
  firstInteractionCandleIndex: number; // Index in candles15m, -1 if no interaction
}>
```

**Logic rules to implement:**

**Asia Range:**
- Asia Range window = candles with open time in `[cycleStartUtcMs - 8h, cycleStartUtcMs)` UTC
  (i.e. 16:00 UTC yesterday to 00:00 UTC today = 00:00–07:59 UTC+8)
- AR High = highest `high` of all Asia window candles
- AR Low = lowest `low` of all Asia window candles
- Scan candles from the daily cycle (and prior) to detect which AR level was touched first:
  - A candle "touches" AR High if its `high >= arHigh` OR `close >= arHigh` OR `low >= arHigh`
  - A candle "touches" AR Low if its `low <= arLow` OR `close <= arLow` OR `high <= arLow`
- `AR_NONE` → neither touched during cycle
- `AR_SINGLE_H` → only AR High touched
- `AR_SINGLE_L` → only AR Low touched
- `AR_BOTH_HL` → AR High touched first, then AR Low
- `AR_BOTH_LH` → AR Low touched first, then AR High

**Previous Day Level:**
- Scan 15M candles chronologically from cycle start
- A candle "touches" PDH if its `high >= pdh` OR `low >= pdh` (any wick/body interaction)
- A candle "touches" PDL if its `low <= pdl` OR `high <= pdl`
- `PDH` → if PDH touched first (regardless of PDL touching later)
- `PDL` → if PDL touched first
- `PD_NONE` → neither touched before 08:00 UTC+8 on the current same day (the `07:45` candle is the last eligible)

**Two-Candle Behavior:**
- After finding `firstInteractionCandleIndex` (call it C1), evaluate C1 and C2 (next 15M candle)
- Both candles close ABOVE PDH (for PDH) or BELOW PDL (for PDL) → `BREAK_HOLD`
- Both candles close BELOW PDH (for PDH) or ABOVE PDL (for PDL) → `TOUCH_REJECT`
- One closes beyond, one doesn't; or both stay near level → `TOUCH_CONSOLIDATE`
- No PDH/PDL interaction → `NO_INTERACTION`

**First Interaction Time:**
- Open time of `C1` converted to UTC+8, formatted as `"HH:MM:SS"`
- `"N/A"` if no interaction

**Day Owner / Date Owner:**
- First interaction time in UTC+8:
  - If time < 08:00 UTC+8 → `DAY_PREV` / `DATE_PREV`
  - If time >= 08:00 UTC+8 → `DAY_CURR` / `DATE_CURR`
  - If no interaction → `DAY_CURR` / `DATE_CURR`

Export: `analyzeInteract(input: InteractInput): InteractResult`

---

## Prompt 4 of 11 — DECISION Analyzer

### Context

You are implementing `src/behavior/analyzer/decisionAnalyzer.ts` in `dstb-server`.

You have access to:
- `src/behavior/types.ts` — all enums and types
- `src/behavior/utils.ts` — `toTimeString`, `computeAtr`
- `InteractResult` from `src/behavior/analyzer/interactAnalyzer.ts`

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/analyzer/decisionAnalyzer.ts`.

This analyzer implements **Phase 2 (DECISION)** of the behavior journal.

**Input type:**
```typescript
type DecisionInput = Readonly<{
  candles15m: readonly Candle[];
  interactResult: InteractResult;
  pdh: number;
  pdl: number;
}>
```

**Output type:**
```typescript
type DecisionResult = Readonly<{
  decisionBeginType: DecisionBeginType;
  decisionBeginTime: string;         // "HH:MM:SS" or "N/A"
  decisionOutput: DecisionOutput;
  decisionConfirmTime: string;       // "HH:MM:SS" or "N/A"
  decisionConfirmCandleIndex: number; // Index of C0 (2nd confirming candle), -1 if none
  failedStatus: FailedStatus;
  resolvedDecisionOutput: DecisionOutput;
  resolvedDecisionStrength: ResolvedStrength;
  atrAtConfirm: number | null;       // ATR(15M,14) at confirm candle, used by outcome analyzer
}>
```

**Logic rules:**

**Decision Begin Type:**
- If `interactResult.firstInteractionCandleIndex === -1` → `ATT_IND`
- Let C1 = `candles15m[firstInteractionCandleIndex]`, C2 = next candle
- `ATT_BGN_EARLY` → C1 and C2 both show same directional intent AND no contradiction:
  - For PDH: both close > pdh OR both close < pdh
  - For PDL: both close < pdl OR both close > pdl
- `ATT_BGN_DEFAULT` → C1 and C2 are mixed → begin time comes from first later clean candle
- If no interaction → `ATT_IND`, begin time = `"N/A"`

**Decision Attempt #1 Output (2-consecutive-candle rule):**
- Starting from the first interaction candle, scan forward looking for 2 consecutive candles that both:
  - Close BEYOND the level (both > PDH for PDH, both < PDL for PDL) → `ACCEPTANCE`
  - Close BACK INSIDE (both < PDH for PDH, both > PDL for PDL) → `REJECTION`
- If no such pair forms within the cycle → `INDECISIVE`
- Confirm Time = close time (open + 15 min) of the 2nd candle in the pair = C0

**Failed Status (C3–C6 durability window):**
- Only evaluated if Decision Output = `ACCEPTANCE` or `REJECTION`
- C3 = `candles15m[decisionConfirmIndex + 1]` through C6 = `candles15m[decisionConfirmIndex + 4]`
- For `ACCEPTANCE`: look for 2 consecutive closes BACK INSIDE the level in C3–C6
  - Found → `ACP_FAIL_INV`; Not found → `ACP_SUCC`
- For `REJECTION`: look for 2 consecutive closes BEYOND the level in C3–C6
  - Found → `REJ_FAIL_INV`; Not found → `REJ_SUCC`
- For `INDECISIVE` or no interaction → `NONE`

**Resolved Decision Output:**
- Based on what happened within C3–C6:
  - `ACP_SUCC` → resolved = `ACCEPTANCE`
  - `ACP_FAIL_INV` → look inside C3–C6 for 2 consecutive closes back inside → `REJECTION`; else `INDECISIVE`
  - `REJ_SUCC` → resolved = `REJECTION`
  - `REJ_FAIL_INV` → look inside C3–C6 for 2 consecutive closes beyond → `ACCEPTANCE`; else `INDECISIVE`
  - `NONE` → resolved = `INDECISIVE`

**Resolved Decision Strength:**
- Computed over C1–C4 (first 4 candles after C0, i.e. 1 hour window)
- Requires `atrAtConfirm` (use `computeAtr(candles15m, decisionConfirmIndex, 14)`)
- `1 ATR Threshold` = Decision Level ± ATR (above for ACCEPTANCE/PDH, below for REJECTION/PDL)
- Speed: check if any candle High/Low in C1–C4 crosses the 1 ATR threshold
  - `FAST` = threshold crossed in C1 or C2
  - `MODERATE` = threshold crossed in C3 or C4
  - `SLOW` = not crossed within C1–C4
- Friction: count retests (ACCEPTANCE) or reclaims (REJECTION) within C1–C4
  - Retest = any wick/body touching Decision Level after breakout
  - Reclaim = any wick/body revisiting beyond Decision Level after rejection
- Classify:
  - `ACCEPTANCE`: FAST+0 → IMP; FAST+1 or MOD+≤1 → STR; else → WEAK
  - `REJECTION`: FAST+0 → IMP; FAST+1 or MOD+≤1 → STR; else → WEAK
  - `INDECISIVE` → `IND`

Export: `analyzeDecision(input: DecisionInput): DecisionResult`

---

## Prompt 5 of 11 — OUTCOME Analyzer

### Context

You are implementing `src/behavior/analyzer/outcomeAnalyzer.ts` in `dstb-server`.

You have access to:
- `src/behavior/types.ts` — all enums and types
- `src/behavior/utils.ts` — `toTimeString`, `computeAtr`
- `DecisionResult` from `src/behavior/analyzer/decisionAnalyzer.ts`

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/analyzer/outcomeAnalyzer.ts`.

This analyzer implements **Phase 3 (OUTCOME)** of the behavior journal.

**Input type:**
```typescript
type OutcomeInput = Readonly<{
  candles15m: readonly Candle[];
  decisionResult: DecisionResult;
  pdh: number;
  pdl: number;
}>
```

**Output type:**
```typescript
type OutcomeResult = Readonly<{
  resolvedOutcomeDirection: OutcomeDirection;
  resolvedOutcomeQuality: MoveScore;
  resolvedOutcomeBeginTime: string;   // "HH:MM:SS" or "N/A"
  outcomePeakTime: string;            // "HH:MM:SS" or "N/A"
  moveScore: number;                  // Raw MoveScore value (for logging)
}>
```

**Logic rules:**

**Outcome Direction:**
```
If resolvedDecisionOutput == ACCEPTANCE → CONTINUATION
If resolvedDecisionOutput == REJECTION  → MEAN-REVERSION
If resolvedDecisionOutput == INDECISIVE → STALL
(MoveScore < 0.5 also forces STALL regardless)
```

**Expected Direction (auto-derived):**
```
PDH + ACCEPTANCE → UP
PDH + REJECTION  → DOWN
PDL + ACCEPTANCE → DOWN
PDL + REJECTION  → UP
INDECISIVE       → N/A
```

**MoveScore:**
- Measurement window = C1 to C8 (8 × 15M candles = 2 hours after C0 close)
- `C0` = `candles15m[decisionResult.decisionConfirmCandleIndex]`
- `C1` = next candle after C0, `C8` = 8th candle after C0
- ATR = `decisionResult.atrAtConfirm`
- If expected direction = UP:
  - `MOVE = maxHigh(C1–C8) - decisionLevelPrice`
  - `decisionLevelPrice = pdh` (for PDH interactions) or `pdl` (for PDL)
- If expected direction = DOWN:
  - `MOVE = decisionLevelPrice - minLow(C1–C8)`
- `MoveScore = MOVE ÷ ATR`
- If ATR is null or 0 → MoveScore = 0
- Classify: < 0.5 → MS_NOISE; 0.5–<1.0 → MS_WEAK; 1.0–<2.0 → MS_HEALTHY; ≥2.0 → MS_STRONG
- If MoveScore < 0.5 → override OutcomeDirection to STALL

**Outcome Begin Time (first qualifying candle):**
- Scan C1 through C8
- For UP direction, a candle qualifies if ALL THREE:
  1. `close > previous candle close` (closes higher than previous)
  2. `close > decisionLevelPrice` (closes above decision level)
  3. `close - decisionLevelPrice >= atr * 0.25` (closes ≥ ¼ ATR beyond level)
- For DOWN direction, a candle qualifies if ALL THREE:
  1. `close < previous candle close`
  2. `close < decisionLevelPrice`
  3. `decisionLevelPrice - close >= atr * 0.25`
- First qualifying candle → its open time = Outcome Begin Time (`"HH:MM:SS"`)
- No qualifying candle → `"N/A"`

**Outcome Peak Time:**
- For UP: find the candle with the highest `high` within C1–C8 → its open time
- For DOWN: find the candle with the lowest `low` within C1–C8 → its open time
- If INDECISIVE or no candles → `"N/A"`

Export: `analyzeOutcome(input: OutcomeInput): OutcomeResult`

---

## Prompt 6 of 11 — HTF Context Analyzer

### Context

You are implementing `src/behavior/analyzer/htfContextAnalyzer.ts` in `dstb-server`.

You have access to:
- `src/behavior/types.ts` — all enums and types (HtfEdge, HtfLocation, HtfBias)
- `src/behavior/utils.ts` — `computeEma`

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/analyzer/htfContextAnalyzer.ts`.

This analyzer computes the **HTF 4H Edge context** at the time of the Resolved Decision.

**Input type:**
```typescript
type HtfContextInput = Readonly<{
  candles4h: readonly Candle[];          // Array of 4H candles, sorted ascending by timeUtcMs
  decisionConfirmTimeUtcMs: number;      // UTC ms of the Resolved Decision Confirm Time (C0 close)
  decisionLevelPrice: number;            // PDH or PDL price
  expectedDirection: "UP" | "DOWN" | "N/A";
}>
```

**Output type:**
```typescript
type HtfContextResult = Readonly<{
  htfEdge: HtfEdge;
  location: HtfLocation;
  bias: HtfBias;
  rangeHigh: number;
  rangeLow: number;
  ema55: number | null;
  ema200: number | null;
}>
```

**Logic rules:**

**Step 1 — Find the reference 4H candle:**
- Use the **latest CLOSED 4H candle** at or before `decisionConfirmTimeUtcMs`
- "Closed" means: `candle.timeUtcMs + (4 * 60 * 60 * 1000) <= decisionConfirmTimeUtcMs`
- Find its index in `candles4h` array (call it `refIndex`)

**Step 2 — Rolling 4H Range (last N=12 closed 4H candles):**
- Take the 12 candles ending at `refIndex` (indices `refIndex-11` to `refIndex`)
- `4H_RH = max(high)` across those 12 candles
- `4H_RL = min(low)` across those 12 candles
- `RangeWidth = 4H_RH - 4H_RL`
- `EdgeBand = RangeWidth * 0.20`

**Step 3 — Location:**
- `EDGE` if `decisionLevelPrice >= (4H_RH - EdgeBand)` OR `decisionLevelPrice <= (4H_RL + EdgeBand)`
- `MID` otherwise

**Step 4 — EMA Bias:**
- Compute `EMA55 = computeEma(candles4h, refIndex, 55)`
- Compute `EMA200 = computeEma(candles4h, refIndex, 200)`
- If both null → `NEUTRAL`
- If EMA55 > EMA200 → `BULL`
- If EMA55 < EMA200 → `BEAR`
- Equal → `NEUTRAL`

**Step 5 — Bias Support:**
```
SUPPORT conditions:
  UP + BULL → SUPPORT
  DOWN + BEAR → SUPPORT
All other combos (including NEUTRAL) → NOT_SUPPORT
```

**Step 6 — Combined Label:**
```
EDGE + SUPPORT     → EDGE_ALIGN
EDGE + NOT_SUPPORT → EDGE_CONFLICT
MID  + SUPPORT     → MID_ALIGN
MID  + NOT_SUPPORT → MID_NEUTRAL
```
- If fewer than 12 4H candles available → default to `MID_NEUTRAL`; log warning
- If `expectedDirection == "N/A"` → always `MID_NEUTRAL`

Export: `analyzeHtfContext(input: HtfContextInput): HtfContextResult`

---

## Prompt 7 of 11 — BehaviorAnalyzer Orchestrator

### Context

You are implementing `src/behavior/analyzer/BehaviorAnalyzer.ts` in `dstb-server`.

You have access to all four completed analyzers:
- `src/behavior/analyzer/interactAnalyzer.ts` — `analyzeInteract()`
- `src/behavior/analyzer/decisionAnalyzer.ts` — `analyzeDecision()`
- `src/behavior/analyzer/outcomeAnalyzer.ts` — `analyzeOutcome()`
- `src/behavior/analyzer/htfContextAnalyzer.ts` — `analyzeHtfContext()`
- `src/behavior/types.ts` — `DailyCycleInput`, `BehaviorRow`
- `src/behavior/utils.ts` — `toDateString`, `toDayString`, `toMonthString`, `toTimeString`

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/analyzer/BehaviorAnalyzer.ts`.

This is the **main orchestrator** that takes a `DailyCycleInput` and returns a complete `BehaviorRow`.

**Export a class `BehaviorAnalyzer`** with a single public method:

```typescript
class BehaviorAnalyzer {
  /**
   * Analyzes one full daily cycle (INTERACT → DECISION → OUTCOME → HTF)
   * and returns a complete BehaviorRow ready for Google Sheets insertion.
   */
  public analyze(input: DailyCycleInput): BehaviorRow
}
```

**Orchestration flow:**
1. Run `analyzeInteract()` → `interactResult`
2. Run `analyzeDecision()` → `decisionResult`
3. Derive `expectedDirection`:
   - PDH + ACCEPTANCE → "UP"
   - PDH + REJECTION → "DOWN"
   - PDL + ACCEPTANCE → "DOWN"
   - PDL + REJECTION → "UP"
   - else → "N/A"
4. Run `analyzeOutcome()` → `outcomeResult`
5. Run `analyzeHtfContext()` — only if `decisionResult.decisionConfirmCandleIndex !== -1`
   - Pass `decisionConfirmTimeUtcMs` = open time of confirm candle + 15 min (= close time)
   - If no decision → htfEdge = `"NEUTRAL → automatically NOT_SUPPORT"`
6. Build and return the `BehaviorRow` by mapping all result fields to strings
   - Use `"N/A"` for any missing time values
   - Trade fields all `""`
   - Stats fields all `""`
   - `notes` field: build a one-line summary string like:
     `"ASIA 1100 INTERACT PDH touch & reject → 1130 DECIDE rejection (strong) → OUTCOME reversion (healthy) completed by 1315"`

**Notes field format:**
- Summarize the key events: session + level + behavior → decision type + strength → outcome direction + quality
- Use `"N/A"` if no interaction

Export: `BehaviorAnalyzer` class.

---

## Prompt 8 of 11 — BehaviorSheetsReporter

### Context

You are implementing `src/behavior/reporter/BehaviorSheetsReporter.ts` in `dstb-server`.

**Study the existing file `src/monitoring/GoogleSheetsReporter.ts` carefully** before implementing. Your class must follow the exact same patterns for:
- `SheetsClient` type reuse
- `google.auth.GoogleAuth` initialization
- `spreadsheets.get()`, `batchUpdate()`, `values.update()`, `values.clear()`, `values.append()`
- Constructor pattern with options object
- `fromEnv()` static factory

You have access to:
- `src/behavior/types.ts` — `BehaviorRow`
- Existing `SheetsClient` type from `src/monitoring/GoogleSheetsReporter.ts`

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/reporter/BehaviorSheetsReporter.ts`.

**Config type:**
```typescript
type BehaviorSheetsConfig = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  tabName: string;    // default: "S2-BO-BEHAVIOR-BTC"
}>
```

**Class: `BehaviorSheetsReporter`**

```typescript
class BehaviorSheetsReporter {
  constructor(options: BehaviorSheetsReporterOptions)
  static fromEnv(): BehaviorSheetsReporter  // reads GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, BEHAVIOR_SHEET_TAB
  
  /**
   * Bulk mode: clears the tab, writes the header row, then appends all rows.
   * Used by the backtest script. Writes in batches of 50 to avoid rate limits.
   */
  async bulkWrite(rows: readonly BehaviorRow[]): Promise<void>
  
  /**
   * Incremental mode: appends a single new row to the bottom of the tab.
   * Used by the live bot at end of each daily cycle.
   */
  async appendRow(row: BehaviorRow): Promise<void>
  
  /**
   * Ensures the tab exists; creates it if missing.
   */
  async ensureTab(): Promise<void>
}
```

**Header Row** (49 columns, must match docs/behavior-bot.md Section 9 exactly):
```
["Entry Date", "UID", "TradingView Link", "Pair", "Day",
 "Day Owner", "Date (dd/mm/yyyy)", "Date Owner",
 "Asia Range", "Previous-Day Level", "Two-Candle Behavior",
 "First Interaction Time", "First Interaction Session",
 "Entry Price ($)", "Leverage (X)", "Margin Used ($)", "Position Size (Units)",
 "Account Risk", "Stop Loss Price ($)", "Take Profit Price ($)", "R", "Fees ($)",
 "Exit Price ($)", "Exit Date & Time", "Gross P/L", "Net P/L",
 "Decision Begin Type", "Decision Begin Time", "Decision Attempt #1 Output",
 "Decision Confirm Time", "Failed Status",
 "Resolved Decision Output", "Resolved Decision Strength",
 "Resolved Outcome Direction", "Resolved Outcome Quality",
 "Resolved Outcome Begin Time", "Outcome Peak Time",
 "HTF 4H Edge", "HTF 4H Edge Link", "Notes",
 "Win", "Loss", "Win$", "Loss$", "In Use", "Month",
 "Consecutive Wins", "Consecutive Losses", "UID Link"]
```

**Row serialization:** Convert a `BehaviorRow` to a `string[]` of 49 values in the same column order.

**Rate limit protection:** In `bulkWrite()`, add a 1000ms delay between each batch of 50 rows using `await new Promise(resolve => setTimeout(resolve, 1000))`.

**Error handling:** Wrap all API calls in try/catch. On failure, log the error and rethrow.

---

## Prompt 9 of 11 — Backtest Script

### Context

You are implementing `src/behavior/scripts/runBehaviorBacktest.ts` in `dstb-server`.

**Study these existing files:**
- `src/data/binanceDataSource.ts` — `fetchBinanceCandles(args)` — fetches OHLCV candles from Binance
- `src/data/candleCache.ts` — `candleCache` global instance — use for caching
- `src/behavior/analyzer/BehaviorAnalyzer.ts` — `BehaviorAnalyzer` class
- `src/behavior/reporter/BehaviorSheetsReporter.ts` — `BehaviorSheetsReporter` class
- `src/behavior/utils.ts` — `getCycleStartUtcMs`, `filterCycleCandles`

The `fetchBinanceCandles` signature:
```typescript
fetchBinanceCandles(args: {
  symbol: string;       // e.g. "BTC-USD" (converted to BTCUSDT internally)
  interval: YahooInterval;  // "15m" or "1h" etc.
  startTimeUtc: string;     // ISO string
  endTimeUtc: string;       // ISO string
}): Promise<CandleFetchResult>
```

`CandleFetchResult.candles` is a `Candle[]` sorted ascending.

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/scripts/runBehaviorBacktest.ts`.

This is a standalone script that:
1. Reads config from env vars (uses `dotenv/config`)
2. Fetches 15M and 4H candle data from Binance
3. Analyzes all daily cycles using `BehaviorAnalyzer`
4. Writes results to Google Sheets via `BehaviorSheetsReporter`
5. Optionally sends a Telegram completion summary (if `TELEGRAM_BOT_TOKEN` is set)

**Script flow:**

```typescript
async function main(): Promise<void> {
  // Step 1: Load env vars
  const backtestStart = process.env.BEHAVIOR_BACKTEST_START ?? "2026-01-01";
  const backtestEnd = process.env.BEHAVIOR_BACKTEST_END ?? new Date().toISOString().slice(0, 10);
  const pair = process.env.BEHAVIOR_PAIR ?? "BTC-USD";
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  // Step 2: Fetch candles
  // 15M: from backtestStart to backtestEnd
  // 4H: from 15 days BEFORE backtestStart (for EMA200 warm-up: 200 * 4h = 800h ≈ 33 days)
  //     so use backtestStart minus 40 days
  
  // Step 3: Compute PDH/PDL for each cycle
  // Build daily (UTC+8) candles from 4H data: group 4H candles by UTC+8 date,
  // take max high / min low per day to get 1D equivalent.
  
  // Step 4: Build cycle list
  // For each calendar day from backtestStart to backtestEnd:
  //   cycleStartUtcMs = 00:00:00 UTC on that day (= 08:00:00 UTC+8)
  //   pdh = max(high) of the PREVIOUS UTC+8 calendar day's 15M candles
  //   pdl = min(low) of the PREVIOUS UTC+8 calendar day's 15M candles
  //   candles15m = 15M candles within [cycleStartUtcMs, cycleStartUtcMs + 24h)
  //   candles4h = last 60 4H candles at or before cycleStartUtcMs (for EMA200 room)
  
  // Step 5: Run analyzer for each cycle
  const analyzer = new BehaviorAnalyzer();
  const rows: BehaviorRow[] = [];
  for (const cycle of cycles) {
    const row = analyzer.analyze(cycle);
    rows.push(row);
    if (verbose) console.log(`[${cycle.date}] ${row.previousDayLevel} ${row.twoCandleBehavior} → ${row.resolvedDecisionOutput} ${row.resolvedOutcomeQuality}`);
  }

  // Step 6: Write to Google Sheets (unless --dry-run)
  if (!dryRun) {
    const reporter = BehaviorSheetsReporter.fromEnv();
    await reporter.bulkWrite(rows);
  }

  // Step 7: Print summary
  console.log(`✅ Behavior backtest complete: ${rows.length} days analyzed`);
}
```

Make this runnable as:
```
npx tsx src/behavior/scripts/runBehaviorBacktest.ts
```

Add process error handling:
```typescript
main().catch((err) => {
  console.error("[behavior-backtest] Fatal error:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

---

## Prompt 10 of 11 — Live BehaviorBot

### Context

You are implementing `src/behavior/bot/BehaviorBot.ts` in `dstb-server`.

**Study these existing files carefully:**

1. `src/monitoring/TelegramAlerter.ts` — the `TelegramAlerter` class with `sendAlert({ level, message, botId })` method
2. `src/exchange/IExchangeAdapter.ts` — the `IExchangeAdapter` interface with `subscribeToCandles()` and `getLatestCandles()`
3. `src/exchange/BitunixMarketApi.ts` — `getKline()` for fetching 4H candles
4. `src/behavior/analyzer/BehaviorAnalyzer.ts` — `BehaviorAnalyzer` class
5. `src/behavior/reporter/BehaviorSheetsReporter.ts` — `BehaviorSheetsReporter` class
6. `src/behavior/utils.ts` — time utilities

The `IExchangeAdapter.subscribeToCandles` signature:
```typescript
subscribeToCandles(args: {
  onCandles: (candles: readonly ExchangeCandle[]) => void;
  onError?: (error: ExchangeError) => void;
}): Promise<() => void>  // returns unsubscribe function
```

`ExchangeCandle` has: `{ timeUtcMs, open, high, low, close, volume }` — compatible with the `Candle` type.

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

Create `src/behavior/bot/BehaviorBot.ts`.

**Class: `BehaviorBot`**

```typescript
type BehaviorBotOptions = Readonly<{
  exchangeAdapter: IExchangeAdapter;
  telegramAlerter: TelegramAlerter | null;   // null = alerts disabled
  sheetsReporter: BehaviorSheetsReporter;
  pair: string;          // "BTCUSDT"
  pdh: number;           // Loaded at startup, refreshed each cycle
  pdl: number;
  logger: Logger;        // from src/core/Logger.ts
}>

class BehaviorBot {
  constructor(options: BehaviorBotOptions)
  
  /** Starts live candle subscription and cycle management. */
  async start(): Promise<void>
  
  /** Stops the bot gracefully. */
  async stop(): Promise<void>
}
```

**Internal cycle state (reset at each 08:00:00 UTC+8 rollover):**
```typescript
type CycleState = {
  cycleStartUtcMs: number;
  candles15m: Candle[];    // accumulates during the cycle
  candles4h: Candle[];     // loaded at cycle start, static
  pdh: number;
  pdl: number;
  decisionAlertSent: boolean;   // prevent duplicate alerts
  outcomeAlertSent: boolean;
}
```

**Core lifecycle:**

1. **On `start()`:**
   - Load last 200 15M candles from `exchangeAdapter.getLatestCandles({ limit: 200 })`
   - Load last 60 4H candles via `BitunixMarketApi.getKline({ symbol, interval: "4h", limit: 60 })`  
     *(inject `BitunixMarketApi` as a dependency or accept a `getLatestCandles4h` callback)*
   - Compute current cycle start from now
   - Subscribe to 15M candle updates via `subscribeToCandles()`

2. **On each new 15M candle received:**
   - Add to `cycleState.candles15m`
   - Check if cycle has rolled over (current time >= next 08:00:00 UTC+8):
     - If yes → finalize current cycle (see step 3), start new cycle
   - Run incremental INTERACT check: has PDH/PDL been touched?
   - If interaction detected and decision not yet confirmed:
     - Run `analyzeDecision()` with latest candles
     - If `decisionConfirmCandleIndex !== -1` and `!decisionAlertSent`:
       - Send Telegram alert: `"🔔 BTC {PDH/PDL} {ACCEPTANCE/REJECTION} confirmed @ {time} {session} → {strength} → {direction} expected"`
       - Set `decisionAlertSent = true`
   - If decision confirmed and outcome begin not yet alerted:
     - Run `analyzeOutcome()` with latest candles
     - If `resolvedOutcomeBeginTime !== "N/A"` and `!outcomeAlertSent`:
       - Send Telegram alert: `"📈 BTC Outcome started @ {time} — {direction} — {quality} ({moveScore:.2f})"`
       - Set `outcomeAlertSent = true`

3. **On cycle finalization (at 07:59:59 UTC+8):**
   - Run full `BehaviorAnalyzer.analyze()` on completed cycle
   - Append row to Google Sheets via `sheetsReporter.appendRow(row)`
   - Send Telegram daily summary: `"📋 BTC {date} Summary: {level} {behavior} → {resolved} {quality} {htfEdge}"`
   - Reset `cycleState` for new cycle, fetch fresh PDH/PDL

4. **On candle subscription error:**
   - Log error, attempt reconnect after 5s delay
   - Send Telegram CRITICAL alert if reconnect fails 3× in a row

---

## Prompt 11 of 11 — CLI Integration

### Context

You are modifying existing files in `dstb-server` to add two new CLI commands.

**Study these existing files:**
1. `src/cli/index.ts` — the main CLI entrypoint (command dispatch switch)
2. `src/cli/commands/cliTypes.ts` — `CliCommand` type, `ParsedCliArgs`
3. `src/cli/commands/backtest.ts` — pattern for a CLI command handler function
4. `src/behavior/scripts/runBehaviorBacktest.ts` — the backtest script (Prompt 9)
5. `src/behavior/bot/BehaviorBot.ts` — the live bot (Prompt 10)

Coding standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all functions.

### Task

**Part A — Add `behavior:backtest` CLI command:**

Create `src/cli/commands/behaviorBacktest.ts`:
```typescript
/**
 * Runs the S2 behavior backtest: fetches historical BTC candle data,
 * analyzes all daily cycles, and writes results to Google Sheets.
 */
export async function runBehaviorBacktest(args: ParsedCliArgs): Promise<void>
```

Behavior:
- Reads `--start` flag (default: `BEHAVIOR_BACKTEST_START` env var, default `"2026-01-01"`)
- Reads `--end` flag (default: today)
- Reads `--dry-run` boolean flag (skip sheet write)
- Calls the `main()` logic from `src/behavior/scripts/runBehaviorBacktest.ts`
- Logs start/end and any errors

**Part B — Add `behavior:live` CLI command:**

Create `src/cli/commands/behaviorLive.ts`:
```typescript
/**
 * Starts the S2 behavior bot in live mode: subscribes to Bitunix 15M candles,
 * sends Telegram alerts on DECISION events, and appends daily rows to Google Sheets.
 */
export async function runBehaviorLive(args: ParsedCliArgs): Promise<void>
```

Behavior:
- Reads `--config` flag (path to bot config JSON — existing bot config format)
- Builds `BitunixAdapter` from the config
- Builds `TelegramAlerter.fromEnv()` (if `TELEGRAM_BOT_TOKEN` set)
- Builds `BehaviorSheetsReporter.fromEnv()`
- Fetches initial PDH/PDL (from today's 1D candle data)
- Instantiates and starts `BehaviorBot`
- Keeps process alive with `process.on("SIGINT", () => bot.stop().then(() => process.exit(0)))`

**Part C — Wire into `src/cli/index.ts`:**

1. Add `"behavior:backtest"` and `"behavior:live"` to the `supportedCommands` array
2. Import `runBehaviorBacktest` and `runBehaviorLive`
3. Add cases to the switch statement:
   ```typescript
   case "behavior:backtest":
     await runBehaviorBacktest(parsed);
     return;
   case "behavior:live":
     await runBehaviorLive(parsed);
     return;
   ```
4. Add both commands to `printHelp()`:
   ```
   behavior:backtest   Run S2 behavior backtest (Jan 1 2026 → today)
   behavior:live       Start S2 behavior live bot (Bitunix real-time)
   ```
5. Update `src/cli/commands/cliTypes.ts` — add `"behavior:backtest"` and `"behavior:live"` to the `CliCommand` union type

**Part D — Add npm scripts to `package.json`:**
```json
"behavior:backtest": "npx tsx src/behavior/scripts/runBehaviorBacktest.ts",
"behavior:live": "npm run bot -- behavior:live"
```

---

## Implementation Checklist

After all 11 prompts are complete, verify the following:

### Build Check
```powershell
npm run typecheck
```
Must pass with zero errors.

### Backtest Run
```powershell
# Set up .env with GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
npm run behavior:backtest -- --dry-run --verbose
# Verify output in console, no errors
npm run behavior:backtest -- --verbose
# Verify rows appear in Google Sheet tab "S2-BO-BEHAVIOR-BTC"
```

### Live Bot Test (paper mode)
```powershell
npm run bot -- behavior:live --config configs/bot.example.json --verbose
# Verify Telegram alert fires on next 15M candle
# Verify no crashes for at least one full 15M cycle
```

### Field Correctness Spot-Check
Compare a few rows in the Google Sheet against the original CSV (`Copy of 3.0_Backtest_Darren_TradingJournal - S2-BO-BEHAVIOR-BTC.csv`):
- Row for 02/01/2026: PDH, TOUCH_REJECT, ACCEPTANCE → ACP_FAIL_INV → REJ_SUCC_IMP → MEAN-REVERSION, MS_HEALTHY, EDGE_ALIGN
- Row for 04/01/2026: PDH, BREAK_HOLD, ACCEPTANCE → ACP_SUCC → ACP_SUCC_IMP → CONTINUATION, MS_STRONG
- Row for 10/01/2026 (Saturday): NO_INTERACTION, STALL, MS_NOISE
