# Phase Rollout Plan v3

**Date:** 2026-04-07
**Status:** Planning
**Related:** [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md), [Schema Design v3](./2026-04-07-schema-design-v3.md)

---

## Guiding Principles

1. **Each phase delivers standalone value.** Nothing is "infrastructure for later" — every phase improves the team's workflow immediately.
2. **Avoid the v1 mistake.** The previous React + Supabase setup was abandoned because the project locked into structure before the domain was understood. This plan builds incrementally on a working system.
3. **Two users, two roles.** Stanley (coder) and Darren (strategist). Darren's ability to self-serve is a first-class requirement, not a nice-to-have.

---

## Phase 1: Foundation — Supabase + Bot Server Migration

**Goal:** Persistent state that survives deploys. Configs in a database. Remote-queryable trade history.

**Duration estimate:** 1–2 weeks

### Deliverables

1. **Supabase project setup**
   - Create project (free tier)
   - Apply schema migrations for: `configs`, `config_versions`, `bots`, `trades`, `positions`, `orders`, `trade_candles`, `bot_logs`
   - Configure RLS policies
   - Create auth accounts for Stanley and Darren

2. **Bot server: Supabase integration**
   - Add `@supabase/supabase-js` dependency
   - Create `SupabaseStateManager` (or refactor existing `StateManager`) to read/write Supabase instead of SQLite
   - `BotManager.startAll()` reads configs from `configs` table where `enabled = true` (replaces `configs/strategies/*.json`)
   - Trades, positions, orders write to Supabase
   - On each trade, capture multi-timeframe candle context into `trade_candles`
   - Structured log events write to `bot_logs`
   - Bot heartbeat updates `bots.last_heartbeat` and `bots.equity`

3. **Config-driven control**
   - Subscribe to Supabase Realtime on `configs` table
   - React to `enabled` flag changes: start/stop bots
   - React to param changes: restart bot with new config
   - Remove `bot-stopped-state.json` mechanism

4. **Health endpoint**
   - Tiny HTTP server on `PORT` env var
   - `GET /health` returns JSON: status, uptime, bots running, bots errored, last heartbeat
   - UptimeRobot configured to ping it

5. **Deployment**
   - Deploy bot server to Render as Web Service (not Background Worker — needs PORT binding)
   - Set environment variables (Supabase URL, service role key, Bitunix keys, Telegram tokens)
   - Remove SQLite dependency (`better-sqlite3`)
   - Remove `configs/strategies/` JSON files

6. **Seed initial data**
   - Migrate existing strategy configs (e.g. `eth-live-v3.json`) into `configs` table
   - Import historical trades from SQLite if desired (optional — can start fresh)

### Value Delivered

- Darren can browse trades, bot state, and configs in **Supabase Studio** (day 1 access, no dashboard needed)
- State survives Render redeploys
- Configs managed in database, not git
- Foundation for all subsequent phases

### What Stays the Same

- Telegram alerting works as before (critical alerts)
- Core `TradingBot` engine, strategies, exchange adapters unchanged
- Backtest engine unchanged (Phase 4 touches this)

---

## Phase 2: Dashboard — Bot Management

**Goal:** Darren can see and control bots without Stanley. Visual config editing.

**Duration estimate:** 1–2 weeks

### Deliverables

1. **Next.js app scaffold**
   - Create `dashboard/` in monorepo
   - Supabase auth integration (email/password for Stanley + Darren)
   - Deploy to Vercel (free tier)

2. **Bot Grid page** (home)
   - Card/table view of all bots
   - Per bot: name, strategy, symbol, status indicator (green/yellow/red), equity, today's P&L, last heartbeat age
   - Enable/disable toggle (writes to `configs.enabled` via Supabase client)
   - Supabase Realtime subscription for live status updates

3. **Config Editor page**
   - Click a bot → form-based editor for strategy params
   - Form fields generated from param structure (or manually built for known strategies)
   - Risk management fields (maxDailyLossPct, maxPositionSizePct)
   - "Save" creates a `config_versions` row and updates `configs`
   - Version history sidebar showing past versions with change notes
   - "Create New Config" flow

