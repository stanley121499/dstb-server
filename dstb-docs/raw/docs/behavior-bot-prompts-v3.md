# S2 Behavior Bot — Implementation Prompts (v3)

> **Supersedes:** `docs/behavior-bot-prompts-v2.md`
> Incorporates: Darren's lifecycle update (row = First Interaction Event, no session gate,
> lifecycle crosses day boundary), 50-column sheet, concurrent live bot lifecycles,
> +2h backtest candle fetch, and explicit First Interaction scan boundary.
>
> **How to use:** Pass each prompt to your implementation agent **one at a time, in order**.
> Each prompt is fully self-contained. Verify and typecheck before moving to the next.

---

## Prompt 1 of 11 — Types & Zod Schemas

### Context

You are working in the `dstb-server` TypeScript project:
- TypeScript strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- `zod` for runtime validation
- Double quotes, JSDoc on all exports
- No `any`, no `!`, no `as unknown as T`

### Task

Create `src/behavior/types.ts`.

All enums must be `z.enum()`. All TypeScript types must be derived via `z.infer<typeof Schema>`.

---

**INTERACT Phase enums:**
```
AsiaRangeSchema = z.enum([
  "AR_NONE",       // No Asia level touched (close) during cycle
  "AR_SINGLE_H",   // Only Asia High touched (close >= arHigh)
  "AR_SINGLE_L",   // Only Asia Low touched (close <= arLow)
  "AR_BOTH_HL",    // Asia High touched first, then Low
  "AR_BOTH_LH"     // Asia Low touched first, then High
])

PreviousDayLevelSchema = z.enum(["PDH", "PDL", "PD_NONE"])

TwoCandleBehaviorSchema = z.enum([
  "BREAK_HOLD",         // C1 and C2 both close BEYOND level
  "TOUCH_REJECT",       // C1 and C2 both close BACK INSIDE level
  "TOUCH_CONSOLIDATE",  // Mixed, or one candle missing
  "NO_INTERACTION"      // No PDH/PDL close interaction
])

DayOwnerSchema  = z.enum(["DAY_PREV", "DAY_CURR"])
DateOwnerSchema = z.enum(["DATE_PREV", "DATE_CURR"])

MarketSessionSchema = z.enum([
  "ASIA_PRE",    // 08:00–08:59 MYT (fixed)
  "ASIA_H1",     // 09:00–10:59 MYT (fixed)
  "ASIA_TP_H1",  // 11:00–12:29 MYT (fixed)
  "ASIA_H2",     // 12:30–14:59 MYT (fixed)
  "ASIA_TP_H2",  // 15:00–15:59 MYT winter (superseded by UK_PRE in summer)
  "UK_PRE",      // 16:00–16:59 winter / 15:00–15:59 summer
  "UK_H1",       // 17:00–18:59 winter / 16:00–17:59 summer
  "UK_TP_H1",    // 19:00–20:59 winter / 18:00–19:59 summer
  "UK_H2",       // 21:00–21:29 winter / 20:00–20:29 summer
  "US_PRE",      // 21:30–22:29 winter / 20:30–21:29 summer|transition
  "US_H1",       // 22:30–00:59 winter (crosses midnight) / 21:30–23:59 summer|transition
  "US_TP_H1",    // 01:00–02:29 winter / 00:00–01:29 summer|transition
  "US_H2",       // 02:30–03:59 winter / 01:30–02:59 summer|transition
  "US_TP_H2",    // 04:00–04:59 winter / 03:00–03:59 summer|transition
  "MKT_CLOSED",  // 05:00–06:29 winter / 04:00–05:29 summer|transition
  "MKT_RESET",   // 06:30–07:59 winter / 05:30–07:59 summer|transition
  "N/A"
])
```

Note: All sessions including MKT_CLOSED and MKT_RESET are valid labels for a First Interaction. There is NO session gate.

**DECISION Phase enums:**
```
DecisionBeginTypeSchema = z.enum([
  "ATT_BGN_EARLY",    // C1 and C2 both close cleanly on same side of level
  "ATT_BGN_DEFAULT",  // C1/C2 mixed; begin = first later clean-close candle
  "ATT_IND"           // No interaction
])

DecisionOutputSchema = z.enum(["ACCEPTANCE", "REJECTION", "INDECISIVE"])

FailedStatusSchema = z.enum([
  "ACP_SUCC", "ACP_FAIL_INV", "REJ_SUCC", "REJ_FAIL_INV", "NONE"
])

ResolvedStrengthSchema = z.enum([
  "ACP_SUCC_IMP", "ACP_SUCC_STR", "ACP_SUCC_WEAK",
  "REJ_SUCC_IMP", "REJ_SUCC_STR", "REJ_SUCC_WEAK",
  "IND"
])
```

**OUTCOME Phase enums:**
```
OutcomeDirectionSchema = z.enum(["CONTINUATION", "MEAN-REVERSION", "STALL"])
MoveScoreSchema        = z.enum(["MS_NOISE", "MS_WEAK", "MS_HEALTHY", "MS_STRONG"])
HtfEdgeSchema          = z.enum(["EDGE_ALIGN", "EDGE_CONFLICT", "MID_ALIGN", "MID_NEUTRAL"])
HtfLocationSchema      = z.enum(["EDGE", "MID"])
HtfBiasSchema          = z.enum(["BULL", "BEAR", "NEUTRAL"])
```

**DST schedule:**
```typescript
const DSTScheduleSchema = z.enum(["WINTER", "SUMMER", "TRANSITION"]);
type DSTSchedule = z.infer<typeof DSTScheduleSchema>;
```

**Candle (Zod schema + type):**
```typescript
const CandleSchema = z.object({
  timeUtcMs: z.number().int().positive(),
  open:   z.number().positive(),
  high:   z.number().positive(),
  low:    z.number().positive(),
  close:  z.number().positive(),
  volume: z.number().nonnegative(),
});
type Candle = z.infer<typeof CandleSchema>;
```

**DailyCycleInput:**
```typescript
type DailyCycleInput = {
  cycleStartUtcMs: number;
  // allCandles15m covers [cycleStartUtcMs − 8h, cycleStartUtcMs + 26h) — 34 hours total:
  //   Asia window:  [cycleStart−8h,  cycleStart)         = 00:00–07:59 MYT
  //   Main cycle:   [cycleStart,     cycleStart+24h)      = 08:00 MYT – 07:59 MYT next day
  //   Overflow:     [cycleStart+24h, cycleStart+26h)      = 08:00–09:59 MYT next day
  // ⚠️ First Interaction scan must be bounded to [cycleStart−8h, cycleStart+24h).
  //    Overflow candles are for lifecycle measurement ONLY — NOT for detecting new interactions.
  allCandles15m: readonly Candle[];
  candles4h: readonly Candle[];      // ≥250 4H candles (200 for EMA200 + buffer)
  pdh: number;                       // max(high) of prior UTC calendar day's 15M candles
  pdl: number;                       // min(low)  of prior UTC calendar day's 15M candles
  uid: number;                       // sequential row number (1-based)
  writeDate: string;                 // "dd/mm/yyyy" — date this row is written
                                     // (= cycle date for backtest; = today for live)
}
```

