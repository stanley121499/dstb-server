# AI Agent Implementation Guide

**Status:** 🚧 Ready for Implementation  
**Last Updated:** February 2026

## Overview

This document breaks down the implementation of the new simplified architecture into **7 manageable tasks** that can be executed by AI agents or developers.

## Task Parallelization Strategy

```
Phase 1 (Parallel):
├── Agent 1: Core Infrastructure
├── Agent 2: Strategy Plugin System
└── Agent 3: Exchange Layer Hardening

Phase 2 (Parallel - depends on Phase 1):
├── Agent 4: Bot Engine
└── Agent 5: Monitoring & Alerts

Phase 3 (Sequential - depends on Phase 2):
├── Agent 6: CLI & Controls
└── Agent 7: Testing & Validation
```

**Estimated Total Time:** 2-3 weeks (with parallel execution)

---

## Agent 1: Core Infrastructure

**Priority:** HIGH  
**Dependencies:** None (can start immediately)  
**Estimated Time:** 3-4 days  
**Context Window:** ~25K tokens

### Scope

Build the foundation: SQLite state management, logging system, configuration loader.

### Files to Create

```
src/core/
├── StateManager.ts        # SQLite operations
├── Logger.ts              # Structured logging
├── ConfigLoader.ts        # Load/validate config files
└── types.ts               # Core type definitions

data/
└── schema.sql             # SQLite schema

configs/
├── bot.example.json       # Bot settings template
└── strategies/
    └── .gitkeep
```

### Implementation Details

#### 1. StateManager.ts

**Responsibilities:**
- Initialize SQLite database
- CRUD operations for bots, positions, trades, orders
- Transaction support (atomic operations)
- Daily backups

**Key Methods:**
```typescript
class StateManager {
  // Bot management
  async createBot(bot: BotConfig): Promise<string>
  async getBot(id: string): Promise<Bot | null>
  async updateBotEquity(id: string, equity: number): Promise<void>
  async updateBotHeartbeat(id: string): Promise<void>
  
  // Position management
  async createPosition(position: Position): Promise<string>
  async getOpenPositions(botId: string): Promise<Position[]>
  async updatePosition(id: string, updates: Partial<Position>): Promise<void>
  async closePosition(id: string, exitPrice: number, reason: string): Promise<void>
  
  // Trade history
  async saveTrade(trade: Trade): Promise<string>
  async getTrades(botId: string, days?: number): Promise<Trade[]>
  
  // Order tracking
  async createOrder(order: Order): Promise<string>
  async updateOrderStatus(clientOrderId: string, status: OrderStatus): Promise<void>
  async getOrder(clientOrderId: string): Promise<Order | null>
  
  // Reconciliation
  async getAllOpenPositions(): Promise<Position[]>
  async getDailyPnL(botId: string, date: string): Promise<number>
  
  // Backup
  async backup(): Promise<void>
}
```

**Schema (data/schema.sql):**
```sql
-- See detailed schema in 30-new-architecture.md
-- Tables: bots, positions, trades, orders
```

#### 2. Logger.ts

**Responsibilities:**
- Write logs to daily files
- Structured JSON + human-readable format
- Log rotation (keep 30 days)
- Log levels: DEBUG, INFO, WARN, ERROR, CRITICAL

**Key Methods:**
```typescript
class Logger {
  constructor(botId: string, logDir: string)
  
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  critical(message: string, context?: Record<string, unknown>): void
  
  // Get path to current log file
  getCurrentLogFile(): string
}
```

**Log Format:**
```
[2026-02-04 10:30:45] INFO [bot-abc123] Trade executed | side=LONG price=45000 qty=0.1 pnl=+234.50
```

#### 3. ConfigLoader.ts

**Responsibilities:**
- Load and validate JSON config files
- Environment variable substitution
- Schema validation (Zod)

**Key Methods:**
```typescript
class ConfigLoader {
  static loadBotConfig(path: string): BotConfig
  static loadStrategyConfig(path: string): StrategyConfig
  static validateConfig(config: unknown): BotConfig
}
```

### Validation Requirements

- All database operations must be in transactions
- Errors must be caught and logged (no crashes)
- Config validation must provide clear error messages
- Log files must rotate daily

### Testing Checklist

