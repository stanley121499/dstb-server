# S2 Behavior Bot — Implementation Prompts (v2)

> **Supersedes:** `docs/behavior-bot-implementation-prompts.md`
> All edge-case fixes and design decisions from the review are incorporated here.
>
> **How to use:** Pass each prompt to your implementation agent **one at a time, in order**.
> Each prompt is self-contained with all the context needed. Do not skip Context sections.
> Verify and typecheck each file before moving to the next.

---

## Prompt 1 of 11 — Types & Zod Schemas

### Context

You are working in the `dstb-server` TypeScript project. It uses:
- TypeScript strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- `zod` for runtime validation (`import { z } from "zod"`)
- Double quotes for strings, JSDoc on every exported symbol
- No `any`, no `!`, no `as unknown as T`

This is the first task in building the S2 Behavior Bot. You are creating the foundational types file.

### Task

Create `src/behavior/types.ts`.

Define all Zod schemas as `z.enum()` or `z.object()`. Derive every TypeScript type from its schema using `z.infer<typeof Schema>`. Export both the schema and the type.

---

**INTERACT Phase:**
```
AsiaRangeSchema = z.enum([
  "AR_NONE",       // No Asia level was touched during the cycle
  "AR_SINGLE_H",   // Only Asia Range High was touched (close >= arHigh)
  "AR_SINGLE_L",   // Only Asia Range Low was touched (close <= arLow)
  "AR_BOTH_HL",    // Asia Range High touched first, then Low
  "AR_BOTH_LH"     // Asia Range Low touched first, then High
])

PreviousDayLevelSchema = z.enum([
  "PDH",     // Previous Day High — first level to get a close at/above it
  "PDL",     // Previous Day Low  — first level to get a close at/below it
  "PD_NONE"  // No PDH/PDL interaction within the valid session window
])

TwoCandleBehaviorSchema = z.enum([
  "BREAK_HOLD",         // C1 and C2 both close BEYOND the level
  "TOUCH_REJECT",       // C1 and C2 both close BACK INSIDE the level
  "TOUCH_CONSOLIDATE",  // Mixed: one beyond, one inside, or both at level
  "NO_INTERACTION"      // No PDH/PDL interaction at all
])

DayOwnerSchema   = z.enum(["DAY_PREV", "DAY_CURR"])
DateOwnerSchema  = z.enum(["DATE_PREV", "DATE_CURR"])

MarketSessionSchema = z.enum([
  "ASIA_PRE",    // 08:00–08:59 MYT (fixed, no DST)
  "ASIA_H1",     // 09:00–10:59 MYT
  "ASIA_TP_H1",  // 11:00–12:29 MYT
  "ASIA_H2",     // 12:30–14:59 MYT
  "ASIA_TP_H2",  // 15:00–15:59 MYT (winter only; superseded by UK_PRE in summer)
  "UK_PRE",      // 16:00–16:59 MYT winter / 15:00–15:59 MYT summer
  "UK_H1",       // 17:00–18:59 MYT winter / 16:00–17:59 MYT summer
  "UK_TP_H1",    // 19:00–20:59 MYT winter / 18:00–19:59 MYT summer
  "UK_H2",       // 21:00–21:29 MYT winter / 20:00–20:29 MYT summer
  "US_PRE",      // 21:30–22:29 MYT winter / 20:30–21:29 MYT summer/transition
  "US_H1",       // 22:30–00:59 MYT winter / 21:30–23:59+00:00 MYT summer
  "US_TP_H1",    // 01:00–02:29 MYT winter / 00:00–01:29 MYT summer
  "US_H2",       // 02:30–03:59 MYT winter / 01:30–02:59 MYT summer
  "US_TP_H2",    // 04:00–04:59 MYT winter / 03:00–03:59 MYT summer
  "MKT_CLOSED",  // 05:00–06:29 MYT winter / 04:00–05:29 MYT summer
  "MKT_RESET",   // 06:30–07:59 MYT winter / 05:30–07:59 MYT summer
  "N/A"          // No interaction
])
```

**DECISION Phase:**
```
DecisionBeginTypeSchema = z.enum([
  "ATT_BGN_EARLY",    // C1 and C2 both close cleanly on same side of level
  "ATT_BGN_DEFAULT",  // Mixed C1/C2; begin = first later clean-close candle
  "ATT_IND"           // No interaction at all
])

DecisionOutputSchema = z.enum(["ACCEPTANCE", "REJECTION", "INDECISIVE"])

FailedStatusSchema = z.enum([
  "ACP_SUCC",      // Acceptance survived C3-C6 durability
  "ACP_FAIL_INV",  // Acceptance invalidated in C3-C6
  "REJ_SUCC",      // Rejection survived C3-C6
  "REJ_FAIL_INV",  // Rejection invalidated in C3-C6
  "NONE"           // No decision to evaluate
])

ResolvedStrengthSchema = z.enum([
  "ACP_SUCC_IMP",   // Fast (≤C2) + 0 retests
  "ACP_SUCC_STR",   // Fast+1 retest OR moderate(C3-C4) + ≤1 retest
  "ACP_SUCC_WEAK",  // 2+ retests OR threshold not reached by C4
  "REJ_SUCC_IMP",   // Fast (≤C2) + 0 reclaims
  "REJ_SUCC_STR",   // Fast+1 reclaim OR moderate + ≤1 reclaim
  "REJ_SUCC_WEAK",  // 2+ reclaims OR threshold not reached by C4
  "IND"             // Indecisive — no strength to measure
])
```

**OUTCOME Phase:**
```
OutcomeDirectionSchema = z.enum(["CONTINUATION", "MEAN-REVERSION", "STALL"])
MoveScoreSchema        = z.enum(["MS_NOISE", "MS_WEAK", "MS_HEALTHY", "MS_STRONG"])

HtfEdgeSchema          = z.enum(["EDGE_ALIGN", "EDGE_CONFLICT", "MID_ALIGN", "MID_NEUTRAL"])
HtfLocationSchema      = z.enum(["EDGE", "MID"])
HtfBiasSchema          = z.enum(["BULL", "BEAR", "NEUTRAL"])
```

**Candle type (Zod schema + TypeScript type):**
```typescript
const CandleSchema = z.object({
  timeUtcMs: z.number().int().positive(),  // candle OPEN time in UTC milliseconds
  open:   z.number().positive(),
  high:   z.number().positive(),
  low:    z.number().positive(),
  close:  z.number().positive(),
  volume: z.number().nonnegative()
});
type Candle = z.infer<typeof CandleSchema>;
```

**DSTSchedule type:**
```typescript
const DSTScheduleSchema = z.enum(["WINTER", "SUMMER", "TRANSITION"]);
type DSTSchedule = z.infer<typeof DSTScheduleSchema>;
// WINTER     = UK on GMT, US on EST
// SUMMER     = UK on BST (+1h), US on EDT (+1h) — both sessions 1h earlier in MYT
// TRANSITION = UK on GMT, US on EDT (US sessions 1h earlier, UK unchanged)
//              Happens ~Mar 8-29 and ~Oct 25 - Nov 1 each year
```

**BehaviorRow** — 49 fields matching the Google Sheet column layout (all `string` for sheet compatibility):
```typescript
type BehaviorRow = {
  // Meta (columns A-E)
  entryDate: string;          // "dd/mm/yyyy" — the date this row was written/appended
  uid: string;                // "1", "2", etc.
  tradingViewLink: string;    // URL or ""
  pair: string;               // "$BTC"
  day: string;                // "Mon", "Tue", etc. (cycle date day-of-week)
  // INTERACT (columns F-M)
  dayOwner: string;           // "DAY_PREV" | "DAY_CURR"
  date: string;               // "dd/mm/yyyy" of cycle analysis date
  dateOwner: string;
  asiaRange: string;
  previousDayLevel: string;
  twoCandleBehavior: string;
  firstInteractionTime: string;    // "HH:MM:SS" or "N/A"
  firstInteractionSession: string;
  // TRADE (columns N-Z) — all "" in Phase 1
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
  // DECISION (columns AA-AG)
  decisionBeginType: string;
  decisionBeginTime: string;         // "HH:MM:SS" or "N/A"
  decisionOutput: string;
  decisionConfirmTime: string;       // "HH:MM:SS" or "N/A"
  failedStatus: string;
  resolvedDecisionOutput: string;
  resolvedDecisionStrength: string;
  // OUTCOME (columns AH-AN)
  resolvedOutcomeDirection: string;
  resolvedOutcomeQuality: string;
  resolvedOutcomeBeginTime: string;  // "HH:MM:SS" or "N/A"
  outcomePeakTime: string;           // "HH:MM:SS" or "N/A"
  htf4hEdge: string;
  htf4hEdgeLink: string;             // URL or ""
  notes: string;                     // auto-generated summary
  // Stats (columns AO-AW) — all "" except month
  win: string;
  loss: string;
  winDollar: string;
  lossDollar: string;
  inUse: string;
  month: string;               // ⚠️ NOT a formula — populated as "January", "February", etc.
  consecutiveWins: string;
  consecutiveLosses: string;
  uidLink: string;
}
```

