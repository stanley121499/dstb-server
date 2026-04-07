# Behavior System Design — Sandboxed Analyzer Architecture

**Date:** 2026-04-07
**Status:** Planning
**Related:** [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md), [Schema Design v3](./2026-04-07-schema-design-v3.md), [Phase Plan v3](./2026-04-07-phase-plan-v3.md)

---

## Problem Statement

The DSTB behavior analysis system classifies daily market behavior against reference levels (PDH, PDL, session boundaries) to identify tradeable environments. The current workflow is:

1. Darren (strategist) defines classification rules in natural language (Google Sheets)
2. Stanley (coder) hand-codes each rule as a TypeScript analyzer
3. The backtest runs with the coded rules
4. Darren reviews outputs, tweaks rules, passes new specs to Stanley
5. Stanley recodes — repeat

**Stanley is the bottleneck.** Every rule tweak requires a code change. At scale (10-20 environments), this iteration cycle is too slow.

---

## Solution: LLM-Generated Sandboxed Analyzers

Darren writes rules in natural language, feeds them to any LLM with a structured prompt template, gets JavaScript code back, and pastes it into the dashboard. The code is stored in Supabase and executed in a sandboxed VM at runtime. Stanley maintains the infrastructure and helper functions but is not required for rule iteration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  DARREN'S WORKFLOW                                       │
│                                                          │
│  1. Write rules in natural language                      │
│  2. Paste rules + prompt template → LLM (any)           │
│  3. LLM returns JavaScript code                         │
│  4. Dashboard: paste code → test run → save              │
│  5. Dashboard: build ruleset → run analysis → review     │
│  6. Dashboard: compare rulesets → promote environment    │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  SUPABASE                                                │
│                                                          │
│  behavior_analyzers    → slug, code, param_schema        │
│  behavior_rulesets     → which analyzers + param tweaks   │
│  behavior_raw_cycles   → immutable daily candle data      │
│  behavior_results      → (cycle × ruleset) → labels      │
│  behavior_environments → candidate → backtest → live      │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  BOT SERVER — Sandboxed Analyzer Runner                  │
│                                                          │
│  1. Fetch raw cycle data from behavior_raw_cycles        │
│  2. Fetch analyzer code from behavior_analyzers          │
│  3. For each cycle:                                      │
│     a. Create isolated-vm sandbox                        │
│     b. Inject: candle data, reference levels, helpers    │
│     c. Execute each analyzer function                    │
│     d. Collect labels and details                        │
│  4. Write results to behavior_results                    │
└─────────────────────────────────────────────────────────┘
```

---

## Analyzer Function Contract

Every analyzer function must follow this contract. The LLM prompt template enforces it.

### Input

The function receives a single object `input` with:

```javascript
input = {
  // Multi-timeframe candle arrays for this daily cycle
  candles: {
    "15m": [{ t: 1712448000000, o: 3245.5, h: 3260.0, l: 3240.1, c: 3258.3, v: 1200.5 }, ...],
    "4h":  [{ t: 1712448000000, o: 3220.0, h: 3265.0, l: 3218.5, c: 3260.0, v: 15000 }, ...],
    "1d":  [{ t: 1712361600000, o: 3180.0, h: 3250.0, l: 3175.0, c: 3245.5, v: 85000 }, ...]
  },

  // Pre-computed reference levels for this cycle
  referenceLevels: {
    pdh: 3250.0,          // previous day high
    pdl: 3175.0,          // previous day low
    sessionOpen: 3220.0,  // session open price
    // ... additional levels as needed
  },

  // User-configurable parameters (from ruleset overrides or defaults)
  params: {
    observeCandles: 2,
    cycleStartHour: 8,
    cycleTimezone: "Asia/Singapore"
    // ... analyzer-specific params
  },

  // Utility functions provided by the platform
  helpers: {
    // Returns the position of a candle's close relative to a price level
    getCandlePosition: function(candle, level) {},  // → "ABOVE" | "BELOW" | "INSIDE"

    // Finds the first candle whose high/low crosses a level
    findFirstInteraction: function(candles, level) {},  // → { index, candle } | null

    // Returns candles within a time window
    getCandlesInWindow: function(candles, startMs, endMs) {},  // → Candle[]

    // Calculates if candle has a wick touching a level
    hasWickTouch: function(candle, level, thresholdBps) {},  // → boolean

    // More helpers added over time as needed
  }
};
```

### Output

The function must return:

```javascript
{
  label: "ATT_BGN_EARLY",   // single classification label (string)
  details: {                  // debug/audit info shown in dashboard
    decisionLevel: "PDH",
    firstInteractionTime: "11:00:00",
    candle1Position: "ABOVE",
    candle2Position: "ABOVE",
    rule: "Candle1 + Candle2 same directional intent"
  }
}
```

### Error Handling

- If the function throws, the runner catches the error and records it in `behavior_results.details` as `{ error: "message" }` with label `"ERROR"`.
- If the function exceeds the CPU time limit (5 seconds default), it is killed and recorded as `{ error: "timeout" }`.
- If the function returns an invalid shape, it is recorded as `{ error: "invalid_output", raw: ... }`.

---

## Sandbox Implementation

### Technology: `isolated-vm`

[isolated-vm](https://github.com/nicolo-ribaudo/isolated-vm) provides V8 isolates — the same JavaScript engine as Node.js, but in a completely separate memory and execution context.

**Security guarantees:**
- No access to Node.js APIs (fs, net, process, etc.)
- No access to the bot server's memory or variables
- CPU time limits prevent infinite loops
- Memory limits prevent OOM attacks
- Cannot make network calls
- Cannot access the filesystem

**What is available inside the sandbox:**
- Standard JavaScript (ES2020+): `Math`, `Date`, `JSON`, `Array`, `Object`, `Map`, `Set`, etc.
- The `input` object passed explicitly
- The helper functions injected by the runner

### Runner Pseudocode

```typescript
import ivm from "isolated-vm";

