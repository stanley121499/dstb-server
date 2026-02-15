# New Simplified Architecture

**Status:** 🚧 In Implementation  
**Version:** 2.0  
**Last Updated:** February 2026

## Overview

This document describes the **simplified, bulletproof architecture** for the DSTB trading bot. This is a major refactor from the original monorepo system.

## Why the Refactor?

### Problems with Original System

1. **Fragility** - Bot crashed frequently, couldn't run >3 days
2. **No Error Alerts** - Discovered issues 18 hours later
3. **Inflexible** - Hard to add new strategies (hardcoded ORB logic)
4. **Too Complex** - Frontend UI out of scope, hard to maintain
5. **Bitunix Unstable** - No proper reconnection or error handling

### New System Goals

1. ✅ **Rock Solid** - Auto-restart, reconnection, comprehensive error handling
2. ✅ **Flexible** - Plugin system for strategies
3. ✅ **Observable** - Instant alerts, Google Sheets monitoring
4. ✅ **Simple** - 90% less code, CLI-only
5. ✅ **Production Ready** - Built for 24/7 operation

## Architecture Comparison

### Old System (Deprecated)

```
Complex Monorepo:
├── apps/web/          [61 files] - React UI (REMOVED)
├── apps/api/          [67 files] - Express API
├── packages/shared/   [7 files]  - Shared types
└── supabase/          [4 migrations] - PostgreSQL

Dependencies: Supabase, React, Vite, Express, WebSocket
Lines of Code: ~15,000
Maintenance: High
Strategy Changes: Requires code changes
```

### New System (Current)

```
Simplified CLI Bot:
├── src/
│   ├── core/          # Bot engine (500 lines)
│   ├── strategies/    # Strategy plugins (200 lines each)
│   ├── exchanges/     # Exchange adapters (existing, hardened)
│   ├── monitoring/    # Alerts & reporting (300 lines)
│   ├── cli/           # CLI commands (400 lines)
│   └── utils/         # Helpers (200 lines)
├── configs/           # JSON config files
├── data/              # SQLite database
└── logs/              # Log files

Dependencies: SQLite, Luxon, Telegram Bot API, Google Sheets API
Lines of Code: ~3,000
Maintenance: Low
Strategy Changes: Edit JSON config or add plugin file
```

## Core Components

### 1. Trading Bot Engine (`src/core/TradingBot.ts`)

**Responsibilities:**
- Manage bot lifecycle (start/stop/restart)
- Fetch candles from exchange
- Call strategy plugin for signals
- Execute orders via exchange adapter
- Track positions and equity
- Persist state to SQLite

**Key Features:**
- Auto-reconnect on exchange disconnect
- State recovery on crash
- Position reconciliation on startup
- Heartbeat monitoring
- Error streak tracking

**Simplified Design:**
```typescript
class TradingBot {
  private strategy: IStrategy;
  private exchange: IExchange;
  private db: Database;
  
  async start() {
    // Load state from database
    await this.loadState();
    
    // Verify positions with exchange
    await this.reconcilePositions();
    
    // Start main loop
    while (this.isRunning) {
      try {
        const candle = await this.exchange.getLatestCandle();
        const signal = this.strategy.onCandle(candle, this.position);
        
        if (signal.type === "ENTRY") {
          await this.executeEntry(signal);
        } else if (signal.type === "EXIT") {
          await this.executeExit(signal);
        }
        
        await this.updateHeartbeat();
      } catch (error) {
        await this.handleError(error);
      }
    }
  }
}
```

### 2. Strategy Plugin System (`src/strategies/`)

**Purpose:** Allow easy creation and testing of new strategies without modifying core code.

**Interface:**
```typescript
interface IStrategy {
  name: string;
  warmupPeriod: number;  // How many candles needed to start
  
  initialize(candles: Candle[]): void;
  onCandle(candle: Candle, position: Position | null): Signal;
  onFill(position: Position): void;
  getState(): Record<string, unknown>;
}
```

**Included Strategies:**
- `orb-atr.ts` - Opening Range Breakout with ATR (migrated from old system)
- `cme-gap.ts` - CME weekend gap trading (example new strategy)

**See:** [Strategy Plugin Guide](./31-strategy-plugin-guide.md) for details.

### 3. Exchange Layer (`src/exchanges/`)

**Hardened Bitunix Adapter:**
- ✅ WebSocket auto-reconnect with exponential backoff
- ✅ Heartbeat monitoring (detect dead connections)
- ✅ REST API fallback when WebSocket fails
- ✅ Rate limiting (prevent hitting exchange limits)
- ✅ Order confirmation polling
- ✅ Retry logic with idempotency
- ✅ Circuit breaker (stop trading if exchange broken)

