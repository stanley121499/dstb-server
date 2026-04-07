-- Seed `configs` from strategy JSON that lived under `configs/strategies/` in git (commit c545469).
-- `eth-live-v3.json` was never committed; the Bitunix row below matches `configs/examples/eth-live-v3.example.json`.
-- If your local eth-live file differed, UPDATE that row in Supabase after migrate.
--
-- All rows start with enabled = false — set enabled = true in Studio (or UPDATE) when ready.

INSERT INTO public.configs (
  name,
  strategy,
  symbol,
  interval,
  exchange,
  initial_balance,
  params,
  risk_mgmt,
  credentials_ref,
  enabled,
  current_version
)
VALUES
  (
    'ORB BTC 15m',
    'orb-atr',
    'BTC-USD',
    '15m',
    'paper',
    10000,
    $p1${
      "version": "1.0",
      "intervalMinutes": 15,
      "session": {
        "timezone": "America/New_York",
        "startTime": "09:30",
        "openingRangeMinutes": 30
      },
      "entry": {
        "directionMode": "long_short",
        "entryMode": "stop_breakout",
        "breakoutBufferBps": 0,
        "maxTradesPerSession": 1
      },
      "atr": {
        "atrLength": 14,
        "atrFilter": {
          "enabled": false,
          "minAtrBps": 0,
          "maxAtrBps": 1000
        }
      },
      "risk": {
        "sizingMode": "fixed_risk_pct",
        "riskPctPerTrade": 0.5,
        "fixedNotional": 0,
        "stopMode": "atr_multiple",
        "atrStopMultiple": 1.5,
        "takeProfitMode": "r_multiple",
        "tpRMultiple": 2,
        "trailingStopMode": "disabled",
        "atrTrailMultiple": 1.5,
        "timeExitMode": "disabled",
        "barsAfterEntry": 0,
        "sessionEndTime": "16:00"
      },
      "execution": {
        "feeBps": 10,
        "slippageBps": 10
      }
    }$p1$::jsonb,
    '{"maxDailyLossPct": 5, "maxPositionSizePct": 100}'::jsonb,
    '{}'::jsonb,
    false,
    1
  ),
  (
    'ORB ETH 1h',
    'orb-atr',
    'ETH-USD',
    '1h',
    'paper',
    10000,
    $p2${
      "version": "1.0",
      "intervalMinutes": 60,
      "session": {
        "timezone": "America/New_York",
        "startTime": "09:30",
        "openingRangeMinutes": 60
      },
      "entry": {
        "directionMode": "long_short",
        "entryMode": "stop_breakout",
        "breakoutBufferBps": 0,
        "maxTradesPerSession": 1
      },
      "atr": {
        "atrLength": 14,
        "atrFilter": {
          "enabled": false,
          "minAtrBps": 0,
          "maxAtrBps": 1000
        }
      },
      "risk": {
        "sizingMode": "fixed_risk_pct",
        "riskPctPerTrade": 0.5,
        "fixedNotional": 0,
        "stopMode": "atr_multiple",
        "atrStopMultiple": 1.5,
        "takeProfitMode": "r_multiple",
        "tpRMultiple": 2,
        "trailingStopMode": "disabled",
        "atrTrailMultiple": 1.5,
        "timeExitMode": "disabled",
        "barsAfterEntry": 0,
        "sessionEndTime": "16:00"
      },
      "execution": {
        "feeBps": 10,
        "slippageBps": 10
      }
    }$p2$::jsonb,
    '{"maxDailyLossPct": 5, "maxPositionSizePct": 100}'::jsonb,
    '{}'::jsonb,
    false,
    1
  ),
  (
    'SMA Crossover BTC 15m',
    'sma-crossover',
    'BTC-USD',
    '15m',
    'paper',
    5000,
    '{"fastPeriod": 10, "slowPeriod": 30}'::jsonb,
    '{"maxDailyLossPct": 5, "maxPositionSizePct": 100}'::jsonb,
    '{}'::jsonb,
    false,
    1
  ),
  (
    'ETH Live Bot v3',
    'orb-atr',
    'ETH-USD',
    '15m',
    'bitunix',
    500,
    $p4${
      "version": "1.0",
      "intervalMinutes": 15,
      "session": {
        "timezone": "America/New_York",
        "startTime": "09:30",
        "openingRangeMinutes": 30
      },
      "entry": {
        "directionMode": "long_short",
        "entryMode": "stop_breakout",
        "breakoutBufferBps": 5,
        "maxTradesPerSession": 2
      },
      "atr": {
        "atrLength": 14,
        "atrFilter": {
          "enabled": false,
          "minAtrBps": 0,
          "maxAtrBps": 1000
        }
      },
      "risk": {
        "sizingMode": "fixed_risk_pct",
        "riskPctPerTrade": 1.0,
        "fixedNotional": 0,
        "stopMode": "atr_multiple",
        "atrStopMultiple": 2.0,
        "takeProfitMode": "r_multiple",
        "tpRMultiple": 3.0,
        "trailingStopMode": "disabled",
        "atrTrailMultiple": 1.5,
        "timeExitMode": "disabled",
        "barsAfterEntry": 0,
        "sessionEndTime": "16:00"
      },
      "execution": {
        "feeBps": 10,
        "slippageBps": 10
      }
    }$p4$::jsonb,
    '{"maxDailyLossPct": 10, "maxPositionSizePct": 50}'::jsonb,
    $c4${
      "apiKey": "${BITUNIX_API_KEY}",
      "secretKey": "${BITUNIX_SECRET_KEY}",
      "testMode": false,
      "marketType": "futures"
    }$c4$::jsonb,
    false,
    1
  )
ON CONFLICT (name, symbol) DO NOTHING;
