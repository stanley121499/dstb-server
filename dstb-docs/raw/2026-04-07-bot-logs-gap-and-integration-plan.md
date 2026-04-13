# `bot_logs`: documentation vs code gap + suggested integration (2026-04-07)

Immutable note for ingestion. Explains why the table stays empty today and where to implement writes.

## What the docs and wiki say

There is **no** document that says “skip `bot_logs`” or “defer to Phase 2.” The v3 plan **requires** structured logs in Postgres.

| Source | What it claims |
|--------|----------------|
| [Phase plan v3](./2026-04-07-phase-plan-v3.md) § Phase 1 deliverable 2 | “Structured log events write to `bot_logs`” |
| [Architecture plan v3](./2026-04-07-architecture-plan-v3.md) | Stateless server; “Logs go to `bot_logs` table”; trade flow includes writes to `bot_logs` |
| [Schema design v3](./2026-04-07-schema-design-v3.md) § `bot_logs` | Table DDL and indexes |
| [Dashboard spec](./2026-04-07-dashboard-spec.md) | Live log stream from `bot_logs` |
| [Wiki source summary](../wiki/sources/v3-supabase-schema-design.md) | Lists `bot_logs` under **operational** domain |

**Conclusion:** Empty `bot_logs` is an **implementation gap**, not a documented design choice. Phase 1 was partially delivered: migration + `SupabaseStateStore.insertBotLog()` exist, but **no call sites** and **`insertBotLog` is not on `BotStateStore`**, so the trading stack cannot use it through the persistence interface.

## Current code facts

- **`insertBotLog`** is defined only on `SupabaseStateStore` (`src/core/SupabaseStateStore.ts`). Grep shows **no callers** in `src/`.
- **`Logger`** (`src/core/Logger.ts`) writes **only to disk** (daily files); no optional backend.
- **`BotStateStore`** (`src/core/BotStateStore.ts`) has **no** `insertBotLog` method, so `TradingBot` and strategies cannot depend on logging via the store contract without an interface change.

## Suggested integration plan (ordered)

### 1. Put logging on the persistence contract (small, foundational)

- Add **`insertBotLog(args)`** to **`BotStateStore`**.
- **`SupabaseStateStore`:** keep current implementation (already inserts `bot_logs`).
- **`InMemoryBotStateStore`** (and any test doubles): **no-op** or push to an in-memory array for tests.

This keeps `TradingBot` and server code depending on **`BotStateStore`**, not `SupabaseStateStore` concretely.

### 2. High-signal, low-volume hooks in `TradingBot` (first real data)

Call the store **after** durable events (same places you already persist or change status), fire-and-forget (`void store.insertBotLog(...).catch(...)`), with **bounded `metadata` JSON** (no huge payloads).

Suggested events (align with dashboard + ops):

| Event | `level` | `event` (string id) | Notes |
|-------|---------|---------------------|--------|
| Bot started | INFO | `bot_start` | config name / symbol in metadata |
| Bot stopped | INFO | `bot_stop` | |
| Status → `error` | ERROR | `bot_error` | message + short stack id if any |
| Trade saved / position closed | INFO | `trade_closed` or `position_closed` | trade id, symbol, pnl summary |
| Exchange connect / disconnect issues | WARN | `exchange_ws` / `exchange_rest` | reuse existing log messages |

Avoid logging **every** candle iteration at INFO (table growth + Supabase cost). Prefer **WARN+** for noisy paths or sample DEBUG locally only on disk.

### 3. Optional: bridge `Logger` → `bot_logs` (second phase of same feature)

- Extend **`Logger`** with an optional **`remoteSink?: (entry) => void | Promise<void>`** set only when constructing loggers for **managed bots** with a **`BotStateStore`** and **`botId`**.
- Map **`Logger` levels** to `bot_logs.level`; put **`event`** from `context.event` when present, else a default like `log`.
- **Rate-limit** or filter (**WARN and above only** by default) so Render + hot paths do not spam Postgres.

This gives parity with “structured log events” in the phase plan without duplicating every `logger.info` manually.

### 4. Server-level events

- **`BotManager`:** log **start/stop/restart** outcomes per `config_id` / bot id (config change, Realtime resync failures).
- **`src/server/index.ts`:** optional single row on **process-level** fatal paths is usually unnecessary if `bot_id` is null — `bot_logs.bot_id` is nullable in schema; use sparingly for “server_cannot_start” style events.

### 5. Operational constraints

- **Async / non-blocking:** never await Supabase on the hot path of the strategy loop unless you accept latency; use **void + catch** or a **small bounded queue** with drop-on-backpressure for extreme load.
- **RLS:** service role already used by server; inserts from the bot process are consistent with other tables.
- **CLI / local:** same code path via `BotStateStore`; in-memory store stays quiet.

## Related files

- `src/core/BotStateStore.ts` — add method
- `src/core/SupabaseStateStore.ts` — `insertBotLog` (exists)
- `src/core/InMemoryBotStateStore.ts` — no-op
- `src/core/TradingBot.ts` — lifecycle + trade/save hooks
- `src/core/Logger.ts` — optional remote sink (later)
- `src/server/BotManager.ts` — control-plane events

---

## Status (implementation follow-up, same day)

**Implemented in code (not wiki):**

- `insertBotLog` is on **`BotStateStore`**; **`InMemoryBotStateStore`** no-ops; **`SupabaseStateStore`** unchanged behavior.
- **`TradingBot`** uses **`persistThought()`** (fire-and-forget) to record:
  - Session start/stop
  - Strategy **warmup** / `strategy_initialized`
  - **HOLD**: throttled (same reason + **≤5 min** → skip) with `strategy_hold`, `message` = strategy `reason`, metadata includes capped **`strategyStateJson`** (`getState()` JSON, max ~2k chars)
  - **ENTRY intent** (`strategy_entry_intent`) and every **block** (invalid signal, DB/exchange position, bad price/equity, sizing failure, position too large, **risk**, order failure)
  - **EXIT intent** / ignored exit / blocks / order failure / **position closed**
  - **External close** sync (`position_closed_externally`)
  - **Main-loop errors** (`bot_loop_error`)

Optional later: **`Logger` → `bot_logs`** sink; **`BotManager`** control-plane rows.