**Paper Trading Adapter:**
- Uses real Binance candle data
- Simulates fills with fee/slippage
- Perfect for testing strategies safely

### 4. Monitoring System (`src/monitoring/`)

**Google Sheets Reporter:**
- Updates every 5 minutes
- Shows: Equity, positions, P&L, status
- Partner (non-technical) can view on phone
- No login required

**Telegram Alerter:**
- Instant notifications (<1 min)
- Error levels: CRITICAL, WARNING, INFO
- Commands: `/status`, `/positions`, `/stop`
- Group support for team monitoring

**Email Alerter:**
- Backup for critical alerts
- Daily summary reports
- Weekly performance reports

### 5. State Management (`src/core/StateManager.ts`)

**SQLite Database:**
```sql
-- Bots table (virtual accounting)
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  initial_balance REAL NOT NULL,
  current_equity REAL NOT NULL,
  status TEXT NOT NULL,
  config JSON NOT NULL,
  created_at INTEGER NOT NULL,
  last_heartbeat INTEGER
);

-- Positions table (what bot owns on exchange)
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  entry_time INTEGER NOT NULL,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

-- Trades table (completed trades)
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl REAL NOT NULL,
  r_multiple REAL,
  entry_time INTEGER NOT NULL,
  exit_time INTEGER NOT NULL,
  exit_reason TEXT,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

-- Orders table (exchange orders)
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  client_order_id TEXT UNIQUE NOT NULL,
  exchange_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  filled_at INTEGER,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);
```

**Benefits:**
- Fast (local file)
- Reliable (ACID transactions)
- Portable (copy .db file)
- No external dependencies
- Easy to backup

### 6. CLI System (`src/cli/`)

**Available Commands:**

```bash
# Bot management
bot start --config <file>      # Start a bot
bot stop <bot-id>              # Stop specific bot
bot stop --all                 # Stop all bots
bot restart <bot-id>           # Restart bot
bot list                       # List all bots
bot status [bot-id]            # Show status

# Monitoring
bot logs [bot-id] --follow     # View logs
bot positions [bot-id]         # Show positions
bot trades [bot-id] --days N   # Show trades
bot performance [bot-id]       # Show metrics

# Testing
bot backtest --config <file>   # Run backtest
bot paper --config <file>      # Paper trading

# Emergency
bot emergency-stop-all         # Stop everything NOW
bot reconcile                  # Check accounting
bot health                     # Health check
```

**See:** [CLI Reference](./33-cli-reference.md) for full documentation.

## Data Flow

### Normal Operation

```
1. Exchange → New Candle
2. TradingBot receives candle
3. TradingBot → Strategy: "What should I do?"
4. Strategy analyzes and returns Signal
5. TradingBot validates signal (pre-trade checks)
6. TradingBot → Exchange: Place order
7. Exchange confirms order filled
8. TradingBot updates position in SQLite
9. TradingBot → Monitoring: Update sheets/alerts
```

### Error Recovery

```
1. Exchange WebSocket disconnects
2. TradingBot detects (heartbeat missed)
3. TradingBot attempts reconnect (3 retries)
4. If fails → Switch to REST API polling
5. Alert sent to Telegram (WARNING)
6. Continue trading via REST
7. Retry WebSocket in background
8. When reconnected → Resume WebSocket
9. Alert sent to Telegram (INFO: recovered)
```

### Crash Recovery

```
1. Bot crashes (power outage, bug, etc.)
2. Process manager restarts bot
3. Bot loads state from SQLite
4. Bot queries exchange for open positions
5. Bot reconciles: SQLite positions vs Exchange reality
6. If mismatch → Alert CRITICAL + log discrepancy
7. If match → Resume normal operation
8. Alert sent (INFO: bot restarted)
```

## Multi-Bot Architecture

### Virtual Accounting

All bots share the same exchange account but track virtual balances:

```
Exchange Reality:
- USDT Balance: $10,000

Bot 1 (Virtual):
- Allocated: $5,000
- Current: $5,234 (earned +$234)

Bot 2 (Virtual):
- Allocated: $5,000
- Current: $4,889 (lost -$111)

Total Virtual: $10,123
Exchange Balance: $10,123 ✓ (matches)
```

### Collision Prevention

- Each order tagged with bot ID
- Pre-trade check verifies total capital usage
- File lock prevents simultaneous trades
- Daily reconciliation detects drift

### Monitoring Multiple Bots