**DailyCycleInput** — input to BehaviorAnalyzer per cycle:
```typescript
type DailyCycleInput = {
  cycleStartUtcMs: number;           // 00:00:00 UTC = 08:00:00 MYT
  cycleEndUtcMs: number;             // 23:59:59 UTC = 07:59:59 MYT next day
  candles15m: readonly Candle[];     // 15M candles within [cycleStartUtcMs, cycleEndUtcMs]
  asiaCandles15m: readonly Candle[]; // 15M candles in Asia window [cycleStartUtcMs-8h, cycleStartUtcMs)
                                     // i.e., 16:00:00–23:59:59 UTC prior day = 00:00–07:59 MYT
  candles4h: readonly Candle[];      // ≥250 × 4H candles ending at or after cycleStartUtcMs
                                     // (200 for EMA200 + 50 buffer = ~250 minimum)
  pdh: number;                       // Previous Day High from prior cycle's 15M candles
  pdl: number;                       // Previous Day Low  from prior cycle's 15M candles
  uid: number;                       // Sequential row number (1-based)
  writeDate: string;                 // "dd/mm/yyyy" — date this row is being written
                                     // (= cycle date for backtest; = today's date for live)
}
```

Export all schemas and types with JSDoc.

---

## Prompt 2 of 11 — Utility Functions

### Context

You are working in `dstb-server` (strict TypeScript). Libraries available:
- `luxon` (`import { DateTime } from "luxon"`) — already a project dependency
- No `any`, no `!`, double quotes, JSDoc on all exports

Reference `Candle`, `MarketSession`, `DSTSchedule` from `src/behavior/types.ts` (Prompt 1).

### Task

Create `src/behavior/utils.ts`.

---

**1. UTC+8 time helpers:**

```typescript
/** Converts a UTC timestamp (ms) to a Luxon DateTime in Asia/Singapore (MYT, UTC+8). */
export function toMyt(timestampMs: number): DateTime

/** Returns "HH:MM:SS" formatted string from a UTC timestamp (ms), in MYT. */
export function toTimeString(timestampMs: number): string

/** Returns "dd/mm/yyyy" date string from a UTC timestamp (ms), in MYT. */
export function toDateString(timestampMs: number): string

/** Returns day-of-week abbreviation ("Mon", "Tue", ...) from a UTC timestamp (ms), in MYT. */
export function toDayString(timestampMs: number): string

/** Returns full month name ("January", ...) from a UTC timestamp (ms), in MYT. */
export function toMonthString(timestampMs: number): string

/**
 * Returns the UTC ms of 00:00:00 UTC for the calendar day containing the given timestamp.
 * This equals the cycle start time (00:00 UTC = 08:00 MYT).
 * Example: 2026-01-15T14:00:00Z → 2026-01-15T00:00:00Z
 */
export function getCycleStartUtcMs(timestampMs: number): number
```

---

**2. DST schedule detection:**

```typescript
/**
 * Determines the DST schedule type for a given point in time.
 * Uses Luxon's zone-aware offset to detect UK BST and US EDT.
 *
 * WINTER:     UK on GMT (offset=0),   US on EST (offset=-300)
 * SUMMER:     UK on BST (offset=+60), US on EDT (offset=-240)
 * TRANSITION: UK on GMT (offset=0),   US on EDT (offset=-240)
 *             Also applies if UK on BST but US on EST (rare, ~1 week in Nov)
 *
 * @param dt - A Luxon DateTime (any zone; the function converts internally)
 */
export function getDSTSchedule(dt: DateTime): DSTSchedule
```

Implementation hint:
```typescript
const ukOffset = dt.setZone("Europe/London").offset;    // +60 = BST, 0 = GMT
const usOffset = dt.setZone("America/New_York").offset; // -240 = EDT, -300 = EST
const ukBST = ukOffset === 60;
const usEDT = usOffset === -240;
if (ukBST && usEDT) return "SUMMER";
if (!ukBST && !usEDT) return "WINTER";
return "TRANSITION";
```

---

**3. DST-aware session classifier:**

```typescript
/**
 * Returns the MarketSession label for a given UTC timestamp (ms).
 * Converts internally to MYT (UTC+8), determines the DST schedule,
 * then applies the correct session boundary table.
 *
 * Priority when sessions overlap: US > UK > ASIA
 * MKT_CLOSED and MKT_RESET are the last sessions in the active schedule.
 *
 * Session boundaries shift for UK (1h earlier in BST) and US (1h earlier in EDT).
 * Asia sessions (ASIA_*) are FIXED regardless of DST.
 *
 * See docs/behavior-bot-v2.md Section 3 for the full boundary table.
 */
export function classifySession(timestampMs: number): MarketSession
```

**Implementation guide:**

Define a helper type:
```typescript
type SessionWindow = { session: MarketSession; startMin: number; endMin: number };
// startMin/endMin = minutes from midnight MYT (0-1439)
// US_H1 crosses midnight so it has TWO entries: one for 22:30-23:59 and one for 00:00-00:59
```

Build the window list for each schedule. Apply priority: if multiple windows match, pick the one whose session has higher priority (US > UK > ASIA).

**WINTER session boundaries (minutes from midnight MYT):**
```
ASIA_PRE:   480-539   (08:00-08:59)
ASIA_H1:    540-659   (09:00-10:59)
ASIA_TP_H1: 660-749   (11:00-12:29)
ASIA_H2:    750-899   (12:30-14:59)
ASIA_TP_H2: 900-959   (15:00-15:59)
UK_PRE:     960-1019  (16:00-16:59)
UK_H1:      1020-1139 (17:00-18:59)
UK_TP_H1:   1140-1259 (19:00-20:59)
UK_H2:      1260-1289 (21:00-21:29)
US_PRE:     1290-1349 (21:30-22:29)
US_H1:      1350-1439 (22:30-23:59) AND 0-59 (00:00-00:59)
US_TP_H1:   60-149    (01:00-02:29)
US_H2:      150-239   (02:30-03:59)
US_TP_H2:   240-299   (04:00-04:59)
MKT_CLOSED: 300-389   (05:00-06:29)
MKT_RESET:  390-479   (06:30-07:59)
```

**SUMMER boundaries (UK_PRE through US_TP_H2 all shift −60 min; Asia and MKT fixed):**
```
ASIA_PRE:   480-539   (unchanged)
ASIA_H1:    540-659   (unchanged)
ASIA_TP_H1: 660-749   (unchanged)
ASIA_H2:    750-899   (unchanged)
UK_PRE:     900-959   (15:00-15:59) ← 1h earlier; supersedes ASIA_TP_H2 by priority
UK_H1:      960-1079  (16:00-17:59)
UK_TP_H1:   1080-1199 (18:00-19:59)
UK_H2:      1200-1229 (20:00-20:29)
US_PRE:     1230-1289 (20:30-21:29)
US_H1:      1290-1439 (21:30-23:59) AND 0-59 (00:00-00:59) ← wait, check below
US_TP_H1:   0-89      (00:00-01:29)  ← note: US_H1 ends at 23:59 now so no 00:xx overlap
US_H2:      90-179    (01:30-02:59)
US_TP_H2:   180-239   (03:00-03:59)
MKT_CLOSED: 240-329   (04:00-05:29)
MKT_RESET:  330-479   (05:30-07:59)
```
Note: In SUMMER, US_H1 is 21:30-23:59 MYT (no midnight crossing needed — NYSE hours 09:30-16:00 EDT = 21:30-04:00 MYT, but H1 = first 2.5h = 21:30-23:59). US_TP_H1 covers 00:00 onward.

