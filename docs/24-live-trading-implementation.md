# Live Trading Implementation Guide (Phase 2)

## Status

**Phase 2.1 Complete**: Database schema for live trading
- ✅ Migration: `0002_phase2_live_trading.sql`
- ✅ Tables: bots, live_orders, live_positions, live_trades, bot_logs, account_snapshots
- ✅ Unique constraint on bot names: `0003_add_bots_unique_name.sql`

**In Progress**: Exchange adapters and bot engine (Phases 2.2-2.8)

## Overview

Phase 2 adds live trading capabilities to the DSTB platform, allowing you to run the same ORB+ATR strategy on real exchanges with real money.

## Architecture

```
Live Trading System
├── Database (6 new tables)
├── Exchange Adapter Interface
│   ├── Paper Trading Adapter (for safe testing)
│   └── Bitunix Adapter (for real money trading)
├── Trading Bot Engine (reuses backtest strategy logic)
├── Risk Management Layer
└── CLI Interface (no UI required initially)
```

## Key Design Principles

1. **Strategy Consistency**: Live bots use the EXACT same strategy logic as backtests
2. **Exchange Abstraction**: Adapter pattern allows swapping exchanges without changing bot logic
3. **Safety First**: Paper trading mandatory before real money
4. **Database-Driven**: All state stored in DB for recovery and monitoring
5. **CLI-First**: Start with command-line interface, UI later

## Database Schema

### Table: `bots`
Tracks bot configuration and lifecycle state.

**Key Fields:**
- `status`: stopped | starting | running | stopping | error | paused
- `exchange`: bitunix | paper
- `params_snapshot`: JSONB (StrategyParams from backtest system)
- `initial_balance`, `current_balance`, `current_equity`
- `max_daily_loss_pct`, `max_position_size_pct` (risk limits)
- `last_heartbeat_at`: Updated every 30s for health monitoring

### Table: `live_orders`
Complete audit trail of all orders submitted to exchange.

**Key Fields:**
- `status`: pending | submitted | partial | filled | cancelled | rejected | error
- `client_order_id`: Our unique ID for idempotency
- `exchange_order_id`: Exchange's ID after submission
- `request_payload`, `exchange_response`: Full API payloads for debugging

### Table: `live_positions`
Currently open positions with real-time P&L tracking.

**Key Fields:**
- `status`: open | closing | closed
- `entry_price`, `quantity`, `current_price`
- `unrealized_pnl`, `realized_pnl`
- `stop_loss_price`, `take_profit_price`, `trailing_stop_price`
- `r_multiple`: Current R-multiple for risk tracking

### Table: `live_trades`
Archived completed trades (read-only history).

**Key Fields:**
- `pnl`, `r_multiple`, `exit_reason`
- `max_favorable_excursion`, `max_adverse_excursion` (MFE/MAE analysis)

### Table: `bot_logs`
Detailed event logging for debugging and monitoring.

**Key Fields:**
- `level`: debug | info | warn | error | critical
- `category`: signal | order | position | risk | system
- `context`: JSONB with structured data

### Table: `account_snapshots`
Periodic equity snapshots for performance tracking.

**Key Fields:**
- `snapshot_type`: periodic | session_start | session_end | manual
- `equity`, `daily_pnl`, `total_pnl_since_start`

## CLI Commands

### Bot Management
```bash
# Start bot with config file
npm run bot:start -- --config bot-btc-15m.json

# Stop bot gracefully (closes positions first)
npm run bot:stop -- --id <bot-id>

# Force stop (immediate)
npm run bot:stop -- --id <bot-id> --force

# Restart bot
npm run bot:restart -- --id <bot-id>

# Pause (stop processing but keep positions open)
npm run bot:pause -- --id <bot-id>

# Resume from pause
npm run bot:resume -- --id <bot-id>

# List all bots
npm run bot:list

# List bots by status
npm run bot:list -- --status running

# Show detailed bot status
npm run bot:status -- --id <bot-id>
```

### Monitoring
```bash
# View open positions
npm run bot:positions -- --id <bot-id>

# View orders (filtered by status)
npm run bot:orders -- --id <bot-id> --status filled

# View completed trades
npm run bot:trades -- --id <bot-id> --days 7

# View performance metrics
npm run bot:performance -- --id <bot-id>

# View logs (with filtering)
npm run bot:logs -- --id <bot-id> --level error --tail 50

# Follow logs in real-time
npm run bot:logs -- --id <bot-id> --follow

# Health check
npm run bot:health -- --id <bot-id>
```

### Emergency Controls
```bash
# Stop ALL running bots immediately
npm run bot:emergency-stop-all

# Manually close specific position
npm run bot:close-position -- --id <position-id> --reason manual

# Cancel all orders for a bot
npm run bot:cancel-orders -- --bot-id <bot-id>
```