4. **Trade Log page**
   - Paginated table of all trades across all bots
   - Filters: by bot, by symbol, by date range, by win/loss, by exit reason
   - Columns: bot name, symbol, side, entry/exit price, P&L, P&L%, exit reason, time
   - Click a trade → navigates to trade detail (Phase 3)

### Value Delivered

- Darren manages bots and configs himself — Stanley is no longer the bottleneck for operational tasks
- Visual overview of all running bots at a glance
- Config version history provides audit trail

---

## Phase 3: Trade Analytics + Charts

**Goal:** "Why did I lose?" visibility. Trade context with price charts.

**Duration estimate:** 2–3 weeks

### Deliverables

1. **Trade Detail page**
   - TradingView Lightweight Charts showing price action around the trade
   - Entry and exit markers on the chart
   - Stop loss and take profit levels drawn
   - Multi-timeframe tabs (15m, 1h, 4h) powered by `trade_candles` data
   - Trade metadata sidebar: config snapshot, strategy state at time of trade

2. **P&L Analytics page**
   - Equity curve per bot (line chart over time)
   - Aggregate equity curve (all bots combined)
   - Drawdown chart
   - Daily/weekly/monthly P&L bar chart
   - Stats cards: total trades, win rate, average R-multiple, profit factor, Sharpe ratio, max drawdown

3. **Strategy Comparison view**
   - Side-by-side performance of different configs/strategies
   - Same timeframe, different params → which config performs better
   - Table: config name, trades, win rate, PF, avg P&L, max DD

### Value Delivered

- Darren can click any trade and see exactly what happened in the market
- "Why did I lose" is answerable visually
- Performance analytics drive informed strategy iteration
- Strategy comparison enables data-driven config selection

---

## Phase 4: Behavior System Migration

**Goal:** Behavior analysis data moves from Google Sheets to Supabase. Dashboard shows behavior results.

**Duration estimate:** 1–2 weeks

### Deliverables

1. **Schema additions**
   - Apply migrations for: `behavior_analyzers`, `behavior_rulesets`, `behavior_raw_cycles`, `behavior_results`, `behavior_environments`

2. **BehaviorBot refactor**
   - Write raw cycle data to `behavior_raw_cycles` instead of (or alongside) Google Sheets
   - Capture all timeframes the strategy needs
   - Capture reference levels (PDH, PDL, session open, etc.)

3. **Analysis execution engine**
   - Add `isolated-vm` dependency to bot server
   - Build `SandboxedAnalyzerRunner`: fetches analyzer code from `behavior_analyzers`, executes in sandbox with candle data and helpers
   - Helper function library: `getCandlePosition`, `findFirstInteraction`, and more as needed
   - Run analysis: for each raw cycle × each analyzer in ruleset → produce `behavior_results` row

4. **Dashboard: Behavior Results page**
   - Table view of behavior results by date
   - Columns correspond to analyzer outputs (dynamic based on ruleset)
   - Filter by date range, by label value
   - Click a row → see the candle chart context for that cycle

### Value Delivered

- Behavior data is in Supabase alongside trade data (unified data layer)
- Google Sheets dependency removed for behavior reporting
- Analysis runs programmatically instead of manually inspecting sheets

---

## Phase 5: Behavior Ruleset Editor + Self-Service Analysis

**Goal:** Darren creates and tweaks behavior analyzers without Stanley. Full self-service rule iteration.

**Duration estimate:** 2–3 weeks

### Deliverables

1. **LLM prompt template**
   - Documented prompt template stored in repo and displayed in dashboard
   - Defines the analyzer function contract (inputs, outputs, helpers)
   - Includes examples of existing analyzers
   - Darren copies template + his rules → pastes into any LLM → gets JavaScript code

2. **Dashboard: Analyzer Editor**
   - List of all registered analyzers with version, tested status, description
   - "New Analyzer" flow: name, slug, description, paste code
   - Code viewer/editor (syntax highlighted, read-only or editable)
   - **"Test Run" button**: runs the analyzer against one selected raw cycle → shows output label + details
   - "Save" stores to `behavior_analyzers`, bumps version
   - "Clone" creates a copy for experimentation

