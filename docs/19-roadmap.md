# Roadmap

## ✅ Phase 1: Backtesting Platform (COMPLETE)

### Milestone 0: Repo scaffolding ✅
- ✅ Backend project (Node + TypeScript + Express)
- ✅ React UI project (Vite + TypeScript + Tailwind + shadcn/ui)
- ✅ Supabase project with migration workflow
- ✅ Monorepo structure with workspace support

### Milestone 1: Backtest "thin slice" ✅
- ✅ Single backtest execution end-to-end
- ✅ Parameter sets management via UI
- ✅ Results viewing (metrics + trades + equity curve)
- ✅ Candle ingestion (Yahoo Finance → migrated to Binance)
- ✅ DST-aware NY session and opening range
- ✅ ATR computation
- ✅ ORB entries + exits (all stop/TP modes)
- ✅ Fee + slippage model
- ✅ Database persistence (runs, trades, events, equity points)

### Milestone 2: Backtest optimization ✅
- ✅ Grid runner (batch runs with parameter sweeps)
- ✅ CLI batch backtest runner (80K+ runs tested)
- ✅ File-based results (JSONL) for high performance
- ✅ Optimization results import tool
- ✅ All exit options (trailing stop, time exit, session end)
- ✅ Data migration to Binance (10-100x faster than Yahoo)
- ✅ Candle caching and resampling
- ✅ WebSocket real-time updates
- ✅ Modern UI redesign (Apple-inspired light theme)
- ✅ Compare runs functionality

**Key Deliverables:**
- ✅ 3 symbols supported: BTC-USD, ETH-USD, ZEC-USD
- ✅ 9 intervals supported: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d
- ✅ ~20 tunable strategy parameters
- ✅ Optimization-mode for testing 10K+ parameter combinations
- ✅ CLI + UI interfaces

---

## 🚧 Phase 2: Live Trading Platform (IN PROGRESS)

### Milestone 3: Live trading foundation (Phase 2.1 COMPLETE)

**Status: Phase 2.1 Complete, Phases 2.2-2.8 In Progress**

#### Phase 2.1: Database Schema ✅
- ✅ Migration: `0002_phase2_live_trading.sql`
- ✅ 6 new tables: bots, live_orders, live_positions, live_trades, bot_logs, account_snapshots
- ✅ Unique constraint on bot names
- ✅ Proper indexes and foreign keys

#### Phase 2.2: Exchange Adapters (In Progress)
- ⏳ IExchangeAdapter interface
- ⏳ Paper Trading Adapter (for safe testing)
- ⏳ Exchange adapter factory

#### Phase 2.3: Strategy Extraction (Planned)
- ⏳ Extract strategy logic from backtest into shared module
- ⏳ Session management (reusable)
- ⏳ Signal generation (reusable)
- ⏳ Ensure backtest and live use identical logic

#### Phase 2.4: Bot Lifecycle (Planned)
- ⏳ Bot repository (CRUD operations)
- ⏳ Bot lifecycle manager (start/stop/restart/pause)
- ⏳ Bot config validator
- ⏳ CLI commands (bot:start, bot:stop, bot:status, bot:list)
- ⏳ Config schema with validation

#### Phase 2.5: Trading Bot Engine (Planned)
- ⏳ Main TradingBot class with event loop
- ⏳ Position manager (track open positions)
- ⏳ Order executor (place/track orders)
- ⏳ Bot logger (structured logging)
- ⏳ State recovery on restart

#### Phase 2.6: Bitunix Integration (Planned)
- ⏳ Bitunix adapter (REST + WebSocket)
- ⏳ Authentication (API key + HMAC signature)
- ⏳ Rate limiting
- ⏳ Symbol mapping (BTC-USD → BTCUSDT)
- ⏳ Error handling and retries

#### Phase 2.7: Risk Management & Monitoring (Planned)
- ⏳ Risk manager (pre-trade checks)
- ⏳ Daily loss limit enforcement
- ⏳ Position sizing calculations
- ⏳ Performance monitor (metrics, equity curve)
- ⏳ Alert manager (critical events)
- ⏳ CLI monitoring commands (positions, orders, trades, logs, performance)
- ⏳ Emergency stop controls

#### Phase 2.8: Testing & Deployment (Planned)
- ⏳ End-to-end paper trading test (48 hours)
- ⏳ Best params exporter (from optimization results)
- ⏳ Safety checklist script
- ⏳ Deployment to Render (background worker)
- ⏳ Production monitoring plan

### Milestone 4: Live trading MVP

**Target: Bitunix exchange (available in Malaysia)**

- ⏳ Start/stop bots via CLI
- ⏳ Real-time candle streaming
- ⏳ Order placement and tracking
- ⏳ Position management with stops/TPs
- ⏳ Real-time P&L tracking
- ⏳ Comprehensive logging
- ⏳ Paper trading mode for safe testing
- ⏳ Performance monitoring
- ⏳ Risk limits (daily loss, position size)

**CLI Interface (No UI initially):**
```bash
npm run bot:start -- --config bot-config.json
npm run bot:stop -- --id <bot-id>
npm run bot:status -- --id <bot-id>
npm run bot:positions -- --id <bot-id>
npm run bot:trades -- --id <bot-id>
npm run bot:performance -- --id <bot-id>
```

---

## 🔮 Phase 3: Production Hardening (PLANNED)

### Milestone 5: Production hardening

- ⏳ Bot management UI (start/stop, monitor from web)
- ⏳ Live trading dashboard (real-time positions, P&L)
- ⏳ Alert notifications (email, SMS, Telegram)
- ⏳ Multi-bot coordination
- ⏳ Advanced risk controls (correlation, portfolio limits)
- ⏳ Disaster recovery procedures
- ⏳ Database backups and replay
- ⏳ Multi-exchange support (add more exchanges)
- ⏳ Multi-tenant auth/RLS (if needed)

---

## Timeline

- **Phase 1**: ✅ Complete (Jan 2026)
- **Phase 2**: 🚧 In Progress (Est. 3-4 weeks, Feb 2026)
  - 2.1: ✅ Complete
  - 2.2-2.8: ⏳ In Progress
- **Phase 3**: ⏳ Planned (Mar 2026+)

## Current Focus

**Implementing Phase 2 (Live Trading)** using the 8-phase implementation plan:
1. ✅ Database schema
2. ⏳ Exchange adapters (current)
3. ⏳ Strategy extraction
4. ⏳ Bot lifecycle
5. ⏳ Trading engine
6. ⏳ Bitunix integration
7. ⏳ Risk & monitoring
8. ⏳ Testing & deployment

See [24-live-trading-implementation.md](./24-live-trading-implementation.md) for detailed implementation guide.