**BehaviorRow — 50 fields (all string for sheet compatibility):**
```typescript
type BehaviorRow = {
  // Meta (A–E)
  entryDate: string;             // "dd/mm/yyyy" — date this row was written
  uid: string;
  tradingViewLink: string;
  pair: string;                  // "$BTC"
  day: string;                   // "Mon", "Tue", etc.
  // INTERACT (F–M)
  dayOwner: string;
  date: string;                  // "dd/mm/yyyy" of cycle
  dateOwner: string;
  asiaRange: string;
  previousDayLevel: string;
  twoCandleBehavior: string;
  firstInteractionTime: string;  // "HH:MM:SS" or "N/A"
  firstInteractionSession: string;
  // TRADE (N–Z) — all "" in Phase 1
  entryPrice: string; leverage: string; marginUsed: string; positionSize: string;
  accountRisk: string; stopLossPrice: string; takeProfitPrice: string;
  r: string; fees: string; exitPrice: string; exitDateTime: string;
  grossPnl: string; netPnl: string;
  // DECISION (AA–AG)
  decisionBeginType: string;
  decisionBeginTime: string;     // "HH:MM:SS" or "N/A"
  decisionOutput: string;
  decisionConfirmTime: string;   // "HH:MM:SS" or "N/A"
  failedStatus: string;
  resolvedDecisionOutput: string;
  resolvedDecisionStrength: string;
  // OUTCOME (AH–AM)
  resolvedOutcomeDirection: string;
  resolvedOutcomeQuality: string;
  resolvedOutcomeBeginTime: string;
  outcomePeakTime: string;
  htf4hEdge: string;
  htf4hEdgeLink: string;
  // Meta — NEW column AN
  lifecycleCrossedDayBoundary: string;  // "YES" | "NO"
  // Meta (AO)
  notes: string;
  // Stats (AP–AX) — all "" except month
  win: string; loss: string; winDollar: string; lossDollar: string; inUse: string;
  month: string;               // ⚠️ "January" etc. — populated by bot, NOT a sheet formula
  consecutiveWins: string; consecutiveLosses: string; uidLink: string;
}
```

Export all schemas and types with JSDoc comments.

---

## Prompt 2 of 11 — Utility Functions

### Context

`dstb-server` TypeScript project. `luxon` is available (`import { DateTime } from "luxon"`).
Reference `Candle`, `MarketSession`, `DSTSchedule` from `src/behavior/types.ts`.
No `any`, no `!`, double quotes, JSDoc on all exports.

### Task

Create `src/behavior/utils.ts`.

---

**1. UTC+8 (MYT) time helpers:**
```typescript
export function toMyt(timestampMs: number): DateTime          // convert to Asia/Singapore
export function toTimeString(timestampMs: number): string     // "HH:MM:SS" in MYT
export function toDateString(timestampMs: number): string     // "dd/mm/yyyy" in MYT
export function toDayString(timestampMs: number): string      // "Mon", "Tue", ...
export function toMonthString(timestampMs: number): string    // "January", ...

/**
 * Returns UTC ms of 00:00:00 UTC for the calendar day containing the given timestamp.
 * Equals the cycle start: 00:00 UTC = 08:00 MYT.
 */
export function getCycleStartUtcMs(timestampMs: number): number
```

---

**2. DST schedule detection:**
```typescript
/**
 * Determines the DST schedule at a given moment.
 * WINTER:     UK GMT (offset=0),   US EST (offset=−300)
 * SUMMER:     UK BST (offset=+60), US EDT (offset=−240)
 * TRANSITION: one differs (early/late season, ~2–3 weeks twice a year)
 */
export function getDSTSchedule(dt: DateTime): DSTSchedule
// Implementation:
// const ukOffset = dt.setZone("Europe/London").offset;
// const usOffset = dt.setZone("America/New_York").offset;
// if (ukOffset === 60 && usOffset === -240) return "SUMMER";
// if (ukOffset === 0  && usOffset === -300) return "WINTER";
// return "TRANSITION";
```

---

**3. DST-aware session classifier:**
```typescript
/**
 * Returns the MarketSession label for a UTC timestamp (ms).
 * Converts to MYT, detects DST schedule, applies correct boundaries.
 * Priority when sessions overlap: US > UK > ASIA.
 *
 * NOTE: All sessions are valid for First Interaction — including MKT_CLOSED and MKT_RESET.
 * This function is for LABELING only, not for gating.
 */
export function classifySession(timestampMs: number): MarketSession
```

**Implementation approach:**
1. `const dt = toMyt(timestampMs); const schedule = getDSTSchedule(dt);`
2. Compute `minuteOfDay = dt.hour * 60 + dt.minute` (0–1439)
3. Match against the boundary table for the schedule. Priority: US sessions first, then UK, then ASIA.

**WINTER boundary table (minutes from midnight MYT):**
```
ASIA_PRE:   480–539   (08:00–08:59)
ASIA_H1:    540–659   (09:00–10:59)
ASIA_TP_H1: 660–749   (11:00–12:29)
ASIA_H2:    750–899   (12:30–14:59)
ASIA_TP_H2: 900–959   (15:00–15:59)
UK_PRE:     960–1019  (16:00–16:59)
UK_H1:      1020–1139 (17:00–18:59)
UK_TP_H1:   1140–1259 (19:00–20:59)
UK_H2:      1260–1289 (21:00–21:29)
US_PRE:     1290–1349 (21:30–22:29)
US_H1:      1350–1439 AND 0–59  (22:30–00:59, crosses midnight)
US_TP_H1:   60–149    (01:00–02:29)
US_H2:      150–239   (02:30–03:59)
US_TP_H2:   240–299   (04:00–04:59)
MKT_CLOSED: 300–389   (05:00–06:29)
MKT_RESET:  390–479   (06:30–07:59)
```

**SUMMER boundary table (UK and US both shift −60 min; Asia fixed):**
```
ASIA_PRE:   480–539   (unchanged)
ASIA_H1:    540–659   (unchanged)
ASIA_TP_H1: 660–749   (unchanged)
ASIA_H2:    750–899   (unchanged)
UK_PRE:     900–959   (15:00–15:59) ← supersedes ASIA_TP_H2 by priority
UK_H1:      960–1079  (16:00–17:59)
UK_TP_H1:   1080–1199 (18:00–19:59)
UK_H2:      1200–1229 (20:00–20:29)
US_PRE:     1230–1289 (20:30–21:29)
US_H1:      1290–1439 (21:30–23:59)   ← no midnight crossing in SUMMER
US_TP_H1:   0–89      (00:00–01:29)
US_H2:      90–179    (01:30–02:59)
US_TP_H2:   180–239   (03:00–03:59)
MKT_CLOSED: 240–329   (04:00–05:29)
MKT_RESET:  330–479   (05:30–07:59)
```

**TRANSITION boundary table (only US shifts −60 min; UK at winter times):**
```
ASIA_PRE:   480–539   (unchanged)
ASIA_H1:    540–659   (unchanged)
ASIA_TP_H1: 660–749   (unchanged)
ASIA_H2:    750–899   (unchanged)
ASIA_TP_H2: 900–959   (15:00–15:59, UK_PRE is at 960 so no overlap)
UK_PRE:     960–1019  (16:00–16:59, winter)
UK_H1:      1020–1139 (17:00–18:59, winter)
UK_TP_H1:   1140–1259 (19:00–20:59, winter)
UK_H2:      1260–1289 (21:00–21:29) ← US_PRE starts at 1230 with priority from 20:30
US_PRE:     1230–1289 (20:30–21:29, EDT)
US_H1:      1290–1439 (21:30–23:59)   ← no midnight crossing in TRANSITION
US_TP_H1:   0–89      (00:00–01:29)
US_H2:      90–179    (01:30–02:59)
US_TP_H2:   180–239   (03:00–03:59)
MKT_CLOSED: 240–329   (04:00–05:29)
MKT_RESET:  330–479   (05:30–07:59)
```

---

