# Dashboard Specification

**Date:** 2026-04-07
**Status:** Planning
**Related:** [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md), [Schema Design v3](./2026-04-07-schema-design-v3.md), [Phase Plan v3](./2026-04-07-phase-plan-v3.md)

---

## Overview

The dashboard is a Next.js application deployed on Vercel (free tier). It connects directly to Supabase for all data — there is no backend API layer. It serves two users:

- **Stanley (coder):** Monitors bot health, reviews errors, manages infrastructure concerns.
- **Darren (strategist):** Manages configs and strategy params, reviews trades, iterates on behavior analysis rules, promotes environments to live trading.

The dashboard replaces Google Sheets (behavior), Supabase Studio (ad-hoc queries), and most Telegram interactions (status checks) as the primary management interface.

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js (App Router) | Server components for Supabase queries, Vercel zero-config deploy |
| Auth | Supabase Auth | Email/password, session management, RLS integration |
| Data | `@supabase/supabase-js` + Supabase Realtime | Direct client, live updates without polling |
| Charts | TradingView Lightweight Charts | Open source, financial chart rendering, trade markers |
| UI Components | shadcn/ui (or similar) | Clean, accessible, composable. Not a heavy framework. |
| Forms | React Hook Form + Zod | Validation aligned with server-side Zod schemas |
| Styling | Tailwind CSS | Comes with Next.js scaffold, works with shadcn |

---

## Deployment

- **Hosting:** Vercel free tier
- **Repo location:** `dashboard/` folder in the `dstb-server` monorepo
- **Build:** `next build` in `dashboard/`
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Auth:** Supabase anon key for client-side, server components use service role only if needed (via server-side env var, never exposed to client)

---

## Page Structure

### Authentication

- `/login` — Email/password login form
- Session persisted via Supabase auth cookies
- Redirect to `/` on success, `/login` on expired session
- Two accounts: Stanley and Darren (created in Supabase dashboard)

### Navigation

```
/ (Home — Bot Grid)
/config/:id (Config Editor)
/config/new (New Config)
/trades (Trade Log)
/trades/:id (Trade Detail + Chart)
/analytics (P&L Analytics)
/behavior (Behavior Results)
/behavior/analyzers (Analyzer Editor)
/behavior/analyzers/:id (Analyzer Detail)
/behavior/rulesets (Ruleset Builder)
/behavior/rulesets/:id (Ruleset Detail)
/behavior/rulesets/compare (Ruleset Comparison)
/behavior/environments (Environment Pipeline)
/logs (Bot Logs)
```

---

## Page Specifications

### 1. Home — Bot Grid (`/`)

**Phase:** 2

The landing page. At-a-glance view of all bots.

**Layout:** Grid of cards or a table. Each bot shows:

| Field | Source | Notes |
|-------|--------|-------|
| Name | `configs.name` | e.g. "ETH ORB-ATR v3" |
| Strategy | `configs.strategy` | e.g. "orb-atr" |
| Symbol | `configs.symbol` | e.g. "ETHUSDT" |
| Status | `bots.status` | Color-coded: green=running, yellow=starting, red=errored, grey=stopped |
| Equity | `bots.equity` | Current balance |
| Today's P&L | Computed from `trades` | Sum of P&L for trades closed today |
| Last Heartbeat | `bots.last_heartbeat` | Relative time: "2m ago", with warning if stale (>5min) |
| Enable/Disable | `configs.enabled` | Toggle switch. Writes to Supabase. Bot server reacts via Realtime. |

**Interactions:**
- Click a bot card → navigates to `/config/:id`
- "New Config" button → navigates to `/config/new`
- Realtime subscription on `bots` table for live status updates
- Summary bar at top: total bots, running count, total equity, today's aggregate P&L

---

### 2. Config Editor (`/config/:id`)

**Phase:** 2

Form-based editor for strategy configuration. Darren's primary interface for managing strategy params.

**Sections:**

1. **Basic Info** (read-only or editable)
   - Name, strategy, symbol, interval, exchange

2. **Strategy Parameters** (`configs.params`)
   - Form fields for all params in the JSONB blob
   - Grouped by category: Session, Entry, ATR, Risk, Execution
   - Field types: number inputs, selects, toggles
   - Validation via Zod schema (shared with bot server)

3. **Risk Management** (`configs.risk_mgmt`)
   - Max daily loss percentage
   - Max position size percentage

