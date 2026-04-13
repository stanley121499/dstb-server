# Phase 3 (v3) — implementation summary

**Date:** 2026-04-07  
**Scope:** Trade analytics + charts (v3 phase plan + dashboard spec §5–7).

## Shipped (code)

### Bot server

- **`trade_candles` on exit:** Optional `IExchangeAdapter.fetchTradeCandleBundlesForRange` ([`src/exchange/IExchangeAdapter.ts`](../../src/exchange/IExchangeAdapter.ts)); implemented on [`BitunixAdapter`](../../src/exchange/BitunixAdapter.ts) (15m / 1h / 4h via `BitunixMarketApi.getKline`, limit 200) and [`PaperTradingAdapter`](../../src/exchange/PaperTradingAdapter.ts) (Binance `fetchBinanceCandles`).
- **Helpers:** [`src/exchange/tradeExitChartCandles.ts`](../../src/exchange/tradeExitChartCandles.ts) — window filter ±20 bars, JSONB-safe candle records.
- **Persistence:** [`OrderExecutor.executeExit`](../../src/core/OrderExecutor.ts) fetches bundles after fill (non-blocking on failure), passes into `closePosition` → [`SupabaseStateStore`](../../src/core/SupabaseStateStore.ts) inserts `trade_candles` rows.
- **Intervals:** `4h` added to [`src/utils/interval.ts`](../../src/utils/interval.ts) for `intervalToMs`.

### Dashboard (`dashboard/`)

- **Dependency:** `lightweight-charts`.
- **Routes:** `/trades/[id]` (chart + metadata + config snapshot), `/analytics` (equity / drawdown / daily PnL / stats), `/analytics?view=compare` (per-config table).
- **Nav:** Analytics link in shell.
- **Trades list:** Exit time links to detail.
- **Libs:** `lib/tradeChart.ts`, `lib/analytics/compute.ts`, `lib/analytics/types.ts`; components `trade-detail-chart.tsx`, `analytics-charts.tsx`.

### Tests

- [`src/exchange/__tests__/tradeExitChartCandles.unit.test.ts`](../../src/exchange/__tests__/tradeExitChartCandles.unit.test.ts) (Vitest).

### Wiki (agent-maintained)

- Entity + synthesis + log updated under `dstb-docs/wiki/` and `dstb-docs/log.md` (see log for entry).

## Intentional limitations

- **Historical trades** closed before deploy have **no** `trade_candles` unless backfilled (script or manual job — not shipped).
- **Aggregate equity** on `/analytics` is a defined approximation (sum of per-config running equity on a merged timeline); multi-series is primary for interpretation.
- **Sharpe** on dashboard uses **daily bucketed PnL** variance (not true return-based Sharpe); labeled / documented as rough; `n/a` if fewer than 5 days.
- **Strategy filter** on analytics is applied **client-side** after fetch (PostgREST nested filter not used) — fine up to query limit (~8k rows).

## Related raw / plan docs

- [`2026-04-07-phase-plan-v3.md`](2026-04-07-phase-plan-v3.md)
- [`2026-04-07-dashboard-spec.md`](2026-04-07-dashboard-spec.md)