**4. ATR (Wilder's smoothing):**
```typescript
/**
 * Returns null if atIndex < period OR atIndex >= candles.length.
 * Guard: if (atIndex < period || atIndex >= candles.length) return null;
 */
export function computeAtr(candles: readonly Candle[], atIndex: number, period: number): number | null
```

---

**5. EMA:**
```typescript
/**
 * Returns null if atIndex < period - 1 OR atIndex >= candles.length.
 * Guard: if (atIndex < period - 1 || atIndex >= candles.length) return null;
 * Seed = SMA of first `period` closes; then standard EMA formula.
 */
export function computeEma(candles: readonly Candle[], atIndex: number, period: number): number | null
```

---

**6. Candle helpers:**
```typescript
/**
 * Filters candles to the Asia window: [cycleStartUtcMs − 8h, cycleStartUtcMs).
 * These are the 00:00–07:59 MYT candles (prior UTC calendar day).
 */
export function filterAsiaCandles(candles: readonly Candle[], cycleStartUtcMs: number): readonly Candle[]

/**
 * Filters candles to the First Interaction scan window:
 * [cycleStartUtcMs − 8h, cycleStartUtcMs + 24h).
 * This includes Asia + main cycle but explicitly EXCLUDES overflow candles.
 */
export function filterScanCandles(candles: readonly Candle[], cycleStartUtcMs: number): readonly Candle[]

/**
 * Finds the index of a candle by its exact open time (UTC ms).
 * Returns −1 if not found.
 */
export function findCandleIndex(candles: readonly Candle[], openTimeUtcMs: number): number
```

Export all. No `any`, no `!`.

---

## Prompt 3 of 11 — INTERACT Analyzer

### Context

Implements `src/behavior/analyzer/interactAnalyzer.ts` in `dstb-server`.

Imports:
- `src/behavior/types.ts` — all enums
- `src/behavior/utils.ts` — `toMyt`, `toTimeString`, `toDateString`, `toDayString`, `classifySession`, `filterAsiaCandles`, `filterScanCandles`

Standards: strict TS, no `any`, no `!`, double quotes, JSDoc on exports.

### Task

Create `src/behavior/analyzer/interactAnalyzer.ts`.

**Input type:**
```typescript
type InteractInput = Readonly<{
  allCandles15m: readonly Candle[];  // full 34h window [cycleStart−8h, cycleStart+26h)
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
  date: string;                          // "dd/mm/yyyy"
  day: string;                           // "Mon", etc.
  asiaRange: AsiaRange;
  previousDayLevel: PreviousDayLevel;
  twoCandleBehavior: TwoCandleBehavior;
  firstInteractionTime: string;          // "HH:MM:SS" or "N/A"
  firstInteractionSession: MarketSession;
  firstInteractionCandleIndex: number;   // index in allCandles15m; −1 if none
}>
```

**Logic:**

**Step 1 — Asia Range (uses Asia window subset only):**
```typescript
const asiaCandles = filterAsiaCandles(allCandles15m, cycleStartUtcMs);
// arHigh = max(c.high), arLow = min(c.low) over asiaCandles
// If asiaCandles is empty → AR_NONE
// Scan allCandles15m (main cycle only: c.timeUtcMs >= cycleStartUtcMs AND < cycleStartUtcMs+24h)
// for close >= arHigh (H touch) or close <= arLow (L touch). First wins.
```
→ `AR_NONE`, `AR_SINGLE_H`, `AR_SINGLE_L`, `AR_BOTH_HL`, `AR_BOTH_LH`

**Step 2 — First Interaction scan (scan window only — NOT overflow):**
```typescript
const scanCandles = filterScanCandles(allCandles15m, cycleStartUtcMs);
// Scan scanCandles chronologically.
// Touch PDH: candle.close >= pdh
// Touch PDL: candle.close <= pdl
// First qualifying candle → firstInteractionCandleIndex (index in allCandles15m!)
// Record the level touched first → previousDayLevel
```
> ⚠️ **The `firstInteractionCandleIndex` must be the candle's index in `allCandles15m`**, not in `scanCandles`. Use `findCandleIndex(allCandles15m, scanCandle.timeUtcMs)` to get the correct index.

No session gate — ANY candle in the scan window is eligible regardless of its session label.

**Step 3 — Two-Candle Behavior:**
- `C1 = allCandles15m[firstInteractionCandleIndex]`
- `C2 = allCandles15m[firstInteractionCandleIndex + 1]` (may be `undefined` — guard: treat missing C2 as `TOUCH_CONSOLIDATE`)
- For PDH: both `close > pdh` → `BREAK_HOLD`; both `close < pdh` → `TOUCH_REJECT`; else → `TOUCH_CONSOLIDATE`
- For PDL: both `close < pdl` → `BREAK_HOLD`; both `close > pdl` → `TOUCH_REJECT`; else → `TOUCH_CONSOLIDATE`
- No interaction → `NO_INTERACTION`

**Step 4 — Times, session, day/date owner:**
- `firstInteractionTime = toTimeString(C1.timeUtcMs)` or `"N/A"`
- `firstInteractionSession = classifySession(C1.timeUtcMs)` or `"N/A"`
- `date = toDateString(cycleStartUtcMs)` — the cycle's MYT calendar date
- Day Owner: if `toMyt(C1.timeUtcMs).hour < 8` → `DAY_PREV` / `DATE_PREV`; else → `DAY_CURR` / `DATE_CURR`
- No interaction → `DAY_CURR` / `DATE_CURR`

Export: `analyzeInteract(input: InteractInput): InteractResult`
Export types: `InteractInput`, `InteractResult`

---

## Prompt 4 of 11 — DECISION Analyzer

### Context

Implements `src/behavior/analyzer/decisionAnalyzer.ts`.

Imports:
- `src/behavior/types.ts` — all enums
- `src/behavior/utils.ts` — `toTimeString`, `computeAtr`
- `src/behavior/analyzer/interactAnalyzer.ts` — `InteractResult`

Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/analyzer/decisionAnalyzer.ts`.

**Input:**
```typescript
type DecisionInput = Readonly<{
  allCandles15m: readonly Candle[];  // full 34h window
  interactResult: InteractResult;
  pdh: number;
  pdl: number;
}>
```

**Output:**
```typescript
type DecisionResult = Readonly<{
  decisionBeginType: DecisionBeginType;
  decisionBeginTime: string;              // "HH:MM:SS" or "N/A"
  decisionOutput: DecisionOutput;
  decisionConfirmTime: string;            // "HH:MM:SS" (open + 15 min of C0)
  decisionConfirmCandleIndex: number;     // index of C0 in allCandles15m; −1 if none
  failedStatus: FailedStatus;
  resolvedDecisionOutput: DecisionOutput;
  resolvedDecisionStrength: ResolvedStrength;
  atrAtConfirm: number | null;
  decisionLevelPrice: number;             // pdh or pdl (0 if PD_NONE)
  previousDayLevel: PreviousDayLevel;     // passed through from interactResult
}>
```

**Logic:**

**Early exit — no interaction:**
If `interactResult.firstInteractionCandleIndex === −1` or `interactResult.previousDayLevel === "PD_NONE"`:
→ Return all defaults: `ATT_IND`, `INDECISIVE`, `NONE`, `IND`, times `"N/A"`, indices `−1`, ATR null, level `0`.

**Decision level price:**
```typescript
const decisionLevelPrice = interactResult.previousDayLevel === "PDH" ? pdh : pdl;
```

**Decision Begin Type:**
C1 = `allCandles15m[startIdx]`, C2 = `allCandles15m[startIdx + 1]`.
- C2 undefined → `ATT_BGN_DEFAULT`
- Both close same side:
  - PDH: `(C1.close >= pdh && C2.close >= pdh)` OR `(C1.close < pdh && C2.close < pdh)` → `ATT_BGN_EARLY`
  - PDL: `(C1.close <= pdl && C2.close <= pdl)` OR `(C1.close > pdl && C2.close > pdl)` → `ATT_BGN_EARLY`
- Else → `ATT_BGN_DEFAULT`

**Decision Begin Time:**
- `ATT_BGN_EARLY` → `toTimeString(C1.timeUtcMs)`
- `ATT_BGN_DEFAULT` → scan from `startIdx` for first "clean" candle (close fully on one side: `close > pdh` OR `close < pdh` for PDH; `close < pdl` OR `close > pdl` for PDL) → its open time. None found → `"N/A"`.

**2-Consecutive-Candle Rule:**
Scan `allCandles15m` from `startIdx` to end of array (includes overflow). Find first pair of 2 consecutive closes:
- Both `close >= pdh` (PDH) or both `close <= pdl` (PDL) → `ACCEPTANCE`; `decisionConfirmCandleIndex` = 2nd candle
- Both `close < pdh` (PDH) or both `close > pdl` (PDL) → `REJECTION`; `decisionConfirmCandleIndex` = 2nd candle
- No pair → `INDECISIVE`, index `−1`
- `decisionConfirmTime = toTimeString(candles[confirmIndex].timeUtcMs + 15 * 60 * 1000)`

**C3–C6 Durability:**
Candles at `confirmIndex+1` through `confirmIndex+4` (slice from `allCandles15m`; may be fewer than 4 — use all available). For ACCEPTANCE: 2 consecutive `close < pdh` (PDH) → `ACP_FAIL_INV`; else `ACP_SUCC`. For REJECTION: 2 consecutive `close >= pdh` → `REJ_FAIL_INV`; else `REJ_SUCC`. Fewer than 2 available → success (no pair possible).

**Resolved Decision Output:**
- `ACP_SUCC` → `ACCEPTANCE`
- `ACP_FAIL_INV` → check C3–C6 for 2 consecutive closes back inside → `REJECTION`; else `INDECISIVE`
- `REJ_SUCC` → `REJECTION`
- `REJ_FAIL_INV` → check C3–C6 for 2 consecutive closes back beyond → `ACCEPTANCE`; else `INDECISIVE`
- `NONE` → `INDECISIVE`

**ATR + Strength (C1–C4 window from allCandles15m):**
`atrAtConfirm = computeAtr(allCandles15m, confirmIndex, 14)` — returns null if index < 14.
Window = `allCandles15m[confirmIndex+1 .. confirmIndex+4]`.
- Speed: ATR threshold = `decisionLevelPrice ± atr`. FAST if C1/C2 high/low crosses. MODERATE if C3/C4. SLOW otherwise.
- Friction (close-touch only): ACCEPTANCE: count `close < pdh`; REJECTION: count `close > pdl`.
- Map: FAST+0 → IMP; FAST+1 or MOD+≤1 → STR; else → WEAK. INDECISIVE → `IND`.

Export: `analyzeDecision(input: DecisionInput): DecisionResult`
Export types: `DecisionInput`, `DecisionResult`

---

## Prompt 5 of 11 — OUTCOME Analyzer

### Context

Implements `src/behavior/analyzer/outcomeAnalyzer.ts`.

Imports:
- `src/behavior/types.ts`
- `src/behavior/utils.ts` — `toTimeString`
- `src/behavior/analyzer/decisionAnalyzer.ts` — `DecisionResult`

Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/analyzer/outcomeAnalyzer.ts`.

**Input:**
```typescript
type OutcomeInput = Readonly<{
  allCandles15m: readonly Candle[];
  decisionResult: DecisionResult;
  // decisionResult.decisionLevelPrice = PDH or PDL (whichever was interacted)
  // decisionResult.previousDayLevel = "PDH" | "PDL" (for direction derivation)
}>
```

**Output:**
```typescript
type OutcomeResult = Readonly<{
  resolvedOutcomeDirection: OutcomeDirection;
  resolvedOutcomeQuality: MoveScore;
  resolvedOutcomeBeginTime: string;
  outcomePeakTime: string;
  moveScore: number;
}>
```

**Early exit — no decision:**
If `decisionResult.decisionConfirmCandleIndex === −1` or `resolvedDecisionOutput === "INDECISIVE"`:
→ `STALL`, `MS_NOISE`, `"N/A"`, `"N/A"`, `0`

**Expected direction:**
```
PDH + ACCEPTANCE → "UP"
PDH + REJECTION  → "DOWN"
PDL + ACCEPTANCE → "DOWN"
PDL + REJECTION  → "UP"
```

**C1–C8 window:**
```typescript
const confirmIndex = decisionResult.decisionConfirmCandleIndex;
const window = allCandles15m.slice(confirmIndex + 1, confirmIndex + 9);
// May be fewer than 8 candles — use all available. Overflow candles are included naturally.
```

**MoveScore:**
```typescript
const decisionLevelPrice = decisionResult.decisionLevelPrice;
const atr = decisionResult.atrAtConfirm;

let move = 0;
if (atr !== null && atr > 0) {
  if (expectedDirection === "UP") {
    move = Math.max(0, Math.max(...window.map(c => c.high)) - decisionLevelPrice);
  } else {
    move = Math.max(0, decisionLevelPrice - Math.min(...window.map(c => c.low)));
  }
  moveScore = move / atr;
}
// If atr null or 0 → moveScore = 0
```

Classify: `< 0.5` → `MS_NOISE` (force direction `STALL`); `0.5–<1.0` → `MS_WEAK`; `1.0–<2.0` → `MS_HEALTHY`; `≥2.0` → `MS_STRONG`.

**Outcome Begin Time:** Scan `window`, track `previousClose = C0.close`. Qualifying candle (UP):
1. `c.close > previousClose`
2. `c.close > decisionLevelPrice`
3. `c.close − decisionLevelPrice >= atr * 0.25`
First qualifying → `toTimeString(c.timeUtcMs)`. None → `"N/A"`. (Flip for DOWN.)

**Outcome Peak Time:** UP: candle with max `high` in `window`. DOWN: min `low`. → `toTimeString`. Empty window → `"N/A"`.

Export: `analyzeOutcome(input: OutcomeInput): OutcomeResult`
Export types: `OutcomeInput`, `OutcomeResult`

---

## Prompt 6 of 11 — HTF Context Analyzer

### Context

Implements `src/behavior/analyzer/htfContextAnalyzer.ts`.

Imports: `src/behavior/types.ts`, `src/behavior/utils.ts` — `computeEma`.
Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/analyzer/htfContextAnalyzer.ts`.

**Input:**
```typescript
type HtfContextInput = Readonly<{
  candles4h: readonly Candle[];
  decisionConfirmTimeUtcMs: number;  // = confirmCandle.timeUtcMs + 15 * 60 * 1000 (C0 close)
  decisionLevelPrice: number;
  expectedDirection: "UP" | "DOWN" | "N/A";
  logger: { warn: (msg: string) => void };
}>
```

**Output:**
```typescript
type HtfContextResult = Readonly<{
  htfEdge: HtfEdge;
  location: HtfLocation | null;
  bias: HtfBias | null;
  rangeHigh: number;
  rangeLow: number;
  ema55: number | null;
  ema200: number | null;
}>
```

**Logic:**

**Find reference 4H candle:**
Latest closed 4H candle: `candle.timeUtcMs + 4 * 3600 * 1000 <= decisionConfirmTimeUtcMs`.
Scan from end of array backward. If none found (`refIndex === −1`) → log warning, return `MID_NEUTRAL` default.

**Rolling range (N=12 4H candles):**
`startIdx = Math.max(0, refIndex − 11)`, slice `[startIdx, refIndex+1]`.
If fewer than 2 → `MID_NEUTRAL` + warn.
```typescript
const rangeHigh = Math.max(...rangeCandles.map(c => c.high));
const rangeLow  = Math.min(...rangeCandles.map(c => c.low));
const rangeWidth = rangeHigh - rangeLow;
```
If `rangeWidth < 1.0` → log warn, return `MID_NEUTRAL` (degenerate range).

**Location:**
```typescript
const edgeBand = rangeWidth * 0.20;
const location: HtfLocation =
  (decisionLevelPrice >= rangeHigh - edgeBand || decisionLevelPrice <= rangeLow + edgeBand)
    ? "EDGE" : "MID";
```

**EMA Bias:**
```typescript
const ema55  = computeEma(candles4h, refIndex, 55);
const ema200 = computeEma(candles4h, refIndex, 200);
if (ema200 === null) logger.warn("HTF: EMA200 null — insufficient 4H history");
const bias: HtfBias =
  ema55 === null || ema200 === null ? "NEUTRAL" :
  ema55 > ema200 ? "BULL" : ema55 < ema200 ? "BEAR" : "NEUTRAL";
```

**Combined label:**
```typescript
if (expectedDirection === "N/A") return { htfEdge: "MID_NEUTRAL", location, bias, ... };
const isSupport =
  (expectedDirection === "UP" && bias === "BULL") ||
  (expectedDirection === "DOWN" && bias === "BEAR");
const htfEdge: HtfEdge =
  location === "EDGE" && isSupport  ? "EDGE_ALIGN" :
  location === "EDGE" && !isSupport ? "EDGE_CONFLICT" :
  location === "MID"  && isSupport  ? "MID_ALIGN" : "MID_NEUTRAL";
```

Export: `analyzeHtfContext(input: HtfContextInput): HtfContextResult`
Export types: `HtfContextInput`, `HtfContextResult`

---

## Prompt 7 of 11 — BehaviorAnalyzer Orchestrator

### Context

Implements `src/behavior/analyzer/BehaviorAnalyzer.ts`.

Imports: all 4 analyzers, `src/behavior/types.ts` (`DailyCycleInput`, `BehaviorRow`), `src/behavior/utils.ts`.
Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/analyzer/BehaviorAnalyzer.ts`.

```typescript
export class BehaviorAnalyzer {
  public analyze(input: DailyCycleInput): BehaviorRow
}
```

**Orchestration:**

1. `interactResult = analyzeInteract({ allCandles15m: input.allCandles15m, cycleStartUtcMs: input.cycleStartUtcMs, pdh: input.pdh, pdl: input.pdl })`

2. `decisionResult = analyzeDecision({ allCandles15m: input.allCandles15m, interactResult, pdh: input.pdh, pdl: input.pdl })`

3. Derive `expectedDirection`:
   - `PDH + ACCEPTANCE` → `"UP"`, `PDH + REJECTION` → `"DOWN"`
   - `PDL + ACCEPTANCE` → `"DOWN"`, `PDL + REJECTION` → `"UP"`
   - else → `"N/A"`

4. `outcomeResult = analyzeOutcome({ allCandles15m: input.allCandles15m, decisionResult })`

5. `htfResult` — only if `decisionResult.decisionConfirmCandleIndex !== −1`:
   ```typescript
   const confirmCandle = input.allCandles15m[decisionResult.decisionConfirmCandleIndex];
   const decisionConfirmTimeUtcMs = confirmCandle !== undefined
     ? confirmCandle.timeUtcMs + 15 * 60 * 1000 : 0;
   htfResult = analyzeHtfContext({
     candles4h: input.candles4h,
     decisionConfirmTimeUtcMs,
     decisionLevelPrice: decisionResult.decisionLevelPrice,
     expectedDirection,
     logger: { warn: (msg) => console.warn("[HTF]", msg) },
   });
   ```
   If no decision → `htfEdge = "MID_NEUTRAL"`, others null/0.

6. **`lifecycleCrossedDayBoundary`:**
   ```typescript
   const nextCycleStart = input.cycleStartUtcMs + 24 * 60 * 60 * 1000;
   // Collect indices of all candles used in C3-C6 and C1-C8
   const confirmIdx = decisionResult.decisionConfirmCandleIndex;
   const usedIndices: number[] = [];
   if (confirmIdx !== -1) {
     for (let i = confirmIdx + 1; i <= confirmIdx + 8; i++) usedIndices.push(i); // C1-C8
     for (let i = confirmIdx + 1; i <= confirmIdx + 4; i++) {}                  // C3-C6 already in range
   }
   const crossed = usedIndices.some(idx => {
     const c = input.allCandles15m[idx];
     return c !== undefined && c.timeUtcMs >= nextCycleStart;
   });
   const lifecycleCrossedDayBoundary = crossed ? "YES" : "NO";
   ```

7. Build `BehaviorRow`:
   ```typescript
   return {
     entryDate: input.writeDate,
     uid: input.uid.toString(),
     tradingViewLink: "",
     pair: "$BTC",
     day: toDayString(input.cycleStartUtcMs),
     dayOwner: interactResult.dayOwner,
     date: interactResult.date,
     dateOwner: interactResult.dateOwner,
     asiaRange: interactResult.asiaRange,
     previousDayLevel: interactResult.previousDayLevel,
     twoCandleBehavior: interactResult.twoCandleBehavior,
     firstInteractionTime: interactResult.firstInteractionTime,
     firstInteractionSession: interactResult.firstInteractionSession,
     // Trade — Phase 1 blanks
     entryPrice: "", leverage: "", marginUsed: "", positionSize: "",
     accountRisk: "", stopLossPrice: "", takeProfitPrice: "",
     r: "", fees: "", exitPrice: "", exitDateTime: "", grossPnl: "", netPnl: "",
     // Decision
     decisionBeginType: decisionResult.decisionBeginType,
     decisionBeginTime: decisionResult.decisionBeginTime,
     decisionOutput: decisionResult.decisionOutput,
     decisionConfirmTime: decisionResult.decisionConfirmTime,
     failedStatus: decisionResult.failedStatus,
     resolvedDecisionOutput: decisionResult.resolvedDecisionOutput,
     resolvedDecisionStrength: decisionResult.resolvedDecisionStrength,
     // Outcome
     resolvedOutcomeDirection: outcomeResult.resolvedOutcomeDirection,
     resolvedOutcomeQuality: outcomeResult.resolvedOutcomeQuality,
     resolvedOutcomeBeginTime: outcomeResult.resolvedOutcomeBeginTime,
     outcomePeakTime: outcomeResult.outcomePeakTime,
     htf4hEdge: htfResult.htfEdge,
     htf4hEdgeLink: "",
     lifecycleCrossedDayBoundary,   // ← column AN
     notes: buildNotes(interactResult, decisionResult, outcomeResult, htfResult),
     // Stats
     win: "", loss: "", winDollar: "", lossDollar: "", inUse: "",
     month: toMonthString(input.cycleStartUtcMs),   // ← populated here, NOT a formula
     consecutiveWins: "", consecutiveLosses: "", uidLink: "",
   };
   ```

**`buildNotes` (private function):**
One-line summary. Examples:
- Has interaction + decision + outcome: `"ASIA_TP_H1 11:00 INTERACT PDH TOUCH_REJECT → 11:15 DECIDE REJ_SUCC_IMP → MEAN-REVERSION MS_HEALTHY EDGE_ALIGN"`
- No interaction: `"No PDH/PDL interaction"`
- Interaction + indecisive: `"PDH TOUCH_REJECT @ 11:00 → INDECISIVE decision → STALL"`
- Decision + no outcome begin: `"PDH REJECTION @ 11:30 → outcome not started within 2h window → STALL"`
- Lifecycle crossed: append `"[Crossed day boundary]"` to the note

Export: `BehaviorAnalyzer` class.

---

## Prompt 8 of 11 — BehaviorSheetsReporter

### Context

Implements `src/behavior/reporter/BehaviorSheetsReporter.ts`.

**Read `src/monitoring/GoogleSheetsReporter.ts` in full before implementing.** Match its patterns exactly: `SheetsClient`, `google.auth.GoogleAuth`, `spreadsheets.batchUpdate()`, `values.clear()`, `values.append()`.

Imports: `src/behavior/types.ts` — `BehaviorRow`.
Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/reporter/BehaviorSheetsReporter.ts`.

```typescript
type BehaviorSheetsReporterOptions = Readonly<{
  sheetId: string;
  serviceAccountKeyPath: string;
  tabName: string;   // default "S2-BO-BEHAVIOR-BTC"
}>

export class BehaviorSheetsReporter {
  constructor(options: BehaviorSheetsReporterOptions)
  
  /** Reads GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY, BEHAVIOR_SHEET_TAB from env. */
  static fromEnv(): BehaviorSheetsReporter

  /** Creates tab if missing; freezes row 1. Safe to call multiple times. */
  async ensureTab(): Promise<void>

  /** Clear → header → rows in batches of 50 (1s delay each batch). Calls ensureTab() first. */
  async bulkWrite(rows: readonly BehaviorRow[]): Promise<void>

  /** Append one row. Calls ensureTab() first (idempotent). */
  async appendRow(row: BehaviorRow): Promise<void>
}
```

**Header row — 50 columns (exact order):**
```typescript
const HEADER_ROW = [
  "Entry Date", "UID", "TradingView Link", "Pair", "Day",
  "Day Owner", "Date (dd/mm/yyyy)", "Date Owner",
  "Asia Range", "Previous-Day Level", "Two-Candle First Interaction Behavior",
  "First Interaction Time", "First Interaction Market Session",
  "Entry Price ($)", "Leverage (X)", "Margin Used ($)", "Position Size (Units)",
  "Account Risk", "Stop Loss Price ($)", "Take Profit Price ($)", "R", "Fees ($)",
  "Exit Price ($)", "Exit Date & Time", "Gross P/L", "Net P/L",
  "Decision Attempt #1 Begin Type", "Decision Attempt #1 Begin Time",
  "Decision Attempt #1 Output", "Decision #1 Confirm Time",
  "Decision Attempt #1 Failed Status",
  "Resolved Decision Output", "Resolved Decision Strength",
  "Resolved Outcome Direction", "Resolved Outcome Quality",
  "Resolved Outcome Begin Time", "Outcome Peak Time",
  "HTF 4H Edge", "HTF 4H Edge Link",
  "Lifecycle Crossed Day Boundary",   // ← column AN (new)
  "Notes",
  "Win", "Loss", "Win$", "Loss$", "In Use", "Month",
  "Consecutive Wins", "Consecutive Losses", "UID Link"
];
// Total: 50 columns
```

**`rowToArray(row: BehaviorRow): string[]`** — serializes BehaviorRow to 50-element array in the same column order. Implement as a private function.

**Error handling:** Wrap all API calls in try/catch. Log with `console.error` and rethrow.

**Rate limit:** 1000ms delay after each batch of 50 in `bulkWrite`.

---

## Prompt 9 of 11 — Backtest Script

### Context

Implements `src/behavior/scripts/runBehaviorBacktest.ts`.

**Read these files first:**
- `src/data/binanceDataSource.ts` — `fetchBinanceCandles(args)` signature and return type
- `src/behavior/analyzer/BehaviorAnalyzer.ts`
- `src/behavior/reporter/BehaviorSheetsReporter.ts`
- `src/behavior/utils.ts` — `getCycleStartUtcMs`, `toDateString`

Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/scripts/runBehaviorBacktest.ts`.

**Import `dotenv/config` at the top.**

```typescript
async function main(): Promise<void> {
  // ── Step 1: Config ───────────────────────────────────────────────────────
  const backtestStart = process.env.BEHAVIOR_BACKTEST_START ?? "2026-01-01";
  const backtestEnd   = process.env.BEHAVIOR_BACKTEST_END   ?? new Date().toISOString().slice(0, 10);
  const pair          = process.env.BEHAVIOR_PAIR            ?? "BTC-USD";
  const dryRun        = process.argv.includes("--dry-run");
  const verbose       = process.argv.includes("--verbose");

  // ── Step 2: Fetch 15M candles ─────────────────────────────────────────────
  // Start 1 day BEFORE backtestStart → captures Dec 31 data needed for Jan 1 PDH/PDL.
  // End 2 HOURS AFTER backtestEnd    → captures lifecycle overflow for last day.
  const fetch15mStart = subtractDays(backtestStart, 1);
  const fetch15mEnd   = addHours(backtestEnd, 2);       // ← +2h for overflow
  const result15m = await fetchBinanceCandles({
    symbol: pair, interval: "15m",
    startTimeUtc: fetch15mStart, endTimeUtc: fetch15mEnd,
  });

  // ── Step 3: Fetch 4H candles ─────────────────────────────────────────────
  // Start 45 days before backtestStart: 45 × 6 bars = 270 bars ≥ 200 for EMA200.
  const fetch4hStart = subtractDays(backtestStart, 45);
  const result4h = await fetchBinanceCandles({
    symbol: pair, interval: "4h",
    startTimeUtc: fetch4hStart, endTimeUtc: backtestEnd,
  });

  // ── Step 4: Build cycle list ──────────────────────────────────────────────
  const cycles = buildCycles({
    candles15m: result15m.candles,
    candles4h: result4h.candles,
    startDate: backtestStart,
    endDate: backtestEnd,
  });

  // ── Step 5: Analyze each cycle ────────────────────────────────────────────
  const analyzer = new BehaviorAnalyzer();
  const rows: BehaviorRow[] = [];
  for (const cycle of cycles) {
    const row = analyzer.analyze(cycle);
    rows.push(row);
    if (verbose) {
      console.log(
        `[${toDateString(cycle.cycleStartUtcMs)}]`,
        row.previousDayLevel, row.twoCandleBehavior,
        "→", row.resolvedDecisionOutput, row.resolvedOutcomeQuality,
        row.lifecycleCrossedDayBoundary === "YES" ? "[CROSSED]" : ""
      );
    }
  }

  // ── Step 6: Write to Sheets ───────────────────────────────────────────────
  if (!dryRun) {
    const reporter = BehaviorSheetsReporter.fromEnv();
    await reporter.bulkWrite(rows);
    console.log(`✅ Wrote ${rows.length} rows to Google Sheets.`);
  }

  console.log(`✅ Backtest complete: ${rows.length} days analyzed.`);
}
```

**`buildCycles` (private function):**
```typescript
function buildCycles(args: {
  candles15m: readonly Candle[];
  candles4h: readonly Candle[];
  startDate: string;
  endDate: string;
}): readonly DailyCycleInput[]
```

For each UTC calendar day `[startDate, endDate]` (inclusive):
```typescript
const cycleStartUtcMs = Date.parse(day + "T00:00:00Z");

// allCandles15m = full 34h window:
//   Asia window:  [cycleStart − 8h,  cycleStart)           = 16:00–23:59 UTC prev day
//   Main cycle:   [cycleStart,        cycleStart + 24h)     = 00:00–23:59 UTC this day
//   Overflow:     [cycleStart + 24h,  cycleStart + 26h)     = 00:00–01:59 UTC next day
const windowStart = cycleStartUtcMs - 8 * 3600 * 1000;
const windowEnd   = cycleStartUtcMs + 26 * 3600 * 1000;
const allCandles15m = candles15m.filter(
  c => c.timeUtcMs >= windowStart && c.timeUtcMs < windowEnd
);

// Skip if main cycle has no candles (exchange downtime/holiday)
const mainCandles = allCandles15m.filter(
  c => c.timeUtcMs >= cycleStartUtcMs && c.timeUtcMs < cycleStartUtcMs + 24 * 3600 * 1000
);
if (mainCandles.length === 0) {
  console.warn(`[buildCycles] Skipping ${day}: no 15M candles in main cycle window`);
  continue; // or skip this day
}

// PDH/PDL from prior UTC calendar day's 15M candles
const prevStart = cycleStartUtcMs - 24 * 3600 * 1000;
const prevCandles = candles15m.filter(
  c => c.timeUtcMs >= prevStart && c.timeUtcMs < cycleStartUtcMs
);
const pdh = prevCandles.length > 0 ? Math.max(...prevCandles.map(c => c.high)) : 0;
const pdl = prevCandles.length > 0 ? Math.min(...prevCandles.map(c => c.low))  : 0;

// For candles4h: pass the full array; HTF analyzer uses refIndex logic internally
cycles.push({
  cycleStartUtcMs,
  cycleEndUtcMs: cycleStartUtcMs + 24 * 3600 * 1000 - 1,
  allCandles15m,
  candles4h: args.candles4h,   // full array — HTF analyzer finds its own refIndex
  pdh, pdl,
  uid: cycles.length + 1,
  writeDate: toDateString(cycleStartUtcMs),
});
```

**Helpers:**
```typescript
function subtractDays(isoDate: string, days: number): string
// new Date(Date.parse(isoDate + "T00:00:00Z") - days * 86400000).toISOString()

function addHours(isoDate: string, hours: number): string
// new Date(Date.parse(isoDate + "T00:00:00Z") + hours * 3600000).toISOString()
```

**Error handler:**
```typescript
main().catch((err) => {
  console.error("[behavior-backtest] Fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

---

## Prompt 10 of 11 — Live BehaviorBot

### Context

Implements `src/behavior/bot/BehaviorBot.ts`.

**Read these files:**
1. `src/monitoring/TelegramAlerter.ts` — `sendAlert({ level, message, botId })`
2. `src/exchange/IExchangeAdapter.ts` — `subscribeToCandles()`, `getLatestCandles()`
3. `src/exchange/BitunixMarketApi.ts` — `getKline()`
4. `src/behavior/analyzer/BehaviorAnalyzer.ts`
5. `src/behavior/reporter/BehaviorSheetsReporter.ts`
6. `src/behavior/utils.ts`
7. `src/core/Logger.ts` — `Logger` interface

Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

Create `src/behavior/bot/BehaviorBot.ts`.

**Cycle state type:**
```typescript
type CycleState = {
  cycleStartUtcMs: number;
  candlesByTime: Map<number, Candle>;  // keyed by timeUtcMs for deduplication
  candles4h: readonly Candle[];
  pdh: number;
  pdl: number;
  uid: number;
  decisionAlertSent: boolean;
  outcomeAlertSent: boolean;
}
```

**Bot class:**
```typescript
type BehaviorBotOptions = Readonly<{
  exchangeAdapter: IExchangeAdapter;
  marketApi: BitunixMarketApi;
  telegramAlerter: TelegramAlerter | null;
  sheetsReporter: BehaviorSheetsReporter;
  pair: string;
  startUid: number;          // from env BEHAVIOR_START_UID, default 1
  logger: Logger;
}>

export class BehaviorBot {
  private activeState: CycleState;
  private pendingState: CycleState | null = null;  // previous day's lifecycle still completing
  private unsubscribe: (() => void) | null = null;
  private reconnectCount = 0;

  constructor(options: BehaviorBotOptions)
  async start(): Promise<void>
  async stop(): Promise<void>
}
```

**`start()` flow:**

1. **Load initial data:**
   - `getLatestCandles({ limit: 200 })` — get recent 15M candles
   - `marketApi.getKline({ symbol: pair, interval: "4h", limit: 270 })` — 4H for EMA200
   - `cycleStartUtcMs = getCycleStartUtcMs(Date.now())`
   - **Filter to current cycle candles only** (asia window + main cycle of today):
     ```typescript
     const windowStart = cycleStartUtcMs - 8 * 3600 * 1000;
     const todayCandles = loaded15m.filter(c => c.timeUtcMs >= windowStart);
     ```
   - Seed `activeState.candlesByTime` with `todayCandles`
   - PDH/PDL from prior cycle's candles in loaded set

2. **Subscribe:** `this.unsubscribe = await exchangeAdapter.subscribeToCandles({ onCandles: this.handleCandles, onError: this.handleError })`

**`handleCandles` (private):**

```typescript
private handleCandles(candles: readonly ExchangeCandle[]): void {
  this.reconnectCount = 0;  // reset on successful candle receipt

  // 1. Filter to CLOSED candles only
  const closed = candles.filter(c => c.timeUtcMs + 15 * 60 * 1000 <= Date.now());

  // 2. Add to active state (dedup by timeUtcMs)
  closed.forEach(c => this.activeState.candlesByTime.set(c.timeUtcMs, c));

  // 3. Also feed to pending state if it exists
  if (this.pendingState !== null) {
    closed.forEach(c => this.pendingState!.candlesByTime.set(c.timeUtcMs, c));
    this.checkPendingLifecycle();
  }

  // 4. Check rollover
  const nextCycleStart = this.activeState.cycleStartUtcMs + 24 * 3600 * 1000;
  const hasOverflow = closed.some(c => c.timeUtcMs >= nextCycleStart);
  if (hasOverflow) {
    this.rollover();
  }

  // 5. Incremental analysis on active state
  this.runIncrementalAnalysis();
}
```

**`rollover()` (private):**
```typescript
private async rollover(): Promise<void> {
  // Check if old lifecycle is still in progress
  const oldSorted = this.getSortedCandles(this.activeState);
  const analyzer = new BehaviorAnalyzer();
  // Quick check: run analyze and see if we have a confirmed decision with
  // lifecycle window that extends past the boundary
  const tempRow = analyzer.analyze(this.buildInput(this.activeState));

  if (tempRow.lifecycleCrossedDayBoundary === "YES") {
    // Move to pending — lifecycle still needs overflow candles
    if (this.pendingState !== null) {
      // Another pending was already there — finalize it first (edge case)
      await this.finalizeLifecycle(this.pendingState);
    }
    this.pendingState = this.activeState;
  } else {
    // Lifecycle complete — finalize normally
    await this.finalizeLifecycle(this.activeState);
  }

  // Start fresh active state
  const newCycleStart = this.activeState.cycleStartUtcMs + 24 * 3600 * 1000;
  const new4h = await this.marketApi.getKline({ symbol: this.options.pair, interval: "4h", limit: 270 });
  const completedCandles = this.getSortedCandles(this.activeState);
  const newPdh = Math.max(...completedCandles.map(c => c.high));
  const newPdl = Math.min(...completedCandles.map(c => c.low));
  this.activeState = {
    cycleStartUtcMs: newCycleStart,
    candlesByTime: new Map(),
    candles4h: new4h,
    pdh: newPdh,
    pdl: newPdl,
    uid: this.activeState.uid + 1,
    decisionAlertSent: false,
    outcomeAlertSent: false,
  };
}
```

**`checkPendingLifecycle()` (private):**
After feeding new candles to `pendingState`, run `analyzer.analyze(buildInput(pendingState))`.
If `lifecycleCrossedDayBoundary === "NO"` now (all lifecycle candles present):
→ `finalizeLifecycle(pendingState)` → `pendingState = null`

**`finalizeLifecycle(state)` (private):**
1. Run `BehaviorAnalyzer.analyze(buildInput(state))` → `row`
2. `sheetsReporter.appendRow(row)` (catch + log on failure)
3. Send Telegram daily summary
4. `logger.info(...)` row summary

**`buildInput(state): DailyCycleInput` (private):**
```typescript
const sorted = this.getSortedCandles(state);
return {
  cycleStartUtcMs: state.cycleStartUtcMs,
  allCandles15m: sorted,
  candles4h: state.candles4h,
  pdh: state.pdh, pdl: state.pdl,
  uid: state.uid,
  writeDate: toDateString(Date.now()),
};
```

**`getSortedCandles(state): readonly Candle[]` (private):**
```typescript
return [...state.candlesByTime.values()].sort((a, b) => a.timeUtcMs - b.timeUtcMs);
```

**`runIncrementalAnalysis()` (private):**
Run `analyzeInteract` + `analyzeDecision` on the current active state. If decision confirmed and alert not sent:
- Send Telegram decision alert → `decisionAlertSent = true`
If decision confirmed, run `analyzeOutcome`. If outcome begin confirmed and alert not sent:
- Send Telegram outcome alert → `outcomeAlertSent = true`

**`handleError()` (private):**
Log error, wait 5s, call `start()` again. Increment `reconnectCount`.
If `reconnectCount >= 3`: send Telegram CRITICAL alert once. Keep retrying every 30s indefinitely.

**`stop()` (private):**
```typescript
async stop(): Promise<void> {
  this.unsubscribe?.();
  await this.exchangeAdapter.disconnect();
  this.logger.info("BehaviorBot stopped");
}
```

Export: `BehaviorBot`, `BehaviorBotOptions`

---

## Prompt 11 of 11 — CLI Integration

### Context

Modify and create files to add two new CLI commands.

**Read these files:**
1. `src/cli/index.ts` — main CLI entrypoint
2. `src/cli/commands/cliTypes.ts` — `CliCommand` type
3. `src/cli/commands/cliUtils.ts` — `parseArgv` (**verify it supports colons in command names**)
4. `src/cli/commands/backtest.ts` — existing handler pattern
5. `src/behavior/scripts/runBehaviorBacktest.ts`
6. `src/behavior/bot/BehaviorBot.ts`

Standards: strict TS, no `any`, no `!`, double quotes, JSDoc.

### Task

**Part A — Verify colon support in `parseArgv`:**
Read `src/cli/commands/cliUtils.ts`. If `parseArgv` cannot handle colons in command names, use `"behavior-backtest"` / `"behavior-live"` instead. Otherwise use the colon format throughout this prompt.

---

**Part B — `src/cli/commands/behaviorBacktest.ts`:**
```typescript
export async function runBehaviorBacktestCommand(args: ParsedCliArgs): Promise<void>
```
- Forwards `--start`, `--end`, `--dry-run`, `--verbose` to the backtest script
- Imports and calls `main()` from `src/behavior/scripts/runBehaviorBacktest.ts`

---

**Part C — `src/cli/commands/behaviorLive.ts`:**
```typescript
export async function runBehaviorLiveCommand(args: ParsedCliArgs): Promise<void>
```

Flow:
1. Read `--config` → load bot config JSON (for Bitunix credentials)
2. Build `BitunixAdapter` + `BitunixMarketApi` from config
3. `telegramAlerter = TELEGRAM_BOT_TOKEN ? TelegramAlerter.fromEnv() : null`
4. `sheetsReporter = BehaviorSheetsReporter.fromEnv()`
5. `startUid = parseInt(process.env.BEHAVIOR_START_UID ?? "1", 10)`
6. Fetch initial PDH/PDL:
   ```typescript
   const klines = await marketApi.getKline({ symbol: "BTCUSDT", interval: "1d", limit: 2 });
   const prevCandle = klines[klines.length - 2];
   // prevCandle is the most recently CLOSED 1D candle (yesterday)
   const pdh = prevCandle?.high ?? 0;
   const pdl = prevCandle?.low  ?? 0;
   ```
7. Build and start `BehaviorBot`
8. Graceful shutdown:
   ```typescript
   const shutdown = (): void => {
     bot.stop().catch(console.error).finally(() => process.exit(0));
   };
   process.on("SIGINT",  shutdown);
   process.on("SIGTERM", shutdown);   // ← BOTH signals
   ```

---

**Part D — Update `src/cli/index.ts`:**
1. Add `"behavior:backtest"` and `"behavior:live"` to `supportedCommands`
2. Add switch cases + imports
3. Update `printHelp()`:
   ```
   behavior:backtest   Run S2 behavior backtest (Jan 1 2026 → today)
   behavior:live       Start S2 behavior live bot (Bitunix real-time)
   ```

---

**Part E — Update `src/cli/commands/cliTypes.ts`:**
Add `"behavior:backtest"` and `"behavior:live"` to the `CliCommand` union type.

---

**Part F — Update `package.json`:**
```json
"behavior:backtest": "npx tsx src/behavior/scripts/runBehaviorBacktest.ts",
"behavior:live": "npm run bot -- behavior:live"
```

---

## Implementation Checklist

### 1. Typecheck
```powershell
npm run typecheck   # Must pass with 0 errors
```

### 2. Dry-run Backtest
```powershell
npm run behavior:backtest -- --dry-run --verbose
# Each line should print: [dd/mm/yyyy] LEVEL BEHAVIOR → DECISION QUALITY [CROSSED if YES]
# No errors. No sheet writes.
```

### 3. Full Backtest
```powershell
npm run behavior:backtest -- --verbose
# Verify "S2-BO-BEHAVIOR-BTC" tab appears in Google Sheet
# Verify row 1 is frozen (header)
# Verify 50 columns present (last column = UID Link)
# Verify column AN = "Lifecycle Crossed Day Boundary" present
# Verify column AU = "Month" is populated (not blank)
```

### 4. DST Verification
Spot-check session labels:
- Jan 2026 candle at 22:30 MYT → `US_H1` (WINTER)
- Jul 2026 candle at 22:30 MYT → `US_H1` (SUMMER, started 21:30)
- Mar 15 2026 candle at 21:30 MYT → `US_H1` (TRANSITION, US on EDT)
- Any candle at 06:55 MYT → `MKT_RESET` (valid, no session gate)

### 5. Lifecycle Boundary Check
Verify a row where First Interaction was in the Asia window or MKT_RESET:
- `firstInteractionSession` = `"MKT_RESET"` or `"ASIA_PRE"` etc. (not rejected)
- If the lifecycle C1-C8 extended past 08:00 MYT: `lifecycleCrossedDayBoundary = "YES"`

### 6. Field Spot-Check
Compare rows from `Copy of 3.0_Backtest_Darren_TradingJournal - S2-BO-BEHAVIOR-BTC.csv`:
- 02/01/2026: PDH, TOUCH_REJECT, ACCEPTANCE → ACP_FAIL_INV → REJECTION, REJ_SUCC_IMP, MEAN-REVERSION, MS_HEALTHY
- 04/01/2026: PDH, BREAK_HOLD, ACCEPTANCE → ACP_SUCC → ACP_SUCC_IMP, CONTINUATION, MS_STRONG
- Check `month` column = "January" for Jan rows (not blank)

### 7. Live Bot (Paper Mode)
```powershell
npm run bot -- behavior:live --config configs/bot.example.json --verbose
# Verify Telegram alert on next 15M candle close at/beyond PDH or PDL
# Press Ctrl+C → verify "BehaviorBot stopped" in log
# Send SIGTERM → verify same graceful shutdown
```