4. **Actions**
   - "Save" — updates `configs` row, creates `config_versions` row
   - "Save & Restart" — saves, then toggles enabled off/on to trigger bot restart
   - Change note text field (stored in `config_versions.change_note`)

5. **Version History** (sidebar or tab)
   - List of `config_versions` ordered by version descending
   - Each entry shows: version number, timestamp, change note, who made it
   - "View" expands to show the full param diff from previous version
   - "Restore" loads that version's params into the editor

---

### 3. New Config (`/config/new`)

**Phase:** 2

Form for creating a new bot config.

- Same form layout as Config Editor
- Strategy dropdown populates default params for the selected strategy
- "Create" inserts into `configs` (with `enabled: false`)
- After creation, navigates to `/config/:id`

---

### 4. Trade Log (`/trades`)

**Phase:** 2 (table), Phase 3 (detail/charts)

Paginated, filterable table of all completed trades.

**Columns:**
| Column | Source |
|--------|--------|
| Date/Time | `trades.exit_time` |
| Bot | `configs.name` (via join) |
| Symbol | `trades.symbol` |
| Side | `trades.side` |
| Entry Price | `trades.entry_price` |
| Exit Price | `trades.exit_price` |
| P&L | `trades.pnl` |
| P&L % | `trades.pnl_pct` |
| Exit Reason | `trades.exit_reason` |

**Filters:**
- Bot (multi-select)
- Symbol
- Date range (date picker)
- Side (LONG/SHORT/all)
- Win/Loss (pnl > 0 / pnl <= 0)
- Exit reason

**Interactions:**
- Click a row → navigates to `/trades/:id`
- Export to CSV (optional)

---

### 5. Trade Detail (`/trades/:id`)

**Phase:** 3

Full context view for a single trade. Answers "what happened and why?"

**Layout:**

1. **Chart** (main area)
   - TradingView Lightweight Charts
   - Candlestick chart from `trade_candles` data
   - Entry marker (green arrow up for long, red arrow down for short)
   - Exit marker (opposite color)
   - Horizontal lines for stop loss and take profit levels
   - Timeframe tabs: 15m, 1h, 4h (based on available `trade_candles` rows)

2. **Trade Info** (sidebar)
   - Side, entry price, exit price, quantity
   - P&L (absolute and percentage)
   - Stop loss, take profit
   - Entry time, exit time, duration
   - Exit reason
   - Config name and version at time of trade

3. **Config Snapshot** (expandable)
   - `trades.config_snapshot` rendered as a formatted JSON tree or key-value list
   - Shows exactly what strategy params were active when this trade was taken

---

### 6. P&L Analytics (`/analytics`)

**Phase:** 3

Performance dashboard with charts and statistics.

**Charts:**
1. **Equity Curve** — line chart per bot (toggle individual bots) + aggregate line
2. **P&L Bar Chart** — daily/weekly/monthly P&L bars, grouped by bot or aggregate
3. **Drawdown Chart** — running max drawdown per bot
4. **Win Rate Over Time** — rolling win rate (e.g. last 20 trades)

**Stats Cards:**
| Stat | Description |
|------|-------------|
| Total Trades | Count of all trades |
| Win Rate | % of trades with positive P&L |
| Avg P&L | Mean P&L across all trades |
| Avg R-Multiple | Mean (P&L / risk per trade) |
| Profit Factor | Gross profit / gross loss |
| Sharpe Ratio | Annualized risk-adjusted return |
| Max Drawdown | Largest peak-to-trough equity decline |
| Avg Hold Time | Mean duration of trades |

**Filters:**
- Bot (multi-select)
- Strategy
- Date range
- Symbol

---

### 7. Strategy Comparison (`/analytics` sub-view or separate page)

**Phase:** 3

Side-by-side performance comparison of different configs or strategies.

**Layout:** Table with one row per config:
| Config Name | Trades | Win Rate | PF | Avg P&L | Max DD | Sharpe |
|-------------|--------|----------|------|---------|--------|--------|

Filterable by date range. Sortable by any column.

---

### 8. Behavior Results (`/behavior`)

**Phase:** 4

Table view of behavior analysis results.

**Layout:**
- Row per cycle date
- Columns dynamically generated from the active ruleset's analyzers
- Each cell shows the label output (e.g. "ATT_BGN_EARLY", "DEC_ACC")
- Color-coded by label category (configurable)

**Filters:**
- Date range
- Symbol
- Specific label values (e.g. "show only ATT_BGN_EARLY")
- Ruleset selector (compare different rulesets)