**TRANSITION boundaries (only US sessions shift −60 min; UK sessions at WINTER times):**
```
UK_PRE:     960-1019  (16:00-16:59, winter times)
UK_H1:      1020-1139 (17:00-18:59, winter)
UK_TP_H1:   1140-1259 (19:00-20:59, winter)
UK_H2:      1260-1289 (21:00-21:29, winter — note: US_PRE at 1230 takes priority from 20:30)
US_PRE:     1230-1289 (20:30-21:29, summer US times)
US_H1:      1290-1439 (21:30-23:59) AND 0-59 — US times
US_TP_H1:   0-89      (00:00-01:29)
US_H2:      90-179    (01:30-02:59)
US_TP_H2:   180-239   (03:00-03:59)
MKT_CLOSED: 240-329   (04:00-05:29)
MKT_RESET:  330-479   (05:30-07:59)
ASIA_TP_H2: 900-959   (15:00-15:59, no UK_PRE overlap since UK_PRE is at 16:00)
```

After building the window list, scan for matches (a minute falls in `[startMin, endMin]`), collect all matching sessions, apply priority, return the winner. Default to `"N/A"` if no window matches (shouldn't happen for a valid 24h cycle).

---

**4. Active session gate:**

```typescript
/**
 * Returns true if the given timestamp falls within an active market session
 * (i.e., NOT in MKT_CLOSED or MKT_RESET).
 * Used by INTERACT analyzer to reject interactions outside valid hours.
 */
export function isActiveSession(timestampMs: number): boolean
```

Implementation: `classifySession(timestampMs) !== "MKT_CLOSED" && classifySession(timestampMs) !== "MKT_RESET"`

---

**5. ATR (Wilder's Smoothing):**

```typescript
/**
 * Computes ATR(period) using Wilder's smoothing method on a candle array.
 *
 * Returns null if:
 *   - atIndex < period      (not enough candles before this index)
 *   - candles array has fewer than period + 1 elements
 *
 * @param candles  - Sorted ascending by timeUtcMs
 * @param atIndex  - The index of the candle to compute ATR AT (inclusive)
 * @param period   - Smoothing period (typically 14)
 */
export function computeAtr(
  candles: readonly Candle[],
  atIndex: number,
  period: number
): number | null
```

Guard: `if (atIndex < period || atIndex >= candles.length) return null;`

---

**6. EMA:**

```typescript
/**
 * Computes EMA(period) over the close prices of candles using standard formula:
 *   multiplier = 2 / (period + 1)
 *   seed = SMA of first `period` closes
 *
 * Returns null if atIndex < period - 1 or array is too short.
 *
 * @param candles  - Sorted ascending by timeUtcMs
 * @param atIndex  - Compute EMA at this index (inclusive)
 * @param period   - EMA period
 */
export function computeEma(
  candles: readonly Candle[],
  atIndex: number,
  period: number
): number | null
```

Guard: `if (atIndex < period - 1 || atIndex >= candles.length) return null;`

---

**7. Candle helpers:**

```typescript
/**
 * Filters candles to only those within [cycleStartUtcMs, cycleStartUtcMs + 24h).
 * These are the candles belonging to the current UTC calendar day (= MYT daily cycle).
 */
export function filterCycleCandles(
  candles: readonly Candle[],
  cycleStartUtcMs: number
): readonly Candle[]

/**
 * Filters candles to the Asia Range window: [cycleStartUtcMs - 8h, cycleStartUtcMs).
 * These are the 00:00–07:59 MYT candles (16:00–23:59 UTC prior day).
 */
export function filterAsiaCandles(
  candles: readonly Candle[],
  cycleStartUtcMs: number
): readonly Candle[]

/**
 * Finds the index of a candle by its open time (exact UTC ms match).
 * Returns -1 if not found.
 */
export function findCandleIndex(
  candles: readonly Candle[],
  openTimeUtcMs: number
): number
```

Export all functions. No `any`, no `!`.

---

## Prompt 3 of 11 — INTERACT Analyzer

### Context

You are implementing `src/behavior/analyzer/interactAnalyzer.ts` in `dstb-server`.

Available imports:
- `src/behavior/types.ts` — `Candle`, `AsiaRange`, `PreviousDayLevel`, `TwoCandleBehavior`, `DayOwner`, `DateOwner`, `MarketSession`
- `src/behavior/utils.ts` — `toMyt`, `toTimeString`, `toDateString`, `toDayString`, `classifySession`, `isActiveSession`

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/analyzer/interactAnalyzer.ts`.

**Input type:**
```typescript
type InteractInput = Readonly<{
  candles15m: readonly Candle[];      // 15M candles in [cycleStartUtcMs, cycleEndUtcMs]
  asiaCandles15m: readonly Candle[];  // 15M candles in Asia window [cycleStart-8h, cycleStart)
  cycleStartUtcMs: number;
  pdh: number;
  pdl: number;
}>
```

**Output type:**
```typescript
type InteractResult = Readonly<{
  dayOwner: DayOwner;
  dateOwner: DateOwner;
  date: string;                          // "dd/mm/yyyy" of cycle
  day: string;                           // "Mon", "Tue", etc.
  asiaRange: AsiaRange;
  previousDayLevel: PreviousDayLevel;
  twoCandleBehavior: TwoCandleBehavior;
  firstInteractionTime: string;          // "HH:MM:SS" or "N/A"
  firstInteractionSession: MarketSession;
  firstInteractionCandleIndex: number;   // index in candles15m; -1 if no interaction
}>
```

**Logic:**

**Asia Range:**
1. Compute `arHigh = max(candle.high for candle in asiaCandles15m)` and `arLow = min(candle.low for candle in asiaCandles15m)`.
2. If `asiaCandles15m` is empty → `AR_NONE`.
3. Scan `candles15m` (cycle candles, NOT asia candles) in order. A candle "touches" AR High if `close >= arHigh`. A candle "touches" AR Low if `close <= arLow`.
4. Track which was touched first:
   - Neither → `AR_NONE`
   - Only H → `AR_SINGLE_H`
   - Only L → `AR_SINGLE_L`
   - H first → `AR_BOTH_HL`
   - L first → `AR_BOTH_LH`

**Previous Day Level & Valid Session Gate:**
1. Scan `candles15m` in chronological order.
2. For each candle, call `isActiveSession(candle.timeUtcMs)`. If false (MKT_CLOSED or MKT_RESET) → skip this candle for interaction detection.
3. A candle "touches" PDH if `candle.close >= pdh`.
4. A candle "touches" PDL if `candle.close <= pdl`.
5. The first qualifying candle (passes session gate AND closes at/beyond a level) → record its index as `firstInteractionCandleIndex`.
6. If PDH touched first → `previousDayLevel = "PDH"`. If PDL first → `"PDL"`. If neither → `"PD_NONE"`.

**Two-Candle Behavior:**
- `C1 = candles15m[firstInteractionCandleIndex]`
- `C2 = candles15m[firstInteractionCandleIndex + 1]` — may be `undefined` (guard with optional check)
- If `firstInteractionCandleIndex === -1` → `NO_INTERACTION`
- If C2 is undefined → treat as `TOUCH_CONSOLIDATE` (incomplete pair)
- For PDH:
  - Both `close > pdh` → `BREAK_HOLD`
  - Both `close < pdh` → `TOUCH_REJECT`
  - Otherwise → `TOUCH_CONSOLIDATE`
- For PDL:
  - Both `close < pdl` → `BREAK_HOLD`
  - Both `close > pdl` → `TOUCH_REJECT`
  - Otherwise → `TOUCH_CONSOLIDATE`

**First Interaction Time / Session:**
- `firstInteractionTime = toTimeString(C1.timeUtcMs)` or `"N/A"`
- `firstInteractionSession = classifySession(C1.timeUtcMs)` or `"N/A"`

**Day Owner / Date Owner:**
- `date = toDateString(cycleStartUtcMs)` — the cycle's UTC+8 calendar date
- If `firstInteractionTime !== "N/A"`:
  - MYT hour of C1 < 8 → `DAY_PREV` / `DATE_PREV`
  - MYT hour of C1 >= 8 → `DAY_CURR` / `DATE_CURR`
- If no interaction → `DAY_CURR` / `DATE_CURR`

Export: `analyzeInteract(input: InteractInput): InteractResult`
Export types: `InteractInput`, `InteractResult`

---

## Prompt 4 of 11 — DECISION Analyzer

### Context

You are implementing `src/behavior/analyzer/decisionAnalyzer.ts` in `dstb-server`.

Available imports:
- `src/behavior/types.ts` — all enums
- `src/behavior/utils.ts` — `toTimeString`, `computeAtr`
- `src/behavior/analyzer/interactAnalyzer.ts` — `InteractResult`

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/analyzer/decisionAnalyzer.ts`.

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
  decisionBeginTime: string;             // "HH:MM:SS" or "N/A"
  decisionOutput: DecisionOutput;
  decisionConfirmTime: string;           // close time of C0: open + 15 min, formatted "HH:MM:SS"
  decisionConfirmCandleIndex: number;    // index of C0 in candles15m; -1 if none
  failedStatus: FailedStatus;
  resolvedDecisionOutput: DecisionOutput;
  resolvedDecisionStrength: ResolvedStrength;
  atrAtConfirm: number | null;           // ATR(15M,14) at C0; passed to outcome analyzer
  decisionLevelPrice: number;            // pdh or pdl depending on previousDayLevel; 0 if PD_NONE
}>
```

**Logic:**

**Early exit — no interaction:**
If `interactResult.firstInteractionCandleIndex === -1` or `interactResult.previousDayLevel === "PD_NONE"`:
- Return: `decisionBeginType = "ATT_IND"`, `decisionOutput = "INDECISIVE"`, `failedStatus = "NONE"`, `resolvedDecisionOutput = "INDECISIVE"`, `resolvedDecisionStrength = "IND"`, all times `"N/A"`, indices `-1`, ATR `null`, level `0`.

**Decision level price:**
```typescript
const decisionLevelPrice = interactResult.previousDayLevel === "PDH" ? pdh : pdl;
```

**Decision Begin Type:**
Let `startIdx = interactResult.firstInteractionCandleIndex`.
- C1 = `candles15m[startIdx]`, C2 = `candles15m[startIdx + 1]`
- If C2 is undefined → `ATT_BGN_DEFAULT` (incomplete info, use default)
- `ATT_BGN_EARLY` if C1 and C2 BOTH close on the same side:
  - PDH: `(C1.close >= pdh && C2.close >= pdh)` OR `(C1.close < pdh && C2.close < pdh)`
  - PDL: `(C1.close <= pdl && C2.close <= pdl)` OR `(C1.close > pdl && C2.close > pdl)`
- Otherwise → `ATT_BGN_DEFAULT`

**Decision Begin Time:**
- `ATT_BGN_EARLY` → begin time = `toTimeString(C1.timeUtcMs)`
- `ATT_BGN_DEFAULT` → scan forward from `startIdx` for the first "clean" candle: a candle that closes fully on one side of the level (close > pdh OR close < pdh for PDH; close < pdl OR close > pdl for PDL). Begin time = that candle's open time. If none found → `"N/A"`.

**Decision Attempt #1 Output (2-consecutive-candle rule):**
Scan from `startIdx` through end of `candles15m`:
- Look for two CONSECUTIVE candles where both `close >= pdh` (ACCEPTANCE for PDH), or both `close < pdh` (REJECTION for PDH).
- For PDL: both `close <= pdl` = ACCEPTANCE; both `close > pdl` = REJECTION.
- First qualifying pair → record: `decisionOutput`, `decisionConfirmCandleIndex` = index of the 2nd candle (C0).
- `decisionConfirmTime = toTimeString(candles15m[confirmIndex].timeUtcMs + 15 * 60 * 1000)` (open + 15 min = close time)
- If no pair found → `INDECISIVE`, index `-1`.

**C3–C6 Durability:**
- Only if `decisionConfirmCandleIndex !== -1`
- C3 = index `confirmIndex + 1`, C6 = `confirmIndex + 4` (use `Math.min(confirmIndex + 4, candles15m.length - 1)` for the actual end)
- Slice `candles15m[confirmIndex+1 .. confirmIndex+4]` (up to 4 candles, fewer if near end)
- For ACCEPTANCE: find 2 consecutive closes back inside (close < pdh for PDH) → `ACP_FAIL_INV`; else `ACP_SUCC`
- For REJECTION: find 2 consecutive closes back beyond (close >= pdh for PDH) → `REJ_FAIL_INV`; else `REJ_SUCC`
- If fewer than 2 candles available: no pair possible → `ACP_SUCC` or `REJ_SUCC`

**Resolved Decision Output:**
- `ACP_SUCC` → `ACCEPTANCE`
- `ACP_FAIL_INV` → `REJECTION` (market flipped) if 2 consecutive closes back inside found in C3-C6; else `INDECISIVE`
- `REJ_SUCC` → `REJECTION`
- `REJ_FAIL_INV` → `ACCEPTANCE` (market flipped) if 2 consecutive closes back beyond found; else `INDECISIVE`

**Resolved Decision Strength:**
- Requires `atrAtConfirm = computeAtr(candles15m, confirmIndex, 14)`
- If ATR is null → return `"IND"`
- C1–C4 window = `candles15m[confirmIndex+1 .. confirmIndex+4]` (may be fewer candles)
- ATR threshold:
  - ACCEPTANCE/UP: `decisionLevelPrice + atr`
  - REJECTION/DOWN: `decisionLevelPrice - atr`
- Speed check (crosses threshold by high/low):
  - C1 or C2 crosses → `FAST`
  - C3 or C4 crosses → `MODERATE`
  - None → `SLOW`
- Friction (CLOSE-touch retests/reclaims only, within C1–C4):
  - ACCEPTANCE: count candles where `close < pdh` (closed back below PDH after breaking above)
  - REJECTION: count candles where `close > pdl` (closed back above PDL after dropping below)
- Classify:
  - FAST + 0 → IMP; FAST + 1 OR MODERATE + ≤1 → STR; else → WEAK
  - Map to `ACP_SUCC_IMP`, `ACP_SUCC_STR`, `ACP_SUCC_WEAK`, or `REJ_SUCC_*` accordingly
  - INDECISIVE → `IND`

Export: `analyzeDecision(input: DecisionInput): DecisionResult`
Export types: `DecisionInput`, `DecisionResult`

---

## Prompt 5 of 11 — OUTCOME Analyzer

### Context

You are implementing `src/behavior/analyzer/outcomeAnalyzer.ts` in `dstb-server`.

Available imports:
- `src/behavior/types.ts` — all enums
- `src/behavior/utils.ts` — `toTimeString`
- `src/behavior/analyzer/decisionAnalyzer.ts` — `DecisionResult`

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/analyzer/outcomeAnalyzer.ts`.

**Input type:**
```typescript
type OutcomeInput = Readonly<{
  candles15m: readonly Candle[];
  decisionResult: DecisionResult;
  // NOTE: decisionResult.decisionLevelPrice already contains the correct PDH or PDL price.
  // No need to pass pdh/pdl separately here.
}>
```

**Output type:**
```typescript
type OutcomeResult = Readonly<{
  resolvedOutcomeDirection: OutcomeDirection;
  resolvedOutcomeQuality: MoveScore;
  resolvedOutcomeBeginTime: string;   // "HH:MM:SS" or "N/A"
  outcomePeakTime: string;            // "HH:MM:SS" or "N/A"
  moveScore: number;                  // raw numeric MoveScore (≥0)
}>
```

**Logic:**

**Early exit — no decision:**
If `decisionResult.decisionConfirmCandleIndex === -1` or `decisionResult.resolvedDecisionOutput === "INDECISIVE"`:
- Return: direction `"STALL"`, quality `"MS_NOISE"`, times `"N/A"`, moveScore `0`.

**Expected direction:**
```
PDH + ACCEPTANCE → "UP"
PDH + REJECTION  → "DOWN"
PDL + ACCEPTANCE → "DOWN"
PDL + REJECTION  → "UP"
```
Derive from `decisionResult.decisionLevelPrice` (= pdh vs pdl) and `decisionResult.resolvedDecisionOutput`.
Note: since `decisionLevelPrice = 0` only when `PD_NONE`, and we've already early-exited for no decision, this is safe.

Actually: we don't have the `previousDayLevel` (PDH or PDL) in `DecisionResult`. Add a field `previousDayLevel: PreviousDayLevel` to `DecisionResult` output type (update Prompt 4 note: add this field, populated from `interactResult.previousDayLevel`).

**C1–C8 window:**
- `C0 = candles15m[decisionResult.decisionConfirmCandleIndex]`
- `window = candles15m.slice(confirmIndex + 1, confirmIndex + 9)` (up to 8 candles; fewer if near cycle end)
- This is correct — no restriction to active sessions for measurement.

**MoveScore:**
```
ATR = decisionResult.atrAtConfirm (may be null)
If ATR is null or 0 → MoveScore = 0

UP:   MOVE = max(c.high for c in window) - decisionLevelPrice; clamp to ≥ 0
DOWN: MOVE = decisionLevelPrice - min(c.low for c in window);  clamp to ≥ 0

MoveScore = MOVE / ATR
```

Classify:
- `< 0.5` → `MS_NOISE` → force direction to `STALL`
- `0.5–<1.0` → `MS_WEAK`
- `1.0–<2.0` → `MS_HEALTHY`
- `≥2.0` → `MS_STRONG`

**Outcome Direction:**
- Resolved output `ACCEPTANCE` → `CONTINUATION`
- Resolved output `REJECTION` → `MEAN-REVERSION`
- Override to `STALL` if `MoveScore < 0.5`

**Outcome Begin Time (first qualifying expansion candle):**
Scan `window` (C1 through available candles):
- Track `previousClose`. For C1, `previousClose = C0.close`.
- UP: candle qualifies if `c.close > previousClose AND c.close > decisionLevelPrice AND (c.close - decisionLevelPrice) >= atr * 0.25`
- DOWN: qualifies if `c.close < previousClose AND c.close < decisionLevelPrice AND (decisionLevelPrice - c.close) >= atr * 0.25`
- If ATR is null → skip qualification (no begin time)
- First qualifying candle → `toTimeString(c.timeUtcMs)`
- None → `"N/A"`

**Outcome Peak Time:**
- UP: candle with `max(high)` in window → `toTimeString(c.timeUtcMs)` of that candle
- DOWN: candle with `min(low)` in window
- If window empty → `"N/A"`

Export: `analyzeOutcome(input: OutcomeInput): OutcomeResult`
Export types: `OutcomeInput`, `OutcomeResult`

---

## Prompt 6 of 11 — HTF Context Analyzer

### Context

You are implementing `src/behavior/analyzer/htfContextAnalyzer.ts` in `dstb-server`.

Available imports:
- `src/behavior/types.ts` — `Candle`, `HtfEdge`, `HtfLocation`, `HtfBias`
- `src/behavior/utils.ts` — `computeEma`

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/analyzer/htfContextAnalyzer.ts`.

**Input type:**
```typescript
type HtfContextInput = Readonly<{
  candles4h: readonly Candle[];           // ≥250 4H candles, sorted ascending by timeUtcMs
  decisionConfirmTimeUtcMs: number;       // UTC ms of C0 close time (open + 4h × 60 × 60 × 1000... wait)
                                          // Actually this is the 15M C0 close: open + 15min
  decisionLevelPrice: number;             // PDH or PDL price
  expectedDirection: "UP" | "DOWN" | "N/A";
  logger: { warn: (msg: string) => void }; // for logging warnings
}>
```

**Output type:**
```typescript
type HtfContextResult = Readonly<{
  htfEdge: HtfEdge;
  location: HtfLocation | null;    // null if insufficient data
  bias: HtfBias | null;
  rangeHigh: number;
  rangeLow: number;
  ema55: number | null;
  ema200: number | null;
}>
```

**Logic:**

**Step 1 — Find reference 4H candle:**
A 4H candle is "closed" if `candle.timeUtcMs + (4 * 3600 * 1000) <= decisionConfirmTimeUtcMs`.
Find `refIndex` = index of the LATEST closed 4H candle at or before the decision confirm time.
```typescript
let refIndex = -1;
for (let i = candles4h.length - 1; i >= 0; i--) {
  const c = candles4h[i];
  if (c !== undefined && c.timeUtcMs + 4 * 3600 * 1000 <= decisionConfirmTimeUtcMs) {
    refIndex = i;
    break;
  }
}
```
If `refIndex === -1`:
- `logger.warn("HTF: No closed 4H candle found before decision confirm time")`
- Return `{ htfEdge: "MID_NEUTRAL", location: null, bias: null, rangeHigh: 0, rangeLow: 0, ema55: null, ema200: null }`

**Step 2 — Rolling range (last 12 closed 4H candles):**
```typescript
const startIdx = Math.max(0, refIndex - 11);
const rangeCandles = candles4h.slice(startIdx, refIndex + 1);
if (rangeCandles.length < 12) {
  logger.warn(`HTF: Only ${rangeCandles.length} of 12 required 4H candles available`);
  // Continue with available candles, or return MID_NEUTRAL if < 2
  if (rangeCandles.length < 2) return { htfEdge: "MID_NEUTRAL", ... };
}
const rangeHigh = Math.max(...rangeCandles.map(c => c.high));
const rangeLow  = Math.min(...rangeCandles.map(c => c.low));
const rangeWidth = rangeHigh - rangeLow;
```

**Step 3 — RangeWidth = 0 guard:**
```typescript
if (rangeWidth < 1.0) {
  logger.warn("HTF: RangeWidth < 1.0 (degenerate range). Defaulting to MID_NEUTRAL.");
  return { htfEdge: "MID_NEUTRAL", location: "MID", bias: null, rangeHigh, rangeLow, ema55: null, ema200: null };
}
```

**Step 4 — Location:**
```typescript
const edgeBand = rangeWidth * 0.20;
const location: HtfLocation =
  (decisionLevelPrice >= rangeHigh - edgeBand || decisionLevelPrice <= rangeLow + edgeBand)
    ? "EDGE"
    : "MID";
```

**Step 5 — EMA Bias:**
```typescript
const ema55  = computeEma(candles4h, refIndex, 55);
const ema200 = computeEma(candles4h, refIndex, 200);
const bias: HtfBias =
  ema55 === null || ema200 === null ? "NEUTRAL" :
  ema55 > ema200                   ? "BULL" :
  ema55 < ema200                   ? "BEAR" : "NEUTRAL";
```
If EMA200 returns null, log: `logger.warn("HTF: EMA200 null — insufficient 4H history. Bias = NEUTRAL")`.

**Step 6 — Combined label:**
```typescript
if (expectedDirection === "N/A") return { htfEdge: "MID_NEUTRAL", location, bias, rangeHigh, rangeLow, ema55, ema200 };

const isSupport =
  (expectedDirection === "UP"   && bias === "BULL") ||
  (expectedDirection === "DOWN" && bias === "BEAR");

const htfEdge: HtfEdge =
  location === "EDGE" && isSupport  ? "EDGE_ALIGN" :
  location === "EDGE" && !isSupport ? "EDGE_CONFLICT" :
  location === "MID"  && isSupport  ? "MID_ALIGN" :
  "MID_NEUTRAL";
```

Export: `analyzeHtfContext(input: HtfContextInput): HtfContextResult`
Export types: `HtfContextInput`, `HtfContextResult`

---

## Prompt 7 of 11 — BehaviorAnalyzer Orchestrator

### Context

You are implementing `src/behavior/analyzer/BehaviorAnalyzer.ts` in `dstb-server`.

Available imports:
- `src/behavior/analyzer/interactAnalyzer.ts` — `analyzeInteract()`
- `src/behavior/analyzer/decisionAnalyzer.ts` — `analyzeDecision()`
- `src/behavior/analyzer/outcomeAnalyzer.ts` — `analyzeOutcome()`
- `src/behavior/analyzer/htfContextAnalyzer.ts` — `analyzeHtfContext()`
- `src/behavior/types.ts` — `DailyCycleInput`, `BehaviorRow`
- `src/behavior/utils.ts` — `toDateString`, `toDayString`, `toMonthString`, `toTimeString`

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/analyzer/BehaviorAnalyzer.ts`.

**Export a class `BehaviorAnalyzer`** with:
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

1. Run `analyzeInteract({ candles15m: input.candles15m, asiaCandles15m: input.asiaCandles15m, cycleStartUtcMs: input.cycleStartUtcMs, pdh: input.pdh, pdl: input.pdl })`

2. Run `analyzeDecision({ candles15m: input.candles15m, interactResult, pdh: input.pdh, pdl: input.pdl })`

3. Derive `expectedDirection`:
   - `PDH + ACCEPTANCE` → `"UP"`, `PDH + REJECTION` → `"DOWN"`
   - `PDL + ACCEPTANCE` → `"DOWN"`, `PDL + REJECTION` → `"UP"`
   - else → `"N/A"`

4. Run `analyzeOutcome({ candles15m: input.candles15m, decisionResult })`

5. Run `analyzeHtfContext(...)` **only if** `decisionResult.decisionConfirmCandleIndex !== -1`:
   - `decisionConfirmTimeUtcMs` = `candles15m[confirmIndex].timeUtcMs + 15 * 60 * 1000`
   - `logger.warn` pass-through: implement a simple `{ warn: (msg) => console.warn(msg) }` logger
   - If no decision → `htfEdge = "MID_NEUTRAL"`, all other HTF fields = null/0

6. Build and return `BehaviorRow`:

```typescript
return {
  // Meta
  entryDate: input.writeDate,
  uid: input.uid.toString(),
  tradingViewLink: "",
  pair: "$BTC",
  day: toDayString(input.cycleStartUtcMs),
  // INTERACT
  dayOwner: interactResult.dayOwner,
  dateOwner: interactResult.dateOwner,
  date: interactResult.date,
  asiaRange: interactResult.asiaRange,
  previousDayLevel: interactResult.previousDayLevel,
  twoCandleBehavior: interactResult.twoCandleBehavior,
  firstInteractionTime: interactResult.firstInteractionTime,
  firstInteractionSession: interactResult.firstInteractionSession,
  // TRADE (Phase 2 — all blank)
  entryPrice: "", leverage: "", marginUsed: "", positionSize: "",
  accountRisk: "", stopLossPrice: "", takeProfitPrice: "",
  r: "", fees: "", exitPrice: "", exitDateTime: "",
  grossPnl: "", netPnl: "",
  // DECISION
  decisionBeginType: decisionResult.decisionBeginType,
  decisionBeginTime: decisionResult.decisionBeginTime,
  decisionOutput: decisionResult.decisionOutput,
  decisionConfirmTime: decisionResult.decisionConfirmTime,
  failedStatus: decisionResult.failedStatus,
  resolvedDecisionOutput: decisionResult.resolvedDecisionOutput,
  resolvedDecisionStrength: decisionResult.resolvedDecisionStrength,
  // OUTCOME
  resolvedOutcomeDirection: outcomeResult.resolvedOutcomeDirection,
  resolvedOutcomeQuality: outcomeResult.resolvedOutcomeQuality,
  resolvedOutcomeBeginTime: outcomeResult.resolvedOutcomeBeginTime,
  outcomePeakTime: outcomeResult.outcomePeakTime,
  htf4hEdge: htfResult.htfEdge,
  htf4hEdgeLink: "",
  notes: buildNotes(interactResult, decisionResult, outcomeResult, htfResult),
  // Stats
  win: "", loss: "", winDollar: "", lossDollar: "", inUse: "",
  month: toMonthString(input.cycleStartUtcMs),  // ← NOT a formula; must be populated
  consecutiveWins: "", consecutiveLosses: "", uidLink: "",
};
```

**`buildNotes` helper** (private function):
Build a one-line summary. Examples:
- Interaction: `"ASIA_TP_H1 11:00 INTERACT PDH TOUCH_REJECT → 11:15 DECIDE REJ_SUCC_IMP → MEAN-REVERSION MS_HEALTHY EDGE_ALIGN"`
- No interaction: `"No PDH/PDL interaction during active sessions"`
- Interaction + no decision: `"PDH TOUCH_REJECT @ 11:00 → INDECISIVE decision → STALL"`
- Decision + no outcome begin: `"PDH REJECTION confirmed @ 11:30 → outcome not started within 2h window → STALL"`

Export: `BehaviorAnalyzer` class.

---

## Prompt 8 of 11 — BehaviorSheetsReporter

### Context

You are implementing `src/behavior/reporter/BehaviorSheetsReporter.ts` in `dstb-server`.

**Read the existing file `src/monitoring/GoogleSheetsReporter.ts` in full before implementing.** Your class must follow the same patterns exactly:
- Same `SheetsClient` type (re-export or re-use from that file)
- Same `google.auth.GoogleAuth` initialization
- Same `spreadsheets.batchUpdate()` / `values.clear()` / `values.append()` patterns

Available imports:
- `src/behavior/types.ts` — `BehaviorRow`

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/reporter/BehaviorSheetsReporter.ts`.

**Options type (single unified type, not split into Config + Options):**
```typescript
type BehaviorSheetsReporterOptions = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  tabName: string;
}>
```

**Class:**
```typescript
class BehaviorSheetsReporter {
  constructor(options: BehaviorSheetsReporterOptions)

