# Bitunix Exchange Adapter — Reference

> **Source of truth** for the Bitunix futures adapter implementation.  
> All API paths in this document have been browser-verified against the live [Bitunix OpenAPI docs](https://openapidoc.bitunix.com/doc/).  
> Last verified: 2026-02-25.

---

## Overview

The Bitunix adapter connects the DSTB trading engine to the Bitunix perpetual futures exchange. It is composed of:

| Module | File | Responsibility |
|---|---|---|
| `BitunixAdapter` | `BitunixAdapter.ts` | Orchestrates all sub-APIs; implements `IExchangeAdapter` |
| `BitunixClient` | `BitunixClient.ts` | Shared HTTP transport: rate limiting, auth, retry, circuit breaker |
| `BitunixMarketApi` | `BitunixMarketApi.ts` | Candles, tickers, depth, funding rates, trading pairs |
| `BitunixTradeApi` | `BitunixTradeApi.ts` | Place, cancel, modify, and query orders |
| `BitunixPositionApi` | `BitunixPositionApi.ts` | Pending/history positions, position tiers, mark prices |
| `BitunixAccountApi` | `BitunixAccountApi.ts` | Account balance, leverage, margin mode, position mode |
| `BitunixTpSlApi` | `BitunixTpSlApi.ts` | TP/SL order lifecycle (place, query, cancel, modify) |
| `BitunixAssetApi` | `BitunixAssetApi.ts` | Copy-trading sub-account asset transfers |
| `BitunixWebSocket` | `BitunixWebSocket.ts` | Real-time candle/ticker streams with auto-reconnect |
| `BitunixParsers` | `BitunixParsers.ts` | Schema validation and domain object conversion |
| `bitunixAuth` | `bitunixAuth.ts` | HMAC-SHA256 authentication signature generation |
| `bitunixSymbolMapper` | `bitunixSymbolMapper.ts` | Symbol format conversion (e.g. `BTC-USD` → `BTCUSDT`) |

---

## Configuration

### `BitunixAdapterConfig`

```typescript
type BitunixAdapterConfig = {
  type: "bitunix";
  symbol: string;          // Canonical symbol e.g. "BTC-USD"
  interval: YahooInterval; // e.g. "15m", "1h"
  apiKey?: string;         // Falls back to BITUNIX_API_KEY env var
  apiSecret?: string;      // Falls back to BITUNIX_SECRET_KEY env var
  testMode?: boolean;      // true = testnet base URL
  marketType?: "spot" | "futures"; // default: "futures"
};
```

### REST Base URL

| Mode | URL |
|------|-----|
| Production (only) | `https://fapi.bitunix.com` |

> **Bitunix does not have a testnet.** All integration testing must use real production credentials. Use small order quantities and be cautious.

### Environment Variables

| Variable | Purpose |
|---|---|
| `BITUNIX_API_KEY` | API key for live trading |
| `BITUNIX_SECRET_KEY` | Secret key for live trading |
| `BITUNIX_SYMBOL` | Symbol for integration tests (default: `BTC-USD`) |
| `BITUNIX_ORDER_QTY` | Min quantity for order placement integration tests |

---

## Authentication

All private endpoints require HMAC-SHA256 signature. Headers sent per request:

| Header | Value |
|---|---|
| `api-key` | Your API key |
| `nonce` | Random 32-char string (unique per request) |
| `timestamp` | Unix timestamp in milliseconds |
| `sign` | `HMAC-SHA256(nonce + timestamp + apiKey + queryString + body, secretKey)` |

See `bitunixAuth.ts` → `createAuthPayload()` for the canonical implementation.

---

## Rate Limits

| Endpoint type | Limit |
|---|---|
| Public (market data) | 20 req/s |
| Private (authenticated) | 10 req/s |

The adapter uses a token-bucket limiter per type. Exceeding the limit blocks the call (does not drop it) until a token is available.

---

## All Verified API Endpoints

> All paths below are **browser-verified** against the live Bitunix OpenAPI docs.

### Market API — `BitunixMarketApi`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/futures/market/kline` | Candlestick / kline data |
| `GET` | `/api/v1/futures/market/tickers` | Latest ticker (price, vol, funding) |
| `GET` | `/api/v1/futures/market/depth` | Order book depth snapshot |
| `GET` | `/api/v1/futures/market/funding_rate` | Funding rate for one symbol |
| `GET` | `/api/v1/futures/market/funding_rate/batch` | Funding rates for multiple symbols |
| `GET` | `/api/v1/futures/market/trading_pairs` | All tradable symbols and specs |

### Trade API — `BitunixTradeApi`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/futures/trade/place_order` | Place a single order |
| `POST` | `/api/v1/futures/trade/cancel_orders` | Cancel one or more orders by ID |
| `POST` | `/api/v1/futures/trade/cancel_all_orders` | Cancel all open orders for a symbol |
| `POST` | `/api/v1/futures/trade/modify_order` | Modify price/qty of a pending order |
| `GET` | `/api/v1/futures/trade/get_order_detail` | Get a single order by orderId |
| `GET` | `/api/v1/futures/trade/get_pending_orders` | List all open/pending orders |
| `GET` | `/api/v1/futures/trade/get_history_orders` | Paginated order history |
| `GET` | `/api/v1/futures/trade/get_history_trades` | Paginated fill/execution history |
| `POST` | `/api/v1/futures/trade/batch_order` | Place multiple orders at once |
| `POST` | `/api/v1/futures/trade/flash_close_position` | Market-close a specific position |
| `POST` | `/api/v1/futures/trade/close_all_position` | Market-close all positions for a symbol |

### Account API — `BitunixAccountApi`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/futures/account` | Single account balance snapshot |
| `GET` | `/api/v1/futures/account/get_leverage_margin_mode` | Current leverage and margin mode |
| `POST` | `/api/v1/futures/account/change_leverage` | Set leverage for a symbol |
| `POST` | `/api/v1/futures/account/change_margin_mode` | Switch between cross/isolated margin |
| `POST` | `/api/v1/futures/account/change_position_mode` | Switch between one-way/hedge mode |
| `POST` | `/api/v1/futures/account/adjust_position_margin` | Add/remove isolated margin |

### Position API — `BitunixPositionApi`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/futures/position/get_pending_positions` | All currently open positions |
| `GET` | `/api/v1/futures/position/get_history_positions` | Closed/archived positions |
| `GET` | `/api/v1/futures/position/get_position_tiers` | Margin bracket tiers for a symbol |

### TP/SL API — `BitunixTpSlApi`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/futures/tpsl/place_order` | Place a standalone TP or SL trigger order |
| `POST` | `/api/v1/futures/tpsl/position/place_order` | Attach bracket TP/SL to an open position |
| `GET` | `/api/v1/futures/tpsl/get_pending_orders` | List active TP/SL orders |
| `GET` | `/api/v1/futures/tpsl/get_history_orders` | History of triggered/cancelled TP/SL |
| `POST` | `/api/v1/futures/tpsl/cancel_order` | Cancel a TP/SL order |
| `POST` | `/api/v1/futures/tpsl/modify_order` | Modify trigger price/qty of TP/SL order |
| `POST` | `/api/v1/futures/tpsl/position/modify_order` | Modify position-level TP/SL prices |

### Asset API (Copy Trading) — `BitunixAssetApi`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/cp/asset/query` | Query sub-account asset balances |
| `POST` | `/api/v1/cp/asset/transfer-to-sub-account` | Transfer from main account to sub-account |
| `POST` | `/api/v1/cp/asset/transfer-to-main-account` | Transfer from sub-account to main account |

> **Important**: `assetType` is a **required** string parameter on both transfer endpoints.  
> Valid values: `"FUTURES"` or `"SPOT"`. The value determines which pool the funds come from/go to.

---

## Error Handling

### Internal Error Codes (`ExchangeErrorCode`)

| Code | Meaning |
|---|---|
| `AUTH_ERROR` | Invalid API key or signature |
| `PERMISSION_DENIED` | Key lacks required permissions |
| `RATE_LIMIT` | Too many requests |
| `INSUFFICIENT_BALANCE` | Not enough funds to place order |
| `INVALID_SYMBOL` | Unrecognised trading pair |
| `INVALID_PARAMETER` | Bad request parameter value |
| `INVALID_ORDER` | Order violates exchange rules |
| `ORDER_NOT_FOUND` | No order with given ID |
| `NO_POSITION` | No open position to act on |
| `CIRCUIT_OPEN` | Circuit breaker tripped (5 consecutive failures) |
| `CONNECTION_ERROR` | TCP/WebSocket connection failed |
| `NETWORK_ERROR` | HTTP transport failure |
| `SERVICE_UNAVAILABLE` | Exchange 5xx response |
| `UNSUPPORTED` | Market or endpoint not supported |
| `UNSUPPORTED_OPERATION` | Operation not valid for this adapter/mode |
| `INTERNAL_ERROR` | Unexpected parsing or logic failure |

### Circuit Breaker

The `BitunixClient` wraps every REST call in a circuit breaker:

- **Threshold**: trips after **5 consecutive** transport/service failures
- **Cooldown**: **60 seconds** before moving to `half-open`
- **States**: `closed` → `open` → `half-open` → `closed`
- Client-side errors (invalid param, insufficient balance, rate limit) do **not** count toward the breaker

### WebSocket Reconnect

- Heartbeat check every **30 seconds**
- Disconnects if no message received in **60 seconds**
- Reconnect uses exponential backoff, capped at **60 seconds**, max **10 attempts**
- Falls back to REST market data polling when WebSocket is unhealthy

---

## Symbol Format

The adapter uses a **canonical format** internally (`BTC-USD`) and converts to Bitunix's format (`BTCUSDT`) before sending requests.

Conversion rules (see `bitunixSymbolMapper.ts`):
- Strip `-` separator
- Replace `USD` quote with `USDT`
- Uppercase everything

---

## `IExchangeAdapter` — Public Interface

The `BitunixAdapter` implements `IExchangeAdapter`, which all exchange adapters must satisfy:

```typescript
interface IExchangeAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;

  getLatestCandles(args?: { limit?: number }): Promise<ExchangeCandle[]>;
  subscribeToCandles(args: { onCandles, onError? }): Promise<() => void>;
  getLastPrice(): Promise<number>;

  getBalance(): Promise<Balance>;
  getPosition(): Promise<Position | null>;

  placeMarketOrder(args: { side, quantity }): Promise<Order>;
  placeLimitOrder(args: { side, quantity, price }): Promise<Order>;
  placeStopLossOrder(args: { side, quantity, stopPrice }): Promise<Order>;
  placeTakeProfitOrder(args: { side, quantity, takeProfitPrice }): Promise<Order>;

  cancelOrder(orderId: string): Promise<Order>;
  getOrder(orderId: string): Promise<Order | null>;
  getOpenOrders(): Promise<Order[]>;

  getRateLimitStatus(): Promise<RateLimitStatus>;
}
```

---

## Testing

### Unit Tests
```bash
npm run test:core -- BitunixAdapter.unit.test.ts
```
Covers all 6 API sub-modules with mocked HTTP interceptors. **78 tests.**

### Contract Tests
```bash
npm run test:core -- BitunixAdapter.contract.test.ts
```
Validates fixture JSON shapes against parser schemas. **61 tests.**

### Integration Tests (requires live credentials — ⚠️ uses real production API)
```bash
BITUNIX_API_KEY=... BITUNIX_SECRET_KEY=... npm run test:core -- BitunixAdapter.integration.test.ts
```
Hits the live Bitunix API. Skipped automatically if `BITUNIX_API_KEY` is absent. **Use with caution** — Bitunix has no testnet.

---

## Related Docs

- [24-live-trading-implementation.md](./24-live-trading-implementation.md) — Bot lifecycle, CLI commands, deployment
- [37-exchange-error-handling.md](./exchange-error-handling.md) — Error handling deep dive
- [35-migration-plan.md](./35-migration-plan.md) — Migration plan from paper trading to live
- [32-deployment-guide.md](./deployment-guide.md) — Deployment to Render