**Interactions:**
- Click a row → shows candle chart for that cycle with reference levels drawn

---

### 9. Analyzer Editor (`/behavior/analyzers`)

**Phase:** 5

Management interface for LLM-generated analyzer modules.

**List View:**
| Column | Description |
|--------|-------------|
| Name | Analyzer name |
| Slug | Unique identifier |
| Version | Current version number |
| Tested | Whether test run passed |
| Updated | Last update timestamp |

**Detail View (`/behavior/analyzers/:id`):**

1. **Description** — Darren's natural language spec (what he gave to the LLM)
2. **Code Editor** — Syntax-highlighted JavaScript, editable
3. **Parameters** — Table of `param_defaults` with types and descriptions
4. **Prompt Template** — Read-only display of the LLM prompt template for easy access
5. **Actions:**
   - "Test Run" — select a raw cycle date → execute → show label + details
   - "Save" — stores new version
   - "Clone" — create a copy for experimentation

---

### 10. Ruleset Builder (`/behavior/rulesets`)

**Phase:** 5

**List View:**
| Column | Description |
|--------|-------------|
| Name | Ruleset name |
| Analyzers | Count of active analyzers |
| Active | Whether this is the live ruleset |
| Created | Timestamp |

**Detail View (`/behavior/rulesets/:id`):**

1. **Analyzer Selection** — Toggle which analyzers are included
2. **Parameter Overrides** — Per-analyzer form (auto-generated from `param_schema`)
3. **Notes** — Free text for hypothesis documentation
4. **Actions:**
   - "Run Analysis" — execute this ruleset against all historical raw cycles
   - Progress bar during execution
   - "Set as Active" — makes this the live BehaviorBot's active ruleset

---

### 11. Ruleset Comparison (`/behavior/rulesets/compare`)

**Phase:** 5

**Layout:**
- Select two rulesets from dropdowns
- Side-by-side results table: same dates, columns from each ruleset
- Highlight cells where labels differ
- Summary stats: agreement rate, per-label distribution comparison

---

### 12. Environment Pipeline (`/behavior/environments`)

**Phase:** 6

Kanban-style or table view of environments by status.

**Columns (Kanban):**
```
Candidate → Backtesting → Paper → Live → Retired
```

Each card shows: name, ruleset, derived params summary, performance stats (if available).

**Actions:**
- "Promote" — moves to next status, creates `configs` row when reaching paper/live
- "Retire" — marks as retired, disables associated config
- "Run Backtest" — triggers backtest with derived params
- Click → detail view with full stats and linked trades

---

### 13. Bot Logs (`/logs`)

**Phase:** 2 (basic), enhanced over time

**Layout:**
- Filterable log stream from `bot_logs` table
- Filters: bot, level (INFO/WARN/ERROR/CRITICAL), event type, date range
- Auto-refresh via Supabase Realtime
- Color-coded by level
- Click a log entry → expand to see full metadata JSON

---

## Supabase Realtime Usage

| Page | Subscription | Purpose |
|------|-------------|---------|
| Bot Grid | `bots` table (status, equity, heartbeat changes) | Live status indicators |
| Bot Grid | `trades` table (new inserts) | Live P&L updates |
| Bot Logs | `bot_logs` table (new inserts) | Live log streaming |
| Behavior Results | `behavior_results` table (new inserts during analysis run) | Progress during re-analysis |

---

## Responsive Design

- **Primary target:** Desktop (1920x1080 and up) — this is a workstation tool
- **Secondary:** Tablet (iPad) for quick checks
- **Mobile:** Not a priority, but login + bot grid should be usable on phone for quick status checks
- Charts and complex tables are desktop-only experiences

---

## Auth and Permissions

Both Stanley and Darren have full access to all dashboard features. No role-based permission system needed initially. Supabase RLS ensures:

- Dashboard users (anon key + auth session) can read/write most tables
- `configs.credentials_ref` column is hidden from dashboard queries (use a Postgres view)
- Service role key is never exposed to the dashboard

If more users are added later, consider RLS policies per user role.

---

## See Also

- [Architecture Plan v3](./2026-04-07-architecture-plan-v3.md)
- [Schema Design v3](./2026-04-07-schema-design-v3.md)
- [Phase Rollout Plan](./2026-04-07-phase-plan-v3.md)
- [Behavior System Design](./2026-04-07-behavior-system-design.md)