  /**
   * Reads from env: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, BEHAVIOR_SHEET_TAB.
   * BEHAVIOR_SHEET_TAB defaults to "S2-BO-BEHAVIOR-BTC".
   */
  static fromEnv(): BehaviorSheetsReporter

  /**
   * Ensures the tab exists; creates it if missing.
   * Also freezes row 1 (header row) after creation.
   * Safe to call multiple times (idempotent).
   */
  async ensureTab(): Promise<void>

  /**
   * Bulk write: clears the tab, writes header row, then appends all rows.
   * Writes in batches of 50 rows with a 1000ms delay between batches to respect rate limits.
   * Calls ensureTab() first.
   */
  async bulkWrite(rows: readonly BehaviorRow[]): Promise<void>

  /**
   * Incremental write: appends a single row to the bottom of the tab.
   * Calls ensureTab() first (idempotent — no-op if tab already exists).
   */
  async appendRow(row: BehaviorRow): Promise<void>
}
```

**Header row (49 columns, exact order matching docs/behavior-bot-v2.md Section 9):**
```typescript
const HEADER_ROW = [
  "Entry Date", "UID", "TradingView Link", "Pair", "Day",
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
  "Consecutive Wins", "Consecutive Losses", "UID Link"
];
```

**Row serialization:** Implement `rowToArray(row: BehaviorRow): string[]` that maps the 49 `BehaviorRow` fields to a `string[]` in the same column order as `HEADER_ROW`.

**Error handling:** Wrap every API call in try/catch. On error, log with `console.error` and rethrow.

**Rate limit:** In `bulkWrite`, after every batch of 50 rows, `await new Promise(r => setTimeout(r, 1000))`.

---

## Prompt 9 of 11 — Backtest Script

### Context

You are implementing `src/behavior/scripts/runBehaviorBacktest.ts` in `dstb-server`.

**Read these files carefully before implementing:**
- `src/data/binanceDataSource.ts` — `fetchBinanceCandles(args)` — fetches Binance OHLCV
- `src/behavior/analyzer/BehaviorAnalyzer.ts` — `BehaviorAnalyzer` class
- `src/behavior/reporter/BehaviorSheetsReporter.ts` — `BehaviorSheetsReporter` class
- `src/behavior/utils.ts` — `getCycleStartUtcMs`, `toDateString`, `toMyt`

The `fetchBinanceCandles` signature:
```typescript
fetchBinanceCandles(args: {
  symbol: string;       // "BTC-USD"
  interval: YahooInterval;
  startTimeUtc: string; // ISO string
  endTimeUtc: string;
}): Promise<{ candles: readonly Candle[]; warnings: readonly string[] }>
```

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/scripts/runBehaviorBacktest.ts`.