async function runAnalyzer(
  analyzerCode: string,
  cycleData: RawCycleData,
  params: Record<string, unknown>,
  helpers: HelperFunctions
): Promise<AnalyzerOutput> {
  const isolate = new ivm.Isolate({ memoryLimit: 32 });
  const context = await isolate.createContext();

  // Inject the input object
  const inputRef = new ivm.ExternalCopy({
    candles: cycleData.candles,
    referenceLevels: cycleData.referenceLevels,
    params,
    helpers: null // helpers injected separately as callable references
  }).copyInto();

  await context.global.set("__input", inputRef);

  // Inject helper functions as callable references
  for (const [name, fn] of Object.entries(helpers)) {
    await context.global.set(
      `__helper_${name}`,
      new ivm.Callback(fn)
    );
  }

  // Build the execution wrapper
  const wrapper = `
    const input = __input;
    input.helpers = {
      getCandlePosition: __helper_getCandlePosition,
      findFirstInteraction: __helper_findFirstInteraction,
      getCandlesInWindow: __helper_getCandlesInWindow,
      hasWickTouch: __helper_hasWickTouch,
    };
    ${analyzerCode}
    JSON.stringify(analyze(input));
  `;

  // Execute with timeout
  const resultJson = await context.eval(wrapper, { timeout: 5000 });
  const result = JSON.parse(resultJson);

  // Validate output shape
  if (typeof result.label !== "string") {
    throw new Error("Analyzer must return { label: string, details: object }");
  }

  isolate.dispose();
  return result;
}
```

---

## Helper Function Library

These are **platform-provided** utility functions maintained by Stanley. They are stable, tested, and available to all analyzer code. New helpers are added as Darren's rules require new capabilities.

### Core Helpers (Phase 4)

| Helper | Signature | Description |
|--------|-----------|-------------|
| `getCandlePosition` | `(candle, level) → "ABOVE" \| "BELOW" \| "INSIDE"` | Compares candle close to a price level. `INSIDE` when close is within a threshold of the level. |
| `findFirstInteraction` | `(candles, level) → { index, candle } \| null` | Finds the first candle whose high/low range includes the level (wick touch or break). |
| `getCandlesInWindow` | `(candles, startMs, endMs) → Candle[]` | Filters candles to a time window. |
| `hasWickTouch` | `(candle, level, thresholdBps) → boolean` | Checks if a candle's wick (not body) touches a level within a tolerance. |

### Extended Helpers (added as needed)

| Helper | Signature | Description |
|--------|-----------|-------------|
| `getBodyDirection` | `(candle) → "bullish" \| "bearish" \| "doji"` | Classifies candle body direction. |
| `getCandleRange` | `(candle) → number` | Returns high - low. |
| `getBodyPct` | `(candle) → number` | Body size as percentage of total range. |
| `findLevelBreak` | `(candles, level, direction) → { index, candle } \| null` | Finds first candle that closes beyond a level in a given direction. |
| `getSessionVWAP` | `(candles) → number` | Volume-weighted average price across candles. |
| `countConsecutive` | `(candles, level, position) → number` | Counts consecutive candles in the same position relative to a level. |

Helpers are added incrementally. When Darren's rules need a capability that does not exist, Stanley implements it once and it is available to all analyzers.

---

## LLM Prompt Template

This is the prompt Darren prepends to his rule specifications when asking any LLM to generate code.

```
You are generating a behavior analyzer function for a crypto trading analysis system.

## Function Contract

Write a single JavaScript function called `analyze` that receives one argument `input`.