## Bot Configuration File

### Structure
```json
{
  "name": "BTC ORB 15m Production",
  "exchange": "bitunix",
  "symbol": "BTC-USD",
  "interval": "15m",
  "initialBalance": 10000,
  "riskManagement": {
    "maxDailyLossPct": 5,
    "maxPositionSizePct": 100
  },
  "params": {
    "version": "1.0",
    "symbol": "BTC-USD",
    "interval": "15m",
    "session": {
      "timezone": "America/New_York",
      "startTime": "09:30",
      "openingRangeMinutes": 30
    },
    "entry": {
      "directionMode": "long_short",
      "entryMode": "stop_breakout",
      "breakoutBufferBps": 5,
      "maxTradesPerSession": 1
    },
    "atr": {
      "atrLength": 14,
      "atrFilter": {
        "enabled": true,
        "minAtrBps": 20,
        "maxAtrBps": 500
      }
    },
    "risk": {
      "sizingMode": "fixed_risk_pct",
      "riskPctPerTrade": 1,
      "fixedNotional": 0,
      "stopMode": "atr_multiple",
      "atrStopMultiple": 2,
      "takeProfitMode": "r_multiple",
      "tpRMultiple": 2,
      "trailingStopMode": "disabled",
      "atrTrailMultiple": 2,
      "timeExitMode": "session_end",
      "barsAfterEntry": 0,
      "sessionEndTime": "16:00"
    },
    "execution": {
      "feeBps": 10,
      "slippageBps": 5
    }
  },
  "bitunix": {
    "apiKey": "${BITUNIX_API_KEY}",
    "secretKey": "${BITUNIX_SECRET_KEY}",
    "testMode": false,
    "marketType": "spot"
  }
}
```

### Exporting from Optimization Results

Use the export script to create bot config from your best backtest:

```bash
npm run export-params -- \
  --input optimization-results/run2.jsonl \
  --metric sharpe \
  --symbol BTC-USD \
  --output bot-btc-15m.json
```

Available metrics: `totalReturn`, `sharpe`, `profitFactor`, `winRate`

## Supported Exchanges

### Bitunix (Production)
- API docs: https://openapidoc.bitunix.com/doc/
- Available in Malaysia
- Supports: Spot trading, WebSocket real-time data
- Authentication: API key + HMAC-SHA256 signature
- Rate limits: 20 req/s (public), 10 req/s (private)

### Paper Trading (Testing)
- Simulates fills using real Binance candle data
- Same fee/slippage model as backtests
- No real money at risk
- Mandatory for 48 hours before going live

## Risk Management

### Pre-Trade Checks (all must pass)

1. **Daily Loss Limit**
   - Blocks new trades if daily loss exceeds `maxDailyLossPct`
   - Resets at 00:00 UTC

2. **Position Size Limit**
   - Ensures position size doesn't exceed `maxPositionSizePct` of equity
   - Calculated as: `(position_value / current_equity) * 100`

3. **Balance Check**
   - Verifies sufficient balance for: position + fees + 5% buffer
   - Rejects order if insufficient funds

4. **Max Open Positions**
   - Default: 1 position at a time
   - Configurable per bot

### In-Trade Monitoring

1. **Trailing Stops**: Automatically updated as position moves favorably
2. **Time-Based Exits**: Force close after max holding period
3. **Session-End Exits**: Close all positions at configured time

### Emergency Stops

1. **Exchange Connection Lost**: Auto-reconnect 3x, then pause bot
2. **Daily Loss Limit Breached**: Close all positions, pause until next day
3. **Unexpected Position**: Reconcile with exchange, log critical alert

## Bot Lifecycle States

```
stopped → starting → running → stopping → stopped
             ↓                     ↑
          error ←------------------┘
             ↓
          paused (manual) → running
```

### State Transitions

- **stopped → starting**: Bot initializing (connecting to exchange, loading state)
- **starting → running**: Bot active, processing candles, executing trades
- **running → stopping**: Shutdown initiated (closing positions gracefully)
- **stopping → stopped**: Bot cleanly shut down
- **running → error**: Critical error (auth failure, too many errors)
- **running → paused**: Manual pause or daily loss limit hit
- **paused → running**: Manual resume after resolving issue

## Health Monitoring

### Heartbeat System
- Bots update `last_heartbeat_at` every 30 seconds
- External monitor checks for stale heartbeats (>2 minutes = alert)
- Missing heartbeat triggers auto-restart (if error_count < 3)

### Performance Metrics (tracked per bot)
- Total P&L since start
- Daily P&L
- Win rate, profit factor
- Current drawdown from peak
- Open positions count
- Order success rate