**Import `dotenv/config` at the top** so env vars are loaded automatically.

**Script flow:**

```typescript
async function main(): Promise<void> {
  // ── Step 1: Config ──────────────────────────────────────────────────────────
  const backtestStart = process.env.BEHAVIOR_BACKTEST_START ?? "2026-01-01";
  const backtestEnd   = process.env.BEHAVIOR_BACKTEST_END   ?? new Date().toISOString().slice(0, 10);
  const pair          = process.env.BEHAVIOR_PAIR            ?? "BTC-USD";
  const dryRun        = process.argv.includes("--dry-run");
  const verbose       = process.argv.includes("--verbose");

  // ── Step 2: Fetch 15M candles ────────────────────────────────────────────────
  // Start 1 day BEFORE backtestStart so we have Dec 31 data for Jan 1 PDH/PDL.
  const fetch15mStart = subtractDays(backtestStart, 1);
  const result15m = await fetchBinanceCandles({ symbol: pair, interval: "15m", startTimeUtc: fetch15mStart, endTimeUtc: backtestEnd });

  // ── Step 3: Fetch 4H candles ─────────────────────────────────────────────────
  // Start 45 days before backtestStart: 45 × 6 = 270 4H candles ≥ 200 needed for EMA200.
  const fetch4hStart = subtractDays(backtestStart, 45);
  const result4h = await fetchBinanceCandles({ symbol: pair, interval: "4h", startTimeUtc: fetch4hStart, endTimeUtc: backtestEnd });

  // ── Step 4: Build daily cycle list ──────────────────────────────────────────
  // For each UTC calendar day from backtestStart to backtestEnd:
  const cycles = buildCycles({
    candles15m:  result15m.candles,
    candles4h:   result4h.candles,
    startDate:   backtestStart,
    endDate:     backtestEnd,
  });

  // ── Step 5: Analyze each cycle ──────────────────────────────────────────────
  const analyzer = new BehaviorAnalyzer();
  const rows: BehaviorRow[] = [];
  for (const cycle of cycles) {
    const row = analyzer.analyze(cycle);
    rows.push(row);
    if (verbose) {
      const dateStr = toDateString(cycle.cycleStartUtcMs); // ← use util, not cycle.date
      console.log(`[${dateStr}] ${row.previousDayLevel} ${row.twoCandleBehavior} → ${row.resolvedDecisionOutput} ${row.resolvedOutcomeQuality}`);
    }
  }

  // ── Step 6: Write to Google Sheets ──────────────────────────────────────────
  if (!dryRun) {
    const reporter = BehaviorSheetsReporter.fromEnv();
    await reporter.bulkWrite(rows);
    console.log(`✅ Wrote ${rows.length} rows to Google Sheets.`);
  }

  // ── Step 7: Summary ─────────────────────────────────────────────────────────
  console.log(`✅ Behavior backtest complete: ${rows.length} days analyzed.`);
  if (result15m.warnings.length > 0) console.log("15M warnings:", result15m.warnings);
  if (result4h.warnings.length > 0)  console.log("4H warnings:",  result4h.warnings);
}
```

