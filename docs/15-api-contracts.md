# API Contracts (authoritative)

## Purpose

Define the API surface so backend and frontend can be built independently and consistently.

## Conventions

- JSON-only API.
- All request/response bodies must be validated (no implicit trust).
- IDs are UUIDs.
- Timestamps are ISO-8601 strings in UTC.

## Entities

- `ParameterSet`
- `BacktestRun`
- `Trade`
- `EquityPoint`
- (Phase 2) `Bot`, `BotRun`, `Order`, `Fill`, `Position`, `BotEvent`

## Endpoints (Phase 1)

### Parameter sets

#### Create parameter set

- `POST /v1/parameter-sets`

Request:

- `name` (string)
- `description` (string, optional)
- `params` (object matching schema in `12-strategy-orb-atr.md`)

Response:

- full `ParameterSet`

#### List parameter sets

- `GET /v1/parameter-sets`

Response:

- array of `ParameterSet` (paged)

#### Get parameter set

- `GET /v1/parameter-sets/:id`

### Backtests

#### Run a backtest

- `POST /v1/backtests`

Request:

- `parameterSetId` (UUID) OR `params` (inline params object)
- `symbol` (string, e.g., "BTC-USD")
- `interval` (string, e.g., "5m")
- `startTimeUtc` (ISO string)
- `endTimeUtc` (ISO string)
- `initialEquity` (number, optional)

Response (sync):

- `BacktestRun` summary + `status = "completed"`

Response (async, recommended):

- `BacktestRun` summary + `status = "queued" | "running"`

#### Get backtest run

- `GET /v1/backtests/:runId`

Returns:

- run metadata, status, summary metrics

#### Get backtest trades

- `GET /v1/backtests/:runId/trades`

Returns:

- paged trades

#### Get equity curve

- `GET /v1/backtests/:runId/equity`

Returns:

- array of equity points (possibly compressed)

#### Compare runs

- `POST /v1/backtests/compare`

Request:

- `runIds` (array of UUID)

Returns:

- comparison table of summary metrics + optional aligned equity series

### Grid runs (batch backtests)

#### Run a grid

- `POST /v1/backtests/grid`

Request:

- base params
- parameter overrides (cartesian product)
- symbol(s)
- interval(s)
- date range

Returns:

- `gridRunId` and list of created `BacktestRun` IDs

Notes:

- No explicit grid-size cap is required for v1.
- Implementation should still run grids asynchronously and report progress/status to avoid request timeouts.

## Endpoints (Phase 2 - future)

### Bots

- `POST /v1/bots` (create)
- `POST /v1/bots/:id/start`
- `POST /v1/bots/:id/stop`
- `GET /v1/bots` (list)
- `GET /v1/bots/:id` (detail)
- `GET /v1/bots/:id/logs` (stream or paged)

## Error format (authoritative)

All errors return:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable summary",
    "details": [
      { "path": "params.session.openingRangeMinutes", "message": "Must be >= 1" }
    ]
  }
}
```