### Alerts (logged as critical)
- Daily loss limit hit
- Large single-trade loss (>3R)
- Bot heartbeat missing >2 minutes
- Error rate high (>10/hour)
- Balance mismatch (DB vs exchange)

## Testing Protocol

### Phase 1: Paper Trading (48 hours minimum)
- [ ] Start bot with paper trading adapter
- [ ] Verify entry signals generated correctly
- [ ] Verify positions tracked properly
- [ ] Verify P&L calculations accurate
- [ ] Verify stops and TPs work
- [ ] Test bot restart (state recovery)
- [ ] Test emergency stop
- [ ] Compare P&L with backtest for same period (±5% acceptable)

### Phase 2: Bitunix Testnet (24 hours, if available)
- [ ] Configure with testnet credentials
- [ ] Repeat all paper trading tests
- [ ] Verify API calls succeed
- [ ] Test order execution speed
- [ ] Test error handling (invalid orders, rate limits)

### Bitunix Adapter Validation Checklist
- [ ] Authenticate with Bitunix (testnet mode first)
- [ ] Fetch candles successfully
- [ ] Get current price
- [ ] Get account balance
- [ ] Place market order (small amount)
- [ ] Place limit order
- [ ] Cancel order
- [ ] Query order status
- [ ] WebSocket connects and receives candle updates
- [ ] Rate limiting prevents exceeding limits
- [ ] Error handling works for invalid symbol and insufficient balance
- [ ] Signature generation matches Bitunix examples

### Phase 3: Bitunix Live (start small!)
- [ ] Run safety checklist
- [ ] Start with $50-$100 only
- [ ] Monitor first trade closely
- [ ] Verify fills match expectations
- [ ] Check fees are correct
- [ ] Run for 24 hours before increasing capital

## Safety Checklist

Before going live with real money:

- [ ] Paper trading successful for 48+ hours
- [ ] Paper trading P&L within ±5% of backtest expectations
- [ ] Bitunix API keys valid (tested in testnet if available)
- [ ] Daily loss limit set (recommended: 5% max)
- [ ] Starting capital is money you can afford to lose ($50-$100 first)
- [ ] Monitoring plan in place (check every 4 hours minimum)
- [ ] Emergency stop procedure understood
- [ ] Backup funds available (not all capital in bot)
- [ ] Bot config backed up
- [ ] Database backed up

## Deployment Options

### Local Machine (Development)
- Run CLI commands from terminal
- Use `screen` or `tmux` to persist sessions
- Pros: Full control, low latency
- Cons: Must keep computer running 24/7

### Render Background Worker (Production)
- Deploy bot engine as long-running worker process
- Environment variables for API keys
- Auto-restart on crash
- Pros: Cloud-hosted, reliable, automatic restarts
- Cons: Slightly higher latency than local

### VPS/Dedicated Server
- Most control, lowest latency
- Use PM2 or systemd to manage processes
- Best for high-frequency strategies

**Recommended**: Start local, move to Render once stable.

## Troubleshooting

### Bot not starting
- Check database connection (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- Verify config file is valid JSON
- Check bot name is unique
- Verify exchange API keys (if not paper trading)

### Orders not executing
- Check bot status: `npm run bot:status -- --id <bot-id>`
- Check logs: `npm run bot:logs -- --id <bot-id> --level error`
- Verify sufficient balance
- Check daily loss limit not exceeded
- Verify symbol is correct for exchange

### Positions not closing
- Check if stop/TP orders are placed on exchange
- Verify trailing stop is updating
- Check for exit signals in logs
- Manually close if needed: `npm run bot:close-position -- --id <position-id> --reason manual`

### Performance differs from backtest
- Small differences (±5%) are normal due to timing
- Large differences suggest issue with strategy implementation
- Compare: entry prices, stop prices, exit reasons
- Check if slippage/fees match backtest assumptions

## Next Steps

See Phase 2 implementation prompts for detailed implementation guide for each component:
- Phase 2.2: Exchange adapters
- Phase 2.3: Strategy extraction
- Phase 2.4: Bot lifecycle manager
- Phase 2.5: Trading bot engine
- Phase 2.6: Bitunix integration
- Phase 2.7: Risk management
- Phase 2.8: Testing and deployment

## References

- [23-live-trading-exchange-selection.md](./23-live-trading-exchange-selection.md) - Exchange selection rationale
- [12-strategy-orb-atr.md](./12-strategy-orb-atr.md) - Strategy logic (same for backtest and live)
- [17-supabase-schema-and-migrations.md](./17-supabase-schema-and-migrations.md) - Database schema
- [21-deployment-vercel-render.md](./21-deployment-vercel-render.md) - Deployment guide