**`buildCycles` helper (private function):**
```typescript
function buildCycles(args: {
  candles15m: readonly Candle[];
  candles4h: readonly Candle[];
  startDate: string;    // "YYYY-MM-DD" UTC
  endDate: string;
}): readonly DailyCycleInput[]
```

For each UTC calendar day `[startDate, endDate)`:
- `cycleStartUtcMs = Date.parse(dayStr + "T00:00:00Z")`
- `cycleEndUtcMs = cycleStartUtcMs + 24 * 3600 * 1000 - 1`
- `candles15m` = 15M candles with `timeUtcMs >= cycleStartUtcMs AND timeUtcMs < cycleStartUtcMs + 24h`
- `asiaCandles15m` = 15M candles with `timeUtcMs >= cycleStartUtcMs - 8h AND timeUtcMs < cycleStartUtcMs`
- `pdh` = `max(candle.high)` over `asiaCandles15m` extended: use prior UTC calendar day's candles15m for correctness. Specifically, PDH = max(high) of candles with `timeUtcMs in [prevCycleStart, prevCycleStart + 24h)`. Use 15M candles from prior day.
- `pdl` = `min(low)` similarly
- `candles4h` = all 4H candles with `timeUtcMs <= cycleStartUtcMs + 24h` (pass all from start; the analyzer uses `refIndex` logic). Practically: pass all `result4h.candles` — the HTF analyzer will find the right candles by scanning.
- If `candles15m.length === 0` → skip this day (log warning, no row added)
- `uid = rowIndex + 1` (1-based, incrementing only for non-skipped days)
- `writeDate = toDateString(cycleStartUtcMs)`

