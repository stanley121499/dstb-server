-- Phase 5: aggregate realized PnL for behavior ruleset comparison (fuzzy join helper)

CREATE OR REPLACE FUNCTION public.trades_realized_pnl_by_symbol_exit_utc_date(
  p_from date,
  p_to date
)
RETURNS TABLE (
  symbol text,
  exit_day date,
  total_pnl numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    t.symbol,
    (t.exit_time AT TIME ZONE 'UTC')::date AS exit_day,
    SUM(t.pnl)::numeric AS total_pnl
  FROM trades t
  WHERE (t.exit_time AT TIME ZONE 'UTC')::date >= p_from
    AND (t.exit_time AT TIME ZONE 'UTC')::date <= p_to
  GROUP BY t.symbol, (t.exit_time AT TIME ZONE 'UTC')::date;
$$;

GRANT EXECUTE ON FUNCTION public.trades_realized_pnl_by_symbol_exit_utc_date(date, date) TO authenticated;