- [ ] Create database from schema
- [ ] Insert bot record
- [ ] Create/update/close position
- [ ] Save trade
- [ ] Query trades by date range
- [ ] Load config with env var substitution
- [ ] Write logs at all levels
- [ ] Log rotation works
- [ ] Database backup works

### Deliverables

- Working SQLite database with all tables
- Logger that writes to daily files
- Config loader with validation
- Unit tests for all components
- README for this module

---

## Agent 2: Strategy Plugin System

**Priority:** HIGH  
**Dependencies:** None (can start immediately)  
**Estimated Time:** 4-5 days  
**Context Window:** ~30K tokens

### Scope

Create the strategy plugin interface and migrate the existing ORB-ATR strategy.

### Files to Create

```
src/strategies/
├── IStrategy.ts           # Interface definition
├── factory.ts             # Strategy loader
├── orb-atr.ts            # Migrated ORB strategy
├── sma-crossover.ts      # Example simple strategy
└── __tests__/
    ├── orb-atr.test.ts
    └── sma-crossover.test.ts

configs/strategies/
├── orb-btc-15m.json
├── orb-eth-1h.json
└── sma-btc-15m.json
```

### Implementation Details

#### 1. IStrategy.ts

See [Strategy Plugin Guide](./31-strategy-plugin-guide.md) for full interface definition.

#### 2. ORB-ATR Migration

**Source:** `apps/api/src/strategy/orbAtrStrategy.ts`

**Task:** Extract and refactor into a class:

```typescript
export class ORBATRStrategy implements IStrategy {
  name = "ORB + ATR";
  warmupPeriod: number;
  
  private params: ORBParams;
  private sessionManager: SessionManager;
  private atrCalculator: ATRCalculator;
  private openingRangeLevels: OpeningRangeLevels | null;
  
  constructor(params: ORBParams) {
    this.params = params;
    this.warmupPeriod = params.atrLength;
    this.sessionManager = new SessionManager(params.session);
    this.atrCalculator = new ATRCalculator(params.atrLength);
  }
  
  initialize(candles: Candle[]): void {
    // Warm up ATR
    this.atrCalculator.initialize(candles);
    
    // Find last completed session for opening range
    this.openingRangeLevels = this.sessionManager.findLastOpeningRange(candles);
  }
  
  onCandle(candle: Candle, position: Position | null): Signal {
    // Update ATR
    const atr = this.atrCalculator.update(candle);
    
    // Check if we're in session
    const sessionState = this.sessionManager.getSessionState(candle.timestamp);
    
    if (!sessionState.active) {
      return { type: "HOLD", price: candle.close, reason: "Outside trading session" };
    }
    
    // Update opening range if needed
    if (sessionState.orPhase === "building") {
      this.sessionManager.updateOpeningRange(candle);
      return { type: "HOLD", price: candle.close, reason: "Building opening range" };
    }
    
    if (!sessionState.orComplete) {
      return { type: "HOLD", price: candle.close, reason: "Opening range not complete" };
    }
    
    this.openingRangeLevels = sessionState.orLevels;
    
    // No position - look for entry
    if (!position) {
      return this.checkEntry(candle, atr, sessionState);
    }
    
    // Have position - check exits
    return this.checkExit(candle, position, atr, sessionState);
  }
  
  onFill(position: Position): void {
    // Reset session entry counter if needed
  }
  
  getState(): Record<string, unknown> {
    return {
      atr: this.atrCalculator.getValue(),
      openingRange: this.openingRangeLevels,
      session: this.sessionManager.getCurrentSession()
    };
  }
  
  private checkEntry(candle: Candle, atr: number, sessionState: SessionState): Signal {
    // Implement ORB entry logic (from original file)
    // ...
  }
  
  private checkExit(candle: Candle, position: Position, atr: number, sessionState: SessionState): Signal {
    // Implement exit logic (stops, TP, trailing, time-based)
    // ...
  }
}
```

**Helper Classes to Extract:**
- `SessionManager` - Handle NY session, DST, opening range
- `ATRCalculator` - Wilder's ATR calculation
- These can be in separate files under `src/strategies/helpers/`

#### 3. Factory

```typescript
export function createStrategy(name: string, params: any): IStrategy {
  switch (name) {
    case "orb-atr":
      return new ORBATRStrategy(params);
    case "sma-crossover":
      return new SMAcrossoverStrategy(params);
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}
```

### Validation Requirements