**Google Sheet:**
```
Bot Name            | Equity    | Position     | Today P&L | Status
--------------------|-----------|--------------|-----------|--------
ORB BTC Aggressive  | $5,234.50 | LONG 0.1 BTC | +$234.50  | running
ORB BTC Conservative| $4,889.20 | None         | -$110.80  | running
CME Gap ETH         | $5,123.00 | None         | +$123.00  | waiting
```

## Error Handling Strategy

### Error Levels

**CRITICAL** (Telegram + Email immediately):
- Bot crashed
- Position liquidated
- Daily loss limit hit
- Exchange disconnected >5 minutes
- Order stuck >10 minutes
- Position mismatch (reconciliation failed)

**WARNING** (Telegram, not urgent):
- Reconnection successful after failure
- Unusual slippage (>1%)
- Strategy skipped trade (filter triggered)
- Partial fill
- Rate limit hit (but handled)

**INFO** (Logs only):
- Trade executed
- Position updated
- Normal operations
- Candle received

### Recovery Strategies

1. **Transient Errors** (network hiccup):
   - Retry with exponential backoff
   - Max 3 retries
   - Switch to fallback if all fail

2. **Exchange Issues** (maintenance):
   - Circuit breaker activates
   - Stop placing new orders
   - Monitor existing positions
   - Alert user
   - Resume when exchange healthy

3. **Bot Bugs** (logic error):
   - Catch exception
   - Log full context
   - Alert CRITICAL
   - Increment error counter
   - If error streak >5: Stop bot
   - Require manual restart

4. **Data Issues** (missing candle):
   - Detect gap in timestamps
   - Fetch missing candles via REST
   - Validate and backfill
   - Continue normal operation

## Testing Strategy

### Unit Tests
- Strategy calculations (ATR, stops, etc.)
- Position sizing logic
- Risk management rules
- Order validation

### Integration Tests
- Bot + Paper Trading adapter
- Full lifecycle (start → trade → stop)
- Error recovery scenarios
- State persistence and recovery

### Live Testing Protocol
1. Paper trading 48+ hours
2. Compare with backtest (should be ±5%)
3. Live with $100 for 24 hours
4. Live with $500 for 1 week
5. Full capital after successful week

## Performance Requirements

- **Latency:** <1s from candle to signal
- **Reconnect:** <5s after disconnect
- **Alert Delivery:** <1min for CRITICAL
- **Heartbeat:** Every 30s
- **State Persistence:** Every action (immediate)
- **Memory:** <500MB per bot
- **CPU:** <10% per bot (idle), <50% (active)

## Security Considerations

1. **API Keys:** Environment variables only, never in code/configs
2. **Database:** File permissions (600), owner-only access
3. **Logs:** Sanitize (no keys/secrets in logs)
4. **Network:** HTTPS only for all external APIs
5. **Secrets:** Use system keychain on Windows/Mac

## Deployment Options

### Local (Testing)
- Windows: Forever loop script
- Keep PowerShell window open
- Perfect for 1-month testing

### Local (Production)
- Windows: Windows Service
- Linux: systemd
- Auto-start on boot

### Cloud (Recommended)
- Digital Ocean Droplet ($6/month)
- Render Background Worker ($7/month)
- PM2 process manager
- Auto-restart on crash

**See:** [Deployment Guide](./32-deployment-guide.md) for details.

## Migration from Old System

**See:** [Migration Plan](./35-migration-plan.md) for step-by-step guide.

**Summary:**
1. Archive `apps/web` (frontend no longer needed)
2. Implement new core components
3. Migrate ORB strategy to plugin
4. Test thoroughly with paper trading
5. Switch over live bots one at a time

## Implementation Status

**See:** [AI Agent Implementation](./36-ai-agent-implementation.md) for task breakdown.

| Component | Status | Priority |
|-----------|--------|----------|
| Core Engine | 🚧 In Progress | HIGH |
| Strategy Plugins | 🚧 In Progress | HIGH |
| Exchange Hardening | ⏳ Planned | HIGH |
| Monitoring | ⏳ Planned | HIGH |
| CLI | ⏳ Planned | MEDIUM |
| Testing | ⏳ Planned | MEDIUM |
| Documentation | ✅ In Progress | MEDIUM |

## Next Steps

1. Read [Strategy Plugin Guide](./31-strategy-plugin-guide.md)
2. Review [CLI Reference](./33-cli-reference.md)
3. Check [AI Agent Implementation](./36-ai-agent-implementation.md) for task breakdown
4. Start with Agent 1 (Core Infrastructure)

## References

- [Original Architecture](./11-architecture.md) - Old system (deprecated)
- [ORB Strategy Spec](./12-strategy-orb-atr.md) - Strategy logic (still valid)
- [Dev Standards](./18-dev-standards.md) - Coding conventions (still applies)
