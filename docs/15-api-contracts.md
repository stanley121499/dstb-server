# API Contracts (authoritative)

## Purpose

Define the API surface so backend and frontend can be built independently and consistently.

## Conventions

- JSON-only API.
- All request/response bodies must be validated (no implicit trust).
- IDs are UUIDs.
- Timestamps are ISO-8601 strings in UTC.

### Pagination (authoritative for v1)

All list endpoints use **offset/limit** pagination.

- Request query:
  - `offset` (integer, default 0, min 0)
  - `limit` (integer, default 50, min 1, max 500)

- Response shape:

```json
{
  "items": [],
  "total": 0,
  "offset": 0,
  "limit": 50
}
```

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

- paged response:
  - `{ items: ParameterSet[], total, offset, limit }`

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

#### List backtest runs

- `GET /v1/backtests?offset=0&limit=50`

Returns:

- paged response:
  - `{ items: BacktestRunSummary[], total, offset, limit }`

`BacktestRunSummary` is the subset of fields needed to populate lists/compare screens:

- `id` (UUID)
- `createdAt` (ISO UTC)
- `status` ("queued" | "running" | "completed" | "failed")
- `symbol` (string)
- `interval` (string)
- `startTimeUtc` (ISO UTC)
- `endTimeUtc` (ISO UTC)
- `tradeCount` (number, nullable until completed)
- `totalReturnPct` (number, nullable until completed)
- `maxDrawdownPct` (number, nullable until completed)
- `winRatePct` (number, nullable until completed)
- `profitFactor` (number, nullable until completed)

#### Get backtest trades

- `GET /v1/backtests/:runId/trades`

Returns:

- paged response:
  - `{ items: Trade[], total, offset, limit }`

#### Get equity curve

- `GET /v1/backtests/:runId/equity`

Returns:

- paged response (or compressed series):
  - `{ items: EquityPoint[], total, offset, limit }`

#### Compare runs

- `POST /v1/backtests/compare`

Request:

- `runIds` (array of UUID)

Returns:

- `BacktestCompareResponse` (authoritative):

```json
{
  "rows": [
    {
      "runId": "uuid",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "symbol": "BTC-USD",
      "interval": "5m",
      "status": "completed",
      "metrics": {
        "totalReturnPct": 1.23,
        "maxDrawdownPct": -0.45,
        "winRatePct": 52.0,
        "profitFactor": 1.4,
        "tradeCount": 18
      }
    }
  ]
}
```

Notes:

- Aligned equity overlays are optional and can be added later (not required for v1 DTOs).

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

`BacktestGridResponse` (authoritative):

```json
{
  "gridRunId": "uuid",
  "runIds": ["uuid", "uuid"]
}
```

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