- Strategy must match original ORB backtest results (±1%)
- All calculations must be unit tested
- Session management must handle DST correctly
- Strategy state must be serializable

### Testing Checklist

- [ ] ORB strategy matches original logic
- [ ] ATR calculation correct (test with known values)
- [ ] Session detection works across DST
- [ ] Opening range calculation correct
- [ ] Entry signals match expectations
- [ ] Exit signals (stop/TP/trailing) work
- [ ] Backtest produces similar results to old system
- [ ] Factory loads strategies correctly

### Deliverables

- Working IStrategy interface
- ORB-ATR strategy plugin (fully tested)
- Simple example strategy (SMA crossover)
- Unit tests for all strategies
- Config files for each strategy
- Migration comparison report (old vs new backtest)

---

## Agent 3: Exchange Layer Hardening

**Priority:** HIGH  
**Dependencies:** None (can start immediately)  
**Estimated Time:** 3-4 days  
**Context Window:** ~25K tokens

### Scope

Harden the existing Bitunix adapter with reconnection, error handling, and fallbacks.

### Files to Modify

```
src/exchanges/
├── IExchangeAdapter.ts    # Interface (minimal changes)
├── BitunixAdapter.ts      # MAJOR changes (hardening)
├── BitunixWebSocket.ts    # MAJOR changes (reconnection)
├── PaperTradingAdapter.ts # Minor fixes
└── types.ts               # Add error types
```

### Implementation Details

#### Key Improvements Needed

1. **WebSocket Reconnection**
```typescript
class BitunixWebSocket {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1s
  
  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error("Max reconnect attempts reached");
    }
    
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      60000 // Max 60s
    );
    
    this.reconnectAttempts++;
    await sleep(delay);
    await this.connect();
  }
  
  private onDisconnect(): void {
    logger.warn("WebSocket disconnected, reconnecting...");
    this.reconnect().catch(err => {
      logger.error("Reconnection failed", { error: err.message });
      // Notify monitoring system
    });
  }
}
```

2. **Heartbeat Monitoring**
```typescript
class BitunixWebSocket {
  private lastHeartbeat: number = Date.now();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  private startHeartbeatMonitor(): void {
    this.heartbeatInterval = setInterval(() => {
      const elapsed = Date.now() - this.lastHeartbeat;
      if (elapsed > 60000) {  // 1 minute no data
        logger.warn("WebSocket heartbeat timeout");
        this.reconnect();
      }
    }, 30000);  // Check every 30s
  }
  
  private onMessage(data: any): void {
    this.lastHeartbeat = Date.now();
    // Process message...
  }
}
```

3. **REST Fallback**
```typescript
class BitunixAdapter {
  private useWebSocket = true;
  
  async getLatestCandle(): Promise<Candle> {
    if (this.useWebSocket && this.ws.isConnected()) {
      return this.ws.getLatestCandle();
    }
    
    // Fallback to REST
    logger.warn("Using REST fallback for candles");
    return this.fetchCandleViaREST();
  }
}
```

4. **Order Confirmation Polling**
```typescript
async placeOrder(order: OrderRequest): Promise<Order> {
  const clientOrderId = `bot-${botId}-${Date.now()}`;
  
  // Submit order
  const response = await this.submitOrder({
    ...order,
    clientOrderId
  });
  
  // Poll for confirmation (don't trust immediate response)
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const status = await this.queryOrderStatus(clientOrderId);
    
    if (status.status === "filled") {
      return status;
    }
    
    if (status.status === "rejected" || status.status === "cancelled") {
      throw new ExchangeError(`Order ${status.status}: ${status.reason}`);
    }
  }
  
  // Timeout - order might still be pending
  logger.warn(`Order ${clientOrderId} status unknown after 5s`);
  return { ...response, status: "pending" };
}
```

5. **Circuit Breaker**
```typescript
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > 60000) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker open");
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failureCount = 0;
    this.state = "closed";
  }
  
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= 5) {
      this.state = "open";
      logger.critical("Circuit breaker opened (too many failures)");
    }
  }
}
```

### Validation Requirements

- Must handle all known Bitunix error codes
- Reconnection must work after any disconnect
- Orders must be confirmed before returning
- Rate limits must never be exceeded
- Partial fills must be handled correctly

### Testing Checklist