### input object structure:
- input.candles["15m"] — array of { t: timestamp_ms, o: open, h: high, l: low, c: close, v: volume }
- input.candles["4h"] — array of 4-hour candles (same shape)
- input.candles["1d"] — array of daily candles (same shape)
- input.referenceLevels.pdh — previous day high (number)
- input.referenceLevels.pdl — previous day low (number)
- input.referenceLevels.sessionOpen — session open price (number)
- input.params — user-configurable parameters (object, read with fallback defaults)
- input.helpers.getCandlePosition(candle, level) — returns "ABOVE" | "BELOW" | "INSIDE"
- input.helpers.findFirstInteraction(candles, level) — returns { index, candle } or null
- input.helpers.getCandlesInWindow(candles, startMs, endMs) — returns filtered candle array
- input.helpers.hasWickTouch(candle, level, thresholdBps) — returns boolean

### Return value:
The function MUST return an object with:
- label (string): exactly one classification label
- details (object): supporting evidence and intermediate values for debugging

### Configurable Parameters:
Define any thresholds or settings as keys on input.params with sensible defaults.
Read them at the top of your function with fallbacks:
  const observeCandles = input.params.observeCandles || 2;

### Rules:
- Use only standard JavaScript (ES2020). No imports, no require, no fetch.
- Use the provided helper functions for candle analysis.
- Handle edge cases: return a "N/A" or "INDETERMINATE" label if data is insufficient.
- Include meaningful keys in the details object so the result can be audited.

## Rules to implement:

[PASTE YOUR RULES SPECIFICATION HERE]
```

This template is stored in the repo at a known path (e.g. `dstb-docs/raw/behavior-analyzer-prompt-template.md`) and displayed in the dashboard's Analyzer Editor for easy access.

---

## Workflow Examples

### Example 1: Creating the "Attempt Begin" Analyzer

**Step 1 — Darren writes rules:**
```
WHAT: Classifies how the market started its first decision attempt after interacting with PDH/PDL
WHEN: From the first 15M candle that interacts with PDH/PDL → until confirmed or cycle ends
HOW: After first PDH/PDL interaction, observe Candle 1 & Candle 2 only.