**`subtractDays` helper (private):**
```typescript
function subtractDays(isoDate: string, days: number): string
// Returns a new ISO date string (YYYY-MM-DDTHH:MM:SSZ) for the given date minus N days.
// Use: new Date(Date.parse(isoDate) - days * 24 * 3600 * 1000).toISOString()
```

**Make runnable:**
```typescript
main().catch((err) => {
  console.error("[behavior-backtest] Fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

---

## Prompt 10 of 11 — Live BehaviorBot

### Context

You are implementing `src/behavior/bot/BehaviorBot.ts` in `dstb-server`.

**Read these files carefully:**
1. `src/monitoring/TelegramAlerter.ts` — `TelegramAlerter` with `sendAlert({ level, message, botId })`
2. `src/exchange/IExchangeAdapter.ts` — `IExchangeAdapter` with `subscribeToCandles()`, `getLatestCandles()`
3. `src/exchange/BitunixMarketApi.ts` — `getKline()` for fetching 4H candles
4. `src/behavior/analyzer/BehaviorAnalyzer.ts`
5. `src/behavior/reporter/BehaviorSheetsReporter.ts`
6. `src/behavior/utils.ts`
7. `src/core/Logger.ts` — `Logger` interface

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/bot/BehaviorBot.ts`.

**Options type:**
```typescript
type BehaviorBotOptions = Readonly<{
  exchangeAdapter: IExchangeAdapter;
  marketApi: BitunixMarketApi;           // For fetching 4H candles (getKline)
  telegramAlerter: TelegramAlerter | null;
  sheetsReporter: BehaviorSheetsReporter;
  pair: string;                          // "BTCUSDT"
  logger: Logger;
}>
```

**Cycle state (reset on each cycle rollover):**
```typescript
type CycleState = {
  cycleStartUtcMs: number;
  candles15mByTime: Map<number, Candle>; // keyed by timeUtcMs for deduplication
  candles4h: Candle[];
  pdh: number;
  pdl: number;
  uid: number;
  decisionAlertSent: boolean;
  outcomeAlertSent: boolean;
}
```

Using `Map<number, Candle>` for `candles15m` prevents duplicates from reconnections. When reading as array, use `[...cycleState.candles15mByTime.values()].sort((a, b) => a.timeUtcMs - b.timeUtcMs)`.

**Class:**
```typescript
class BehaviorBot {
  constructor(options: BehaviorBotOptions)
  async start(): Promise<void>
  async stop(): Promise<void>
}
```

**`start()` flow:**

1. **Load initial data:**
   - Fetch last 200 × 15M candles: `exchangeAdapter.getLatestCandles({ limit: 200 })`
   - Fetch last 270 × 4H candles: `marketApi.getKline({ symbol: pair, interval: "4h", limit: 270 })`
   - Compute `cycleStartUtcMs = getCycleStartUtcMs(Date.now())`
   - Filter 15M candles to current cycle only: `c.timeUtcMs >= cycleStartUtcMs`
   - Seed `cycleState.candles15mByTime` with those candles
   - Derive initial PDH/PDL from prior cycle: `pdh = max(c.high for c in candles where c.timeUtcMs in [cycleStartUtcMs - 24h, cycleStartUtcMs))`
   - `uid = 1` (will be corrected by reading last sheet row if needed — see note)
   - Note: To avoid duplicate UIDs, read the last row of the sheet to get the current UID count, or start from an env-configured `BEHAVIOR_START_UID`.

2. **Subscribe to candles:**
   - Call `subscribeToCandles({ onCandles, onError })`
   - Store the returned unsubscribe function