3. **Dashboard: Ruleset Builder**
   - List of rulesets with name, analyzer count, is_active flag
   - "New Ruleset" / "Clone Ruleset" flow
   - Drag-and-drop or toggle which analyzers are included
   - Per-analyzer parameter overrides via auto-generated form (from `param_schema`)
   - Notes field for hypothesis documentation
   - "Run Analysis" button: triggers re-analysis of all historical raw cycles with this ruleset
   - Progress indicator during analysis run

4. **Dashboard: Ruleset Comparison**
   - Select two rulesets
   - Side-by-side results for the same dates
   - Highlight where they agree/disagree
   - Show actual market outcomes for each date
   - Summary stats: "v3 identified 80% of good entries vs v2's 65%"

### Value Delivered

- Darren can create, test, and iterate on behavior analysis rules without Stanley coding anything
- Parameter tweaks are instant (change params, re-run)
- Logic changes go through LLM (Darren writes spec → LLM generates code → paste + test + save)
- Ruleset comparison enables data-driven rule refinement
- Stanley's role shifts to: maintaining helpers, reviewing code if needed, infrastructure

---

## Phase 6: Environment Pipeline + Advanced Features

**Goal:** Full closed-loop from behavior analysis to live trading. Advanced operational features.

**Duration estimate:** 2–4 weeks

### Deliverables

1. **Environment Pipeline**
   - Dashboard page showing environments by status: candidate → backtesting → paper → live → retired
   - "Promote" action: moves an environment to the next stage
   - When promoted to "paper" or "live": auto-creates a `configs` row with the derived params
   - Performance tracking: backtest stats, paper stats, live stats in one view
   - "Retire" action: disables the config, marks environment as retired

2. **Automated backtest integration**
   - "Run Backtest" button on an environment
   - Uses existing backtest engine with the environment's derived params
   - Results written to `behavior_environments.backtest_stats`
   - Backtest trade list viewable in the trade analytics pages

3. **LLM integration in dashboard** (optional enhancement)
   - Text area: Darren types rules in natural language
   - "Generate Code" button: dashboard calls LLM API (Claude/GPT)
   - Generated code appears in editor
   - Test → save flow as before
   - Removes the copy-paste step

4. **Operational enhancements**
   - Automated alerting rules: "alert me if any bot's drawdown exceeds X% in a day"
   - Bot restart policies: auto-restart errored bots with backoff
   - Log viewer in dashboard with filtering
   - Multi-timeframe bot support (bots that consume multiple intervals)

### Value Delivered

- Complete quant workflow: observe → analyze → hypothesize → test → trade → observe
- Darren manages the full pipeline from behavior observation to live deployment
- Reduced friction for promoting promising strategies to production
- Operational maturity for running 10-20+ bots reliably

---

## Phase Summary

| Phase | Focus | Darren Impact | Est. Duration |
|-------|-------|---------------|---------------|
| **1** | Supabase + bot server migration | Sees data in Supabase Studio | 1–2 weeks |
| **2** | Dashboard: bot management + config editor | Manages bots and params himself | 1–2 weeks |
| **3** | Trade analytics + charts | Answers "why did I lose" visually | 2–3 weeks |
| **4** | Behavior system to Supabase + sandbox engine | Behavior data unified with trades | 1–2 weeks |
| **5** | Behavior ruleset editor + self-service analysis | Creates/tweaks rules via LLM, no coding needed | 2–3 weeks |
| **6** | Environment pipeline + advanced features | Full observe-to-trade closed loop | 2–4 weeks |

**Total estimated duration:** 9–16 weeks (can overlap phases where independent)

---

## Dependencies Between Phases

```
Phase 1 ──→ Phase 2 ──→ Phase 3
   │
   └──────→ Phase 4 ──→ Phase 5 ──→ Phase 6
```

- Phases 2 and 4 can run in parallel (both depend only on Phase 1)
- Phase 3 depends on Phase 2 (dashboard must exist)
- Phase 5 depends on Phase 4 (behavior data must be in Supabase)
- Phase 6 depends on Phase 5 (ruleset editor must exist)

---

## See Also

- [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md)
- [Schema Design v3](./2026-04-07-schema-design-v3.md)
- [Behavior System Design](./2026-04-07-behavior-system-design.md)
- [Dashboard Specification](./2026-04-07-dashboard-spec.md)