Labels:
- ATT_BGN_EARLY: Candle 1 & 2 show same directional intent, no contradiction
- ATT_BGN_DEFAULT: Candle 1 & 2 disagree or show mixed behavior
- ATT_IND: Price never interacts with PDH or PDL during the cycle
```

**Step 2 — Darren pastes rules into LLM with prompt template → gets code:**
```javascript
function analyze(input) {
  const candles15m = input.candles["15m"];
  const pdh = input.referenceLevels.pdh;
  const pdl = input.referenceLevels.pdl;
  const observeCandles = input.params.observeCandles || 2;

  // Try PDH first, then PDL
  const pdhInteraction = input.helpers.findFirstInteraction(candles15m, pdh);
  const pdlInteraction = input.helpers.findFirstInteraction(candles15m, pdl);

  // Pick whichever interaction came first
  let interaction = null;
  let decisionLevel = "PD_NONE";
  if (pdhInteraction && pdlInteraction) {
    if (pdhInteraction.index <= pdlInteraction.index) {
      interaction = pdhInteraction;
      decisionLevel = "PDH";
    } else {
      interaction = pdlInteraction;
      decisionLevel = "PDL";
    }
  } else if (pdhInteraction) {
    interaction = pdhInteraction;
    decisionLevel = "PDH";
  } else if (pdlInteraction) {
    interaction = pdlInteraction;
    decisionLevel = "PDL";
  }

  // No interaction at all
  if (!interaction) {
    return {
      label: "ATT_IND",
      details: { decisionLevel: "PD_NONE", reason: "No PDH/PDL interaction during cycle" }
    };
  }

  const level = decisionLevel === "PDH" ? pdh : pdl;
  const startIdx = interaction.index;

  // Need at least 2 candles after interaction
  if (startIdx + observeCandles > candles15m.length) {
    return {
      label: "ATT_BGN_DEFAULT",
      details: { decisionLevel, reason: "Insufficient candles after interaction", startIdx }
    };
  }

  const candle1 = candles15m[startIdx];
  const candle2 = candles15m[startIdx + 1];
  const pos1 = input.helpers.getCandlePosition(candle1, level);
  const pos2 = input.helpers.getCandlePosition(candle2, level);

  // Same directional intent = both on same side (both ABOVE or both BELOW)
  const sameDirection = (pos1 === pos2) && (pos1 === "ABOVE" || pos1 === "BELOW");

  if (sameDirection) {
    return {
      label: "ATT_BGN_EARLY",
      details: { decisionLevel, candle1Position: pos1, candle2Position: pos2, rule: "Same directional intent" }
    };
  }

  return {
    label: "ATT_BGN_DEFAULT",
    details: { decisionLevel, candle1Position: pos1, candle2Position: pos2, rule: "Mixed or contradicting behavior" }
  };
}
```

**Step 3 — Darren pastes code into dashboard → test runs against 2026-04-01 cycle:**
```
Result: { label: "ATT_BGN_EARLY", details: { decisionLevel: "PDH", candle1Position: "ABOVE", ... } }
```

**Step 4 — Darren saves. Analyzer is registered as `attempt_begin` v1.**

**Step 5 — Later, Darren wants to observe 3 candles instead of 2. In the ruleset builder, changes `observeCandles` param to 3. Re-runs analysis. No code change needed.**

**Step 6 — Later, Darren wants to add a new label `ATT_BGN_LATE` for when candles 1-2 disagree but 3-4 agree. Writes new rules → LLM generates updated code → paste → test → save as v2.**

---

### Example 2: Tweaking Parameters Without Code Changes

Darren has a "decision_type" analyzer with these configurable params:

```json
{
  "confirmationCandles": 3,
  "minWickPct": 0.3,
  "levelThresholdBps": 5
}
```

In the dashboard Ruleset Builder, Darren:
1. Opens ruleset "v3 — relaxed entry"
2. Finds the "decision_type" analyzer
3. Changes `confirmationCandles` from 3 to 2
4. Changes `levelThresholdBps` from 5 to 10
5. Clicks "Run Analysis"
6. Compares results with the previous ruleset — sees that relaxing these thresholds identifies 15% more trades but win rate drops 3%
7. Decides to keep the change and test further

No LLM, no code, no Stanley required.

---

## Behavior Data Lifecycle

```
┌─────────────────────────────────────────────────────┐
│  DAILY: BehaviorBot collects raw market data         │
│  → behavior_raw_cycles (immutable)                   │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  ON DEMAND: Run analysis with a ruleset              │
│  → behavior_results (one row per cycle × ruleset)    │
│  → dashboard shows labeled results table             │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  EVALUATION: Compare rulesets, identify patterns     │
│  → behavior_environments (candidate)                 │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  PIPELINE: backtest → paper → live                   │
│  → configs table (enabled when promoted)             │
│  → trades table (tracks real performance)            │
└─────────────────────────────────────────────────────┘
```

---

## Current BehaviorBot Code Mapping

The existing `src/behavior/` code maps to the new architecture:

| Current | New (Phase 4+) |
|---------|---------------|
| `BehaviorBot.ts` — daily cycle runner | Refactored to write `behavior_raw_cycles` to Supabase |
| `analyzer/BehaviorAnalyzer.ts` — hardcoded rules | Replaced by sandboxed analyzer runner |
| `analyzer/decisionAnalyzer.ts` | Becomes an LLM-generated analyzer in `behavior_analyzers` table |
| `analyzer/htfContextAnalyzer.ts` | Becomes an LLM-generated analyzer |
| `analyzer/interactAnalyzer.ts` | Becomes an LLM-generated analyzer |
| `analyzer/outcomeAnalyzer.ts` | Becomes an LLM-generated analyzer |
| `reporter/BehaviorSheetsReporter.ts` | Replaced by Supabase writes + dashboard |
| `reporter/BehaviorDashboardReporter.ts` | Replaced by dashboard reading `behavior_results` |
| `types.ts` — BehaviorRow, Candle, etc. | Mapped to Supabase row types |
| Google Sheets output | Replaced by dashboard behavior results page |

**Migration strategy:** Keep existing behavior code working during Phase 1-3. Phase 4 refactors the data layer (raw cycles to Supabase). Phase 5 replaces hardcoded analyzers with sandboxed ones. The existing analyzer TypeScript files serve as reference implementations for the initial LLM-generated versions.

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Malicious code in analyzer | `isolated-vm` sandbox — no filesystem, no network, no process access |
| Infinite loop | CPU time limit (5 seconds per analyzer per cycle) |
| Memory exhaustion | Memory limit per isolate (32 MB default) |
| Data exfiltration | Sandbox cannot make network calls. Output is only the return value. |
| Code injection via params | Params are passed as data (ExternalCopy), not interpolated into code strings |

**Trust model:** Both users (Stanley and Darren) are trusted team members. The sandbox protects against accidental bugs (infinite loops, bad logic), not adversarial attacks. The primary risk is buggy code producing incorrect analysis results, mitigated by the "test run" workflow.

---

## See Also

- [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md)
- [Schema Design v3](./2026-04-07-schema-design-v3.md)
- [Phase Rollout Plan](./2026-04-07-phase-plan-v3.md)
- [Dashboard Specification](./2026-04-07-dashboard-spec.md)