3. **On each candle batch received:**
   ```
   a. Filter to CLOSED candles only:
      closedCandles = candles.filter(c => c.timeUtcMs + 15*60*1000 <= Date.now())
   
   b. Detect cycle rollover:
      For each closed candle, if c.timeUtcMs >= cycleStartUtcMs + 24h:
        → Finalize current cycle (step 4), then start new cycle

   c. Add candles to accumulator (dedup by timeUtcMs):
      closedCandles.forEach(c => cycleState.candles15mByTime.set(c.timeUtcMs, c))

   d. Incremental DECISION check (if no alert sent yet):
      sortedCandles = [...map.values()].sort(...)
      decisionResult = analyzeDecision({ candles15m: sortedCandles, interactResult, pdh, pdl })
      if decisionResult.decisionConfirmCandleIndex !== -1 && !cycleState.decisionAlertSent:
        → Send Telegram decision alert
        → cycleState.decisionAlertSent = true

   e. Incremental OUTCOME check (if decision alert sent, outcome not yet sent):
      outcomeResult = analyzeOutcome({ candles15m: sortedCandles, decisionResult })
      if outcomeResult.resolvedOutcomeBeginTime !== "N/A" && !cycleState.outcomeAlertSent:
        → Send Telegram outcome alert
        → cycleState.outcomeAlertSent = true
   ```
   Note: For incremental checks in step d/e, run `analyzeInteract()` first each time to get `interactResult`. This is lightweight and idempotent.

4. **Cycle finalization:**
   - Run full `BehaviorAnalyzer.analyze(cycleInput)` on completed cycle
   - Append row to sheets: `sheetsReporter.appendRow(row)`
   - Send daily summary Telegram alert
   - Fetch fresh 4H candles for next cycle
   - Compute new PDH/PDL from just-completed cycle's sorted 15M candles:
     ```typescript
     const completedCandles = [...cycleState.candles15mByTime.values()];
     const newPdh = Math.max(...completedCandles.map(c => c.high));
     const newPdl = Math.min(...completedCandles.map(c => c.low));
     ```
   - Reset `cycleState` with `cycleStartUtcMs += 24h`, empty map, new PDH/PDL, `uid += 1`

5. **Error handling:**
   - `onError` callback: log, wait 5s, call `start()` again (increment reconnect counter)
   - After 3 consecutive reconnect failures: send Telegram CRITICAL alert once, then keep retrying every 30s indefinitely (BTC trades 24/7)
   - Reset reconnect counter on successful candle receipt

**`stop()` flow:**
- Call the stored unsubscribe function
- `exchangeAdapter.disconnect()`
- `logger.info("BehaviorBot stopped")`

Export: `BehaviorBot` class, `BehaviorBotOptions` type.

---

## Prompt 11 of 11 — CLI Integration

### Context

You are modifying and creating files in `dstb-server` to add two new CLI commands.

**Read these files in full before implementing:**
1. `src/cli/index.ts` — main CLI entrypoint + `parseArgv` usage
2. `src/cli/commands/cliTypes.ts` — `CliCommand` type
3. `src/cli/commands/cliUtils.ts` — `parseArgv` function (verify colon support)
4. `src/cli/commands/backtest.ts` — existing command handler pattern
5. `src/behavior/scripts/runBehaviorBacktest.ts` — the backtest script
6. `src/behavior/bot/BehaviorBot.ts` — the live bot

Standards: strict TypeScript, no `any`, no `!`, double quotes, JSDoc on all exports.

### Task

**Part A — Verify `parseArgv` colon support:**
Read `src/cli/commands/cliUtils.ts`. If the parser splits or rejects command names containing colons, change the command names to use hyphens instead: `"behavior-backtest"` and `"behavior-live"`. Otherwise keep the colon format.

---

**Part B — `src/cli/commands/behaviorBacktest.ts`:**
```typescript
/**
 * CLI handler for "behavior:backtest" (or "behavior-backtest").
 * Delegates to runBehaviorBacktest script after parsing CLI flags.
 */
export async function runBehaviorBacktestCommand(args: ParsedCliArgs): Promise<void>
```

Behavior:
- Set `process.env.BEHAVIOR_BACKTEST_START` from `args.flags["start"]` if provided
- Set `process.env.BEHAVIOR_BACKTEST_END` from `args.flags["end"]` if provided
- Add `"--dry-run"` / `"--verbose"` to `process.argv` based on `args.booleanFlags`
- Import and call `main()` from `src/behavior/scripts/runBehaviorBacktest.ts`

---

**Part C — `src/cli/commands/behaviorLive.ts`:**
```typescript
/**
 * CLI handler for "behavior:live" (or "behavior-live").
 * Builds and starts the BehaviorBot using Bitunix live exchange.
 */
export async function runBehaviorLiveCommand(args: ParsedCliArgs): Promise<void>
```

Behavior:
1. Read `--config` flag → load bot config JSON (same format as existing bot configs)
2. Build `BitunixAdapter` + `BitunixMarketApi` from config credentials
3. Build `TelegramAlerter.fromEnv()` if `TELEGRAM_BOT_TOKEN` env var is set, else `null`
4. Build `BehaviorSheetsReporter.fromEnv()`
5. Build `Logger` (use existing logger factory from project)
6. Fetch initial PDH/PDL:
   - Call `marketApi.getKline({ symbol: "BTCUSDT", interval: "1d", limit: 2 })`
   - `pdh = candles[candles.length - 2].high` (penultimate closed 1D candle = yesterday's high)
   - `pdl = candles[candles.length - 2].low`
7. Instantiate and start `BehaviorBot`
8. Add graceful shutdown:
   ```typescript
   const shutdown = () => { bot.stop().catch(console.error).finally(() => process.exit(0)); };
   process.on("SIGINT",  shutdown);
   process.on("SIGTERM", shutdown);
   ```

---

**Part D — Update `src/cli/index.ts`:**
1. Add `"behavior:backtest"` and `"behavior:live"` (or hyphen versions) to `supportedCommands`
2. Import `runBehaviorBacktestCommand` and `runBehaviorLiveCommand`
3. Add switch cases:
   ```typescript
   case "behavior:backtest":
     await runBehaviorBacktestCommand(parsed);
     return;
   case "behavior:live":
     await runBehaviorLiveCommand(parsed);
     return;
   ```
4. Add to `printHelp()`:
   ```
   behavior:backtest   Run S2 behavior backtest (Jan 1 2026 → today)
   behavior:live       Start S2 behavior live bot (Bitunix real-time)
   ```

---

**Part E — Update `src/cli/commands/cliTypes.ts`:**
Add `"behavior:backtest"` and `"behavior:live"` to the `CliCommand` union type.

---

**Part F — Update `package.json`:**
Add scripts:
```json
"behavior:backtest": "npx tsx src/behavior/scripts/runBehaviorBacktest.ts",
"behavior:live": "npm run bot -- behavior:live"
```

---

## Implementation Checklist

Complete these verifications after all 11 prompts are implemented:

### 1. Typecheck
```powershell
npm run typecheck
# Must pass with 0 errors
```

### 2. Dry-run Backtest
```powershell
npm run behavior:backtest -- --dry-run --verbose
# Should print one line per day with fields, no errors, no sheet writes
```

### 3. Full Backtest
```powershell
npm run behavior:backtest -- --verbose
# Verify rows appear in Google Sheet "S2-BO-BEHAVIOR-BTC"
# Verify header row is frozen
# Verify Month column (AT) is populated (not empty)
```

### 4. DST Verification
Verify session labels are correct for dates in each schedule:
- A date in Jan 2026 (WINTER): PDH/PDL interaction at 22:30 MYT should be `US_H1`
- A date in Jul 2026 (SUMMER): same interaction at 22:30 MYT should be `US_H1` (21:30 start) → still `US_H1`
- A date in Mar 15 2026 (TRANSITION): interaction at 21:30 MYT should be `US_H1` (EDT = starts 21:30)

### 5. Field Correctness Spot-Check
Compare a few backtest rows against the original CSV (`Copy of 3.0_Backtest_Darren_TradingJournal - S2-BO-BEHAVIOR-BTC.csv`):
- Confirm touch detection uses `close` only (not wicks)
- Confirm `Month` column has month names, not blanks
- Confirm ATR-based strength labels match

### 6. Live Bot (Paper Mode)
```powershell
npm run bot -- behavior:live --config configs/bot.example.json --verbose
# Verify Telegram alert fires when a 15M candle closes at/beyond PDH or PDL
# Verify no crashes over at least one full 15M candle cycle
# Press Ctrl+C → verify "BehaviorBot stopped" log message appears
```
