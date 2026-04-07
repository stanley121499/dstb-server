# Exchange Error Handling (Bitunix)

## Overview

The Bitunix adapter is hardened to survive transient outages, rate limits, and WebSocket disconnects. It uses:
- WebSocket reconnection with heartbeat monitoring.
- REST fallbacks when streaming data is unavailable.
- A circuit breaker to prevent cascaded failures.
- Order confirmation polling to avoid stale order states.

## Error Code Mapping

Bitunix REST responses include numeric error codes. The adapter maps those codes to internal `ExchangeErrorCode` values:
- Authentication and permission failures map to `AUTH_ERROR` or `PERMISSION_DENIED`.
- Rate limiting maps to `RATE_LIMIT`.
- Invalid order parameters map to `INVALID_ORDER`.
- Insufficient funds maps to `INSUFFICIENT_BALANCE`.
- Unsupported markets map to `UNSUPPORTED`.
- Network or transport issues map to `NETWORK_ERROR` or `CONNECTION_ERROR`.

The canonical mapping comes from the Bitunix error code documentation at `https://openapidoc.bitunix.com/doc/ErrorCode/error_code.html`.

## Circuit Breaker

The adapter includes a circuit breaker that opens after repeated transport/service failures:
- Failure threshold: 5.
- Cooldown: 60 seconds.
- State transitions: `closed` → `open` → `half-open` → `closed`.

When open, requests throw `ExchangeError` with code `CIRCUIT_OPEN`. Client-side errors (invalid order, insufficient balance, rate limits) do not count toward the breaker.

## WebSocket Heartbeat + Reconnect

The WebSocket layer tracks the time since the last inbound message:
- Heartbeat check interval: 30 seconds.
- Heartbeat timeout: 60 seconds.
- Reconnects use exponential backoff capped at 60 seconds and stop after 10 attempts.

## REST Fallbacks

Market data prefers WebSocket data when healthy. If the stream is unhealthy, the adapter logs a warning and falls back to REST.

## Order Confirmation Polling

Orders are confirmed by polling `get_order_detail` using `clientId` (and `orderId` if available):
- 10 attempts with 500ms delay.
- Returns the latest known state on timeout.
- Partial fills remain `pending` with non-zero `filledQuantity`.

## Testnet Integration Tests

The integration tests are skipped unless testnet credentials are provided:
- `BITUNIX_TESTNET_API_KEY`
- `BITUNIX_TESTNET_SECRET_KEY`
- `BITUNIX_TESTNET_SYMBOL` (optional, default `BTC-USD`)
- `BITUNIX_TESTNET_ORDER_QTY` (optional, required to run order placement test)
