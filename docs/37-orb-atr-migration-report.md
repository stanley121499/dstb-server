# ORB-ATR Migration Report

## Overview
This report documents the migration of the ORB-ATR strategy from `apps/api/src/strategy/orbAtrStrategy.ts` to the new plugin system under `src/strategies/`, and records the baseline comparison status.

## Baseline Source
- Provided baseline file: `apps/api/optimization-results/run2.jsonl`
- Status: Available (JSONL, optimization output).

## Migration Summary
- Strategy logic moved into `src/strategies/orb-atr.ts` with supporting helpers in `src/strategies/helpers/`.
- Session handling remains DST-aware using `America/New_York` timezone rules.
- ATR computation uses Wilder smoothing and matches the original state update logic.
- Entry/exit rules match the original ORB-ATR logic, including ATR filters and time-based exits.

## Backtest Comparison
Baseline parameters in `run2.jsonl` include:
- `interval`: `15m` / `30m` / `5m` / `1h`
- `entryMode`: `close_confirm`
- `directionMode`: `long_only`
- `openingRangeMinutes`: `5`
- `atrLength`: `10`
- `timeExitMode`: `disabled` (with some runs using `sessionEndTime` variants)

The new configs in `configs/strategies/` use different defaults (e.g., `openingRangeMinutes` 30/60, `atrLength` 14), so a direct ±1% comparison requires a new backtest using the same parameters from the baseline file.

To complete the comparison, run the new ORB strategy with a matching parameter set from `apps/api/optimization-results/run2.jsonl`, then record the resulting metrics beside the baseline values.

## Validation Status
- ORB-ATR strategy migrated to plugin interface.
- Unit tests added for ATR, session handling, opening range, and entry/exit signals.
- Backtest parity pending baseline file availability.
