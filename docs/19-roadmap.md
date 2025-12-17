# Roadmap

## Milestone 0: Repo scaffolding

- Initialize backend project (Node + TypeScript)
- Initialize React UI project
- Set up Supabase project and local migration workflow
- Add CI (lint/test) once code exists

## Milestone 1: Backtest “thin slice” (minimum lovable)

End-to-end flow:

- Create a parameter set in UI
- Run a single backtest
- View results (metrics + trades + equity curve)

Engineering deliverables:

- Candle ingestion via `yfinance`
- DST-aware NY session and opening range computation
- ATR computation
- ORB entries + exits (at least one stop mode and one TP mode)
- Fee + slippage model
- Persist:
  - parameter sets
  - backtest run summaries
  - trades
  - events

## Milestone 2: Backtest robustness

- Grid runner (batch runs)
- Compare runs screen
- More exit options (trailing stop, time exit)
- Better data handling:
  - resampling rules
  - data-quality reports
- More metrics and charts

## Milestone 3: Live trading foundation

- Add bot tables to DB
- Bot lifecycle management endpoints
- Exchange adapter interface (no exchange hard-coded)
- Paper trading mode

## Milestone 4: Live trading MVP

- One exchange integration (**Luno**)
- Start/stop bots from UI
- Real-time status/logs
- Orders/fills persistence
- Basic alerts

## Milestone 5: Production hardening

- Multi-tenant auth/RLS (if needed)
- Rate limiting, retries, idempotency
- Monitoring/alerting
- Disaster recovery (backups, replay)


