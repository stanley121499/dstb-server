/**
 * Centralized help text and tooltips for the application.
 *
 * This provides consistent, informative guidance throughout the UI.
 */

export const helpText = {
  /** Strategy parameters */
  strategy: {
    atrLength: "Average True Range (ATR) lookback period. Typical values: 10-20 bars. Higher values = smoother but slower to react.",
    atrFilterMin: "Minimum ATR in basis points (bps) of price. 50 bps = 0.5% of price. Filters out low-volatility sessions.",
    atrFilterMax: "Maximum ATR in basis points (bps) of price. 200 bps = 2% of price. Filters out extremely volatile sessions.",
    riskPctPerTrade: "Percentage of equity to risk per trade. Conservative: 0.5-1%, Moderate: 1-2%, Aggressive: 2-5%.",
    fixedNotional: "Fixed dollar amount to trade per position. Example: 1000 = $1000 per trade regardless of stop distance.",
    atrStopMultiple: "Stop loss distance as a multiple of ATR. Typical: 1.5-3x. Higher = wider stops, fewer stop-outs.",
    tpRMultiple: "Take profit target as a multiple of initial risk (R). 2R = profit is 2x your risk. Common: 1.5-4R.",
    atrTrailMultiple: "Trailing stop distance as a multiple of ATR. Locks in profits as price moves favorably.",
    breakoutBuffer: "Extra distance beyond OR levels to confirm breakout. In basis points. 0 = breakout at exact OR level.",
    openingRangeMinutes: "Duration of opening range in minutes. Must be >= bar interval. Common: 15-30 mins for intraday.",
    feeBps: "Trading fees in basis points. 10 bps = 0.1% per side. Typical crypto: 5-10 bps, stocks: 0-5 bps.",
    slippageBps: "Price slippage in basis points. Accounts for execution lag. Conservative: 5-20 bps depending on liquidity.",
    sessionEndTime: "Time to close positions (America/New_York). Format: HH:MM (e.g., 16:00 for 4 PM ET)."
  },

  /** Metrics interpretation */
  metrics: {
    totalReturn: "Total portfolio return over the backtest period. Accounts for all fees and slippage.",
    winRate: "Percentage of trades that were profitable. Note: High win rate doesn't guarantee profitability.",
    profitFactor: "Ratio of gross profits to gross losses. >1.5 is good, >2.0 is excellent. <1.0 means net loss.",
    maxDrawdown: "Largest peak-to-trough decline in equity. Lower is better. Shows worst-case scenario risk.",
    sharpeRatio: "Risk-adjusted return measure. >1.0 is good, >2.0 is excellent. Higher = better return per unit of risk.",
    tradeCount: "Total number of trades executed. More trades = more statistical significance for metrics."
  },

  /** UI features */
  ui: {
    presets: "Pre-configured strategy templates. Click to auto-fill parameters with proven configurations.",
    recentRuns: "Your last 5 backtest runs. Click any to view detailed results.",
    websocketStatus: "Real-time connection status. Green = live updates, Gray = disconnected (will auto-retry)."
  }
} as const;



