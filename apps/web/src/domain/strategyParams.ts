/**
 * Strategy parameter schema for ORB + ATR.
 *
 * Source of truth: `docs/12-strategy-orb-atr.md`.
 *
 * Notes:
 * - This is a UI+API contract object. We validate it before saving/sending to backend.
 * - Use single-select for mutually exclusive modes, toggles for independent features.
 */

export type SymbolId = "BTC-USD" | "ETH-USD";

export type IntervalId =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "90m"
  | "1h"
  | "1d";

export type DirectionMode = "long_only" | "short_only" | "long_short";

export type EntryMode = "stop_breakout" | "close_confirm";

export type SizingMode = "fixed_notional" | "fixed_risk_pct";

export type StopMode = "or_opposite" | "or_midpoint" | "atr_multiple";

export type TakeProfitMode = "disabled" | "r_multiple";

export type TrailingStopMode = "disabled" | "atr_trailing";

export type TimeExitMode = "disabled" | "bars_after_entry" | "session_end";

export type StrategyParams = Readonly<{
  version: "1.0";
  symbol: SymbolId;
  interval: IntervalId;
  session: Readonly<{
    timezone: "America/New_York";
    startTime: "09:30";
    openingRangeMinutes: 5 | 15 | 30 | 60;
  }>;
  entry: Readonly<{
    directionMode: DirectionMode;
    entryMode: EntryMode;
    breakoutBufferBps: number;
    maxTradesPerSession: 1 | 2;
  }>;
  atr: Readonly<{
    atrLength: number;
    atrFilter: Readonly<{
      enabled: boolean;
      minAtrBps: number;
      maxAtrBps: number;
    }>;
  }>;
  risk: Readonly<{
    sizingMode: SizingMode;
    riskPctPerTrade: number;
    fixedNotional: number;

    stopMode: StopMode;
    atrStopMultiple: number;

    takeProfitMode: TakeProfitMode;
    tpRMultiple: number;

    trailingStopMode: TrailingStopMode;
    atrTrailMultiple: number;

    timeExitMode: TimeExitMode;
    barsAfterEntry: number;
    sessionEndTime: string;
  }>;
  execution: Readonly<{
    feeBps: number;
    slippageBps: number;
  }>;
}>;

export type ValidationIssue = Readonly<{
  path: string;
  message: string;
}>;

export const SUPPORTED_SYMBOLS: readonly SymbolId[] = ["BTC-USD", "ETH-USD"] as const;

export const SUPPORTED_INTERVALS: readonly IntervalId[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "60m",
  "90m",
  "1h",
  "1d"
] as const;

/**
 * Creates the recommended defaults from `docs/12-strategy-orb-atr.md`.
 */