- [ ] Simulate network disconnect → auto-reconnect works
- [ ] Simulate Bitunix maintenance → circuit breaker opens
- [ ] Simulate rate limit → backoff works
- [ ] Simulate partial fill → position updated correctly
- [ ] Order confirmation polling works
- [ ] REST fallback works when WebSocket down
- [ ] Heartbeat detects dead connection
- [ ] Error codes mapped correctly

### Deliverables

- Hardened BitunixAdapter
- Auto-reconnect WebSocket
- Circuit breaker implementation
- Comprehensive error handling
- Integration tests
- Error handling documentation

---

## Agent 4: Bot Engine

**Priority:** HIGH  
**Dependencies:** Agent 1, Agent 2, Agent 3  
**Estimated Time:** 4-5 days  
**Context Window:** ~30K tokens

### Scope

Build the simplified TradingBot engine that orchestrates everything.

### Files to Create

```
src/core/
├── TradingBot.ts          # Main bot engine
├── PositionManager.ts     # Track positions
├── OrderExecutor.ts       # Place/manage orders
├── RiskManager.ts         # Pre-trade checks
└── __tests__/
    ├── TradingBot.test.ts
    └── RiskManager.test.ts
```

### Implementation Details

#### TradingBot.ts (Simplified)

```typescript
export class TradingBot {
  private id: string;
  private config: BotConfig;
  private strategy: IStrategy;
  private exchange: IExchangeAdapter;
  private stateManager: StateManager;
  private logger: Logger;
  private isRunning = false;
  
  async start(): Promise<void> {
    this.isRunning = true;
    
    // Step 1: Load state from database
    await this.loadState();
    
    // Step 2: Reconcile positions with exchange
    await this.reconcilePositions();
    
    // Step 3: Initialize strategy with historical candles
    const historicalCandles = await this.exchange.getHistoricalCandles(
      this.strategy.warmupPeriod
    );
    this.strategy.initialize(historicalCandles);
    
    // Step 4: Start main loop
    await this.mainLoop();
  }
  
  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Get latest candle
        const candle = await this.exchange.getLatestCandle();
        
        // Get current position
        const position = await this.stateManager.getOpenPosition(this.id);
        
        // Ask strategy what to do
        const signal = this.strategy.onCandle(candle, position);
        
        // Handle signal
        if (signal.type === "ENTRY") {
          await this.handleEntry(signal);
        } else if (signal.type === "EXIT") {
          await this.handleExit(signal, position);
        }
        
        // Update heartbeat
        await this.stateManager.updateBotHeartbeat(this.id);
        
        // Wait for next candle
        await this.waitForNextCandle();
        
      } catch (error) {
        await this.handleError(error);
      }
    }
  }
  
  private async handleEntry(signal: Signal): Promise<void> {
    // Pre-trade risk checks
    const riskCheck = await this.checkRisk(signal);
    if (!riskCheck.allowed) {
      this.logger.warn(`Entry blocked: ${riskCheck.reason}`);
      return;
    }
    
    // Calculate position size
    const quantity = this.calculateQuantity(signal);
    
    // Place order
    const order = await this.exchange.placeOrder({
      symbol: this.config.symbol,
      side: signal.side,
      quantity: quantity,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit
    });
    
    // Save to database
    await this.stateManager.createPosition({
      botId: this.id,
      ...order,
      entryTime: Date.now()
    });
    
    // Notify strategy
    this.strategy.onFill(order);
    
    this.logger.info(`Position opened: ${signal.side} ${quantity}`, {
      price: order.price,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit
    });
  }
  
  private async handleError(error: unknown): Promise<void> {
    this.errorCount++;
    this.logger.error("Bot error", { error: String(error) });
    
    // Send alert
    await alerting.sendAlert({
      level: "ERROR",
      message: `Bot error: ${String(error)}`,
      botId: this.id
    });
    
    // If too many errors, stop
    if (this.errorCount > 10) {
      this.logger.critical("Too many errors, stopping bot");
      await this.stop();
    }
  }
}
```

### Validation Requirements

- Bot must recover from crashes (load state from DB)
- Position reconciliation must catch discrepancies
- Risk checks must block invalid trades
- All actions must be logged
- Heartbeat must update every 30s

### Testing Checklist

- [ ] Bot starts successfully
- [ ] Loads state from database
- [ ] Reconciles positions correctly
- [ ] Strategy receives candles
- [ ] Entries execute correctly
- [ ] Exits execute correctly
- [ ] Risk checks work
- [ ] Error recovery works
- [ ] Bot stops cleanly
- [ ] Heartbeat updates

