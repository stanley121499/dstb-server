# Docs (Source of Truth)

This `docs/` directory is the **source of truth** for building:

- A **backtesting platform** (Phase 1) for ORB + ATR on BTC/ETH using `yfinance`
- A **live trading platform** (Phase 2) using the same strategy/parameter model, controlled via a React UI

If a future AI agent implements anything, it should do so by following these docs, **not guessing**.

## Read order (recommended)

- `00-glossary.md`
- `01-overview.md`
- `10-requirements.md`
- `11-architecture.md`
- `12-strategy-orb-atr.md`
- `13-data-yfinance-and-intervals.md`
- `14-backtest-engine.md`
- `15-api-contracts.md`
- `16-ui-spec.md`
- `17-supabase-schema-and-migrations.md`
- `18-dev-standards.md`
- `19-roadmap.md`
- `20-monorepo-and-local-dev.md`
- `21-deployment-vercel-render.md`
- `22-ai-agent-prompts.md`
- `23-live-trading-exchange-selection.md`

## Non-goals (for now)

- Running a production-grade, multi-exchange execution stack on day 1.
- Parameter “curve fitting” without realistic fees/slippage and correct DST/session handling.


