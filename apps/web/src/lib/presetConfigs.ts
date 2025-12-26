import type { StrategyParams } from "../domain/strategyParams";

/**
 * Pre-configured strategy templates for quick start.
 *
 * Each preset is a complete, battle-tested configuration that users
 * can use as a starting point for their own backtests.
 */

export type PresetConfig = Readonly<{
  id: string;
  name: string;
  description: string;
  params: StrategyParams;
}>;

export const PRESET_CONFIGS: readonly PresetConfig[] = [
  {
    id: "conservative_orb",
    name: "Conservative ORB",
    description: "2R TP · 1.5x ATR stop · Long only · Moderate risk",
    params: {
      version: "1.0",
      symbol: "BTC-USD",
      interval: "5m",
      session: {
        timezone: "America/New_York",
        startTime: "09:30",
        openingRangeMinutes: 30
      },
      entry: {
        directionMode: "long_only",
        entryMode: "close_confirm",
        breakoutBufferBps: 5,
        maxTradesPerSession: 1
      },
      atr: {
        atrLength: 14,
        atrFilter: {
          enabled: true,
          minAtrBps: 50,
          maxAtrBps: 200
        }
      },
      risk: {
        sizingMode: "fixed_risk_pct",
        riskPctPerTrade: 1.0,
        fixedNotional: 1000,
        stopMode: "atr_multiple",
        atrStopMultiple: 1.5,
        takeProfitMode: "r_multiple",
        tpRMultiple: 2.0,
        trailingStopMode: "disabled",
        atrTrailMultiple: 1.0,
        timeExitMode: "session_end",
        sessionEndTime: "16:00",
        barsAfterEntry: 0
      },
      execution: {
        feeBps: 10,
        slippageBps: 10
      }
    }
  },
  {
    id: "aggressive_breakout",
    name: "Aggressive Breakout",
    description: "3R TP · Trailing stop · Long + Short · Higher risk",
    params: {
      version: "1.0",
      symbol: "BTC-USD",
      interval: "5m",
      session: {
        timezone: "America/New_York",
        startTime: "09:30",
        openingRangeMinutes: 15
      },
      entry: {
        directionMode: "long_short",
        entryMode: "stop_breakout",
        breakoutBufferBps: 10,
        maxTradesPerSession: 2
      },
      atr: {
        atrLength: 10,
        atrFilter: {
          enabled: true,
          minAtrBps: 75,
          maxAtrBps: 300
        }
      },
      risk: {
        sizingMode: "fixed_risk_pct",
        riskPctPerTrade: 2.0,
        fixedNotional: 1000,
        stopMode: "atr_multiple",
        atrStopMultiple: 2.0,
        takeProfitMode: "r_multiple",
        tpRMultiple: 3.0,
        trailingStopMode: "atr_trailing",
        atrTrailMultiple: 1.5,
        timeExitMode: "session_end",
        sessionEndTime: "16:00",
        barsAfterEntry: 0
      },
      execution: {
        feeBps: 10,
        slippageBps: 15
      }
    }
  },
  {
    id: "scalping",
    name: "Quick Scalp",
    description: "1R TP · Tight stops · 2 trades/session · Fast exits",
    params: {
      version: "1.0",
      symbol: "BTC-USD",
      interval: "2m",
      session: {
        timezone: "America/New_York",
        startTime: "09:30",
        openingRangeMinutes: 15
      },
      entry: {
        directionMode: "long_short",
        entryMode: "stop_breakout",
        breakoutBufferBps: 3,
        maxTradesPerSession: 2
      },
      atr: {
        atrLength: 10,
        atrFilter: {
          enabled: true,
          minAtrBps: 60,
          maxAtrBps: 180
        }
      },
      risk: {
        sizingMode: "fixed_risk_pct",
        riskPctPerTrade: 0.5,
        fixedNotional: 500,
        stopMode: "atr_multiple",
        atrStopMultiple: 1.0,
        takeProfitMode: "r_multiple",
        tpRMultiple: 1.0,
        trailingStopMode: "disabled",
        atrTrailMultiple: 1.0,
        timeExitMode: "bars_after_entry",
        sessionEndTime: "16:00",
        barsAfterEntry: 20
      },
      execution: {
        feeBps: 8,
        slippageBps: 12
      }
    }
  },
  {
    id: "swing_trade",
    name: "Swing Trade",
    description: "4R TP · Wide stops · Session-end exit · Patient approach",
    params: {
      version: "1.0",
      symbol: "BTC-USD",
      interval: "15m",
      session: {
        timezone: "America/New_York",
        startTime: "09:30",
        openingRangeMinutes: 60
      },
      entry: {
        directionMode: "long_only",
        entryMode: "close_confirm",
        breakoutBufferBps: 8,
        maxTradesPerSession: 1
      },
      atr: {
        atrLength: 20,
        atrFilter: {
          enabled: true,
          minAtrBps: 40,
          maxAtrBps: 250
        }
      },
      risk: {
        sizingMode: "fixed_risk_pct",
        riskPctPerTrade: 1.5,
        fixedNotional: 2000,
        stopMode: "atr_multiple",
        atrStopMultiple: 3.0,
        takeProfitMode: "r_multiple",
        tpRMultiple: 4.0,
        trailingStopMode: "atr_trailing",
        atrTrailMultiple: 2.0,
        timeExitMode: "session_end",
        sessionEndTime: "16:00",
        barsAfterEntry: 0
      },
      execution: {
        feeBps: 10,
        slippageBps: 10
      }
    }
  }
] as const;