### Deliverables

- Working TradingBot engine
- Position manager
- Order executor
- Risk manager
- Integration tests
- End-to-end test with paper trading

---

## Agent 5: Monitoring & Alerts

**Priority:** HIGH  
**Dependencies:** Agent 1, Agent 4  
**Estimated Time:** 3-4 days  
**Context Window:** ~25K tokens

### Scope

Implement Telegram alerts and Google Sheets reporting.

### Files to Create

```
src/monitoring/
├── TelegramAlerter.ts      # Telegram bot
├── GoogleSheetsReporter.ts # Sheets integration
├── EmailAlerter.ts         # Email backup
└── __tests__/
    └── alerts.test.ts
```

### Implementation Details

See [Monitoring Setup Guide](./34-monitoring-setup.md) for details.

**Key Features:**
- Instant Telegram messages for errors
- Google Sheets updated every 5 minutes
- Email daily summaries
- Alert levels (CRITICAL, WARNING, INFO)
- Telegram commands: `/status`, `/positions`, `/stop`

### Testing Checklist

- [ ] Telegram bot receives messages
- [ ] Google Sheets updates correctly
- [ ] Email sends successfully
- [ ] Alert levels work
- [ ] Telegram commands work
- [ ] Rate limiting prevents spam

### Deliverables

- Working Telegram alerter
- Working Google Sheets reporter
- Email alerter
- Setup guide for users
- Test suite

---

## Agent 6: CLI & Controls

**Priority:** MEDIUM  
**Dependencies:** Agent 1, Agent 4, Agent 5  
**Estimated Time:** 3 days  
**Context Window:** ~20K tokens

### Scope

Build the CLI interface for controlling bots.

### Files to Create

```
src/cli/
├── index.ts               # Main CLI entry
├── commands/
│   ├── start.ts          # Start bot
│   ├── stop.ts           # Stop bot
│   ├── status.ts         # Show status
│   ├── logs.ts           # View logs
│   ├── backtest.ts       # Run backtest
│   └── reconcile.ts      # Reconciliation
└── __tests__/
    └── cli.test.ts
```

### Implementation Details

See [CLI Reference](./33-cli-reference.md) for full command list.

### Testing Checklist

- [ ] All commands work
- [ ] Error messages clear
- [ ] Help text accurate
- [ ] Daemon mode works
- [ ] Log streaming works

### Deliverables

- Working CLI
- All commands implemented
- Help documentation
- User guide

---

## Agent 7: Testing & Validation

**Priority:** MEDIUM  
**Dependencies:** All previous agents  
**Estimated Time:** 2-3 days  
**Context Window:** ~20K tokens

### Scope

End-to-end testing and validation.

### Tasks

1. **Integration Tests**
   - Full bot lifecycle (start → trade → stop)
   - Multi-bot scenarios
   - Error recovery scenarios
   - State persistence

2. **Paper Trading Validation**
   - Run ORB strategy for 48h
   - Compare with backtest
   - Should be within ±5%

3. **Performance Testing**
   - Bot handles 1000 candles/day
   - Memory usage <500MB
   - CPU usage <50%
   - No memory leaks

4. **Documentation Review**
   - All docs accurate
   - Examples work
   - Setup guides complete

### Deliverables

- Complete test suite
- Performance benchmark report
- Paper trading comparison report
- Documentation review

---

## Implementation Order

**Week 1:**
- ✅ Agent 1, 2, 3 in parallel

**Week 2:**
- ✅ Agent 4, 5 in parallel

**Week 3:**
- ✅ Agent 6, 7 sequential

## Success Criteria

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Paper trading matches backtest (±5%)
- [ ] Bot runs 48h without crashes
- [ ] All documentation complete
- [ ] CLI works on Windows
- [ ] Alerts arrive within 1 minute

## Next Steps

1. Review this plan
2. Start with Agent 1 (Core Infrastructure)
3. Continue with Agent 2 or 3 in parallel
4. Follow task order
5. Test thoroughly before moving to next phase

## References

- [New Architecture](./30-new-architecture.md)
- [Strategy Plugin Guide](./31-strategy-plugin-guide.md)
- [CLI Reference](./33-cli-reference.md)
- [Monitoring Setup](./34-monitoring-setup.md)