export function createDefaultStrategyParams(): StrategyParams {
  return {
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
      breakoutBufferBps: 0,
      maxTradesPerSession: 1
    },
    atr: {
      atrLength: 14,
      atrFilter: {
        enabled: false,
        minAtrBps: 0,
        maxAtrBps: 1000
      }
    },
    risk: {
      sizingMode: "fixed_risk_pct",
      riskPctPerTrade: 0.5,
      fixedNotional: 1000,

      stopMode: "atr_multiple",
      atrStopMultiple: 1.5,

      takeProfitMode: "r_multiple",
      tpRMultiple: 2.0,

      trailingStopMode: "disabled",
      atrTrailMultiple: 1.5,

      timeExitMode: "disabled",
      barsAfterEntry: 0,
      sessionEndTime: "16:00"
    },
    execution: {
      feeBps: 10,
      slippageBps: 10
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProp(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function isIntervalId(value: unknown): value is IntervalId {
  return (
    value === "1m" ||
    value === "2m" ||
    value === "5m" ||
    value === "15m" ||
    value === "30m" ||
    value === "60m" ||
    value === "90m" ||
    value === "1h" ||
    value === "1d"
  );
}

function isSymbolId(value: unknown): value is SymbolId {
  return value === "BTC-USD" || value === "ETH-USD";
}

/**
 * Best-effort runtime parse of `StrategyParams` from unknown JSON.
 *
 * This is used for:
 * - rendering stored parameter sets
 * - duplicating a parameter set
 */
export function parseStrategyParams(value: unknown): StrategyParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = getProp(value, "version");
  const symbol = getProp(value, "symbol");
  const interval = getProp(value, "interval");
  const session = getProp(value, "session");
  const entry = getProp(value, "entry");
  const atr = getProp(value, "atr");
  const risk = getProp(value, "risk");
  const execution = getProp(value, "execution");

  if (version !== "1.0" || !isSymbolId(symbol) || !isIntervalId(interval)) {
    return null;
  }

  if (!isRecord(session) || !isRecord(entry) || !isRecord(atr) || !isRecord(risk) || !isRecord(execution)) {
    return null;
  }

  const timezone = getProp(session, "timezone");
  const startTime = getProp(session, "startTime");
  const openingRangeMinutes = getProp(session, "openingRangeMinutes");

  if (timezone !== "America/New_York" || startTime !== "09:30") {
    return null;
  }

  if (openingRangeMinutes !== 5 && openingRangeMinutes !== 15 && openingRangeMinutes !== 30 && openingRangeMinutes !== 60) {
    return null;
  }

  const directionMode = getProp(entry, "directionMode");
  const entryMode = getProp(entry, "entryMode");
  const breakoutBufferBps = getProp(entry, "breakoutBufferBps");
  const maxTradesPerSession = getProp(entry, "maxTradesPerSession");

  if (directionMode !== "long_only" && directionMode !== "short_only" && directionMode !== "long_short") {
    return null;
  }

  if (entryMode !== "stop_breakout" && entryMode !== "close_confirm") {
    return null;
  }

  if (typeof breakoutBufferBps !== "number" || (maxTradesPerSession !== 1 && maxTradesPerSession !== 2)) {
    return null;
  }

  const atrLength = getProp(atr, "atrLength");
  const atrFilter = getProp(atr, "atrFilter");

  if (typeof atrLength !== "number" || !isRecord(atrFilter)) {
    return null;
  }

  const atrFilterEnabled = getProp(atrFilter, "enabled");
  const minAtrBps = getProp(atrFilter, "minAtrBps");
  const maxAtrBps = getProp(atrFilter, "maxAtrBps");

  if (typeof atrFilterEnabled !== "boolean" || typeof minAtrBps !== "number" || typeof maxAtrBps !== "number") {
    return null;
  }

  const sizingMode = getProp(risk, "sizingMode");
  const riskPctPerTrade = getProp(risk, "riskPctPerTrade");
  const fixedNotional = getProp(risk, "fixedNotional");
  const stopMode = getProp(risk, "stopMode");
  const atrStopMultiple = getProp(risk, "atrStopMultiple");
  const takeProfitMode = getProp(risk, "takeProfitMode");
  const tpRMultiple = getProp(risk, "tpRMultiple");
  const trailingStopMode = getProp(risk, "trailingStopMode");
  const atrTrailMultiple = getProp(risk, "atrTrailMultiple");
  const timeExitMode = getProp(risk, "timeExitMode");
  const barsAfterEntry = getProp(risk, "barsAfterEntry");
  const sessionEndTime = getProp(risk, "sessionEndTime");

  if (sizingMode !== "fixed_notional" && sizingMode !== "fixed_risk_pct") {
    return null;
  }

  if (typeof riskPctPerTrade !== "number" || typeof fixedNotional !== "number") {
    return null;
  }

  if (stopMode !== "or_opposite" && stopMode !== "or_midpoint" && stopMode !== "atr_multiple") {
    return null;
  }

  if (typeof atrStopMultiple !== "number") {
    return null;
  }

  if (takeProfitMode !== "disabled" && takeProfitMode !== "r_multiple") {
    return null;
  }

  if (typeof tpRMultiple !== "number") {
    return null;
  }

  if (trailingStopMode !== "disabled" && trailingStopMode !== "atr_trailing") {
    return null;
  }

  if (typeof atrTrailMultiple !== "number") {
    return null;
  }

  if (timeExitMode !== "disabled" && timeExitMode !== "bars_after_entry" && timeExitMode !== "session_end") {
    return null;
  }

  if (typeof barsAfterEntry !== "number" || typeof sessionEndTime !== "string") {
    return null;
  }

  const feeBps = getProp(execution, "feeBps");
  const slippageBps = getProp(execution, "slippageBps");

  if (typeof feeBps !== "number" || typeof slippageBps !== "number") {
    return null;
  }

  const parsed: StrategyParams = {
    version: "1.0",
    symbol,
    interval,
    session: {
      timezone: "America/New_York",
      startTime: "09:30",
      openingRangeMinutes
    },
    entry: {
      directionMode,
      entryMode,
      breakoutBufferBps,
      maxTradesPerSession
    },
    atr: {
      atrLength,
      atrFilter: {
        enabled: atrFilterEnabled,
        minAtrBps,
        maxAtrBps
      }
    },
    risk: {
      sizingMode,
      riskPctPerTrade,
      fixedNotional,
      stopMode,
      atrStopMultiple,
      takeProfitMode,
      tpRMultiple,
      trailingStopMode,
      atrTrailMultiple,
      timeExitMode,
      barsAfterEntry,
      sessionEndTime
    },
    execution: {
      feeBps,
      slippageBps
    }
  };

  return parsed;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isNonNegative(value: number): boolean {
  return isFiniteNumber(value) && value >= 0;
}

function isPositive(value: number): boolean {
  return isFiniteNumber(value) && value > 0;
}

function isTimeHHMM(value: string): boolean {
  // 00:00 to 23:59
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Validates a `StrategyParams` object.
 *
 * @returns list of issues; empty means valid.
 */
export function validateStrategyParams(params: StrategyParams): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!SUPPORTED_SYMBOLS.includes(params.symbol)) {
    issues.push({ path: "symbol", message: "Unsupported symbol" });
  }

  if (!SUPPORTED_INTERVALS.includes(params.interval)) {
    issues.push({ path: "interval", message: "Unsupported interval" });
  }

  if (!isNonNegative(params.entry.breakoutBufferBps)) {
    issues.push({ path: "entry.breakoutBufferBps", message: "Must be >= 0" });
  }

  if (!isPositive(params.atr.atrLength)) {
    issues.push({ path: "atr.atrLength", message: "Must be > 0" });
  }

  if (params.atr.atrFilter.enabled) {
    if (!isNonNegative(params.atr.atrFilter.minAtrBps)) {
      issues.push({ path: "atr.atrFilter.minAtrBps", message: "Must be >= 0" });
    }

    if (!isNonNegative(params.atr.atrFilter.maxAtrBps)) {
      issues.push({ path: "atr.atrFilter.maxAtrBps", message: "Must be >= 0" });
    }

    if (params.atr.atrFilter.minAtrBps > params.atr.atrFilter.maxAtrBps) {
      issues.push({ path: "atr.atrFilter", message: "minAtrBps must be <= maxAtrBps" });
    }
  }

  if (params.risk.sizingMode === "fixed_risk_pct") {
    if (!isPositive(params.risk.riskPctPerTrade)) {
      issues.push({ path: "risk.riskPctPerTrade", message: "Must be > 0" });
    }
  }

  if (params.risk.sizingMode === "fixed_notional") {
    if (!isPositive(params.risk.fixedNotional)) {
      issues.push({ path: "risk.fixedNotional", message: "Must be > 0" });
    }
  }

  if (params.risk.stopMode === "atr_multiple") {
    if (!isPositive(params.risk.atrStopMultiple)) {
      issues.push({ path: "risk.atrStopMultiple", message: "Must be > 0" });
    }
  }

  if (params.risk.takeProfitMode === "r_multiple") {
    if (!isPositive(params.risk.tpRMultiple)) {
      issues.push({ path: "risk.tpRMultiple", message: "Must be > 0" });
    }
  }

  if (params.risk.trailingStopMode === "atr_trailing") {
    if (!isPositive(params.risk.atrTrailMultiple)) {
      issues.push({ path: "risk.atrTrailMultiple", message: "Must be > 0" });
    }
  }

  if (params.risk.timeExitMode === "bars_after_entry") {
    if (!isPositive(params.risk.barsAfterEntry)) {
      issues.push({ path: "risk.barsAfterEntry", message: "Must be > 0" });
    }
  }

  if (params.risk.timeExitMode === "session_end") {
    if (!isTimeHHMM(params.risk.sessionEndTime)) {
      issues.push({ path: "risk.sessionEndTime", message: "Must be HH:MM (24h)" });
    }
  }

  if (!isNonNegative(params.execution.feeBps)) {
    issues.push({ path: "execution.feeBps", message: "Must be >= 0" });
  }

  if (!isNonNegative(params.execution.slippageBps)) {
    issues.push({ path: "execution.slippageBps", message: "Must be >= 0" });
  }

  // UI-spec: ensure openingRangeMinutes aligns with interval (warn). We treat as a non-blocking warning.
  // For now we only validate that openingRangeMinutes is in the allowed set.

  return issues;
}
