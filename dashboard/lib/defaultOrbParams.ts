/**
 * Default ORB-ATR `configs.params` for "New config" (matches typical seed shape).
 */
export const DEFAULT_ORB_ATR_PARAMS_JSON = JSON.stringify(
  {
    version: "1.0",
    intervalMinutes: 15,
    session: {
      timezone: "America/New_York",
      startTime: "09:30",
      openingRangeMinutes: 30
    },
    entry: {
      directionMode: "long_short",
      entryMode: "stop_breakout",
      breakoutBufferBps: 0,
      maxTradesPerSession: 1
    },
    atr: {
      atrLength: 14,
      atrFilter: { enabled: false, minAtrBps: 0, maxAtrBps: 1000 }
    },
    risk: {
      sizingMode: "fixed_risk_pct",
      riskPctPerTrade: 0.5,
      fixedNotional: 0,
      stopMode: "atr_multiple",
      atrStopMultiple: 1.5,
      takeProfitMode: "r_multiple",
      tpRMultiple: 2,
      trailingStopMode: "disabled",
      atrTrailMultiple: 1.5,
      timeExitMode: "disabled",
      barsAfterEntry: 0,
      sessionEndTime: "16:00"
    },
    execution: { feeBps: 10, slippageBps: 10 }
  },
  null,
  2
);
