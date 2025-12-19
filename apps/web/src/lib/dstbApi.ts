import { fetchJson, type OffsetLimitPage } from "./apiClient";
import { getRecordProp, isIsoUtcString, isRecord, isString } from "./typeGuards";

import type { StrategyParams } from "../domain/strategyParams";

export type BacktestStatus = "queued" | "running" | "completed" | "failed";

export type ParameterSet = Readonly<{
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description: string | null;
  paramsVersion: string;
  params: unknown;
}>;

export type BacktestRunSummary = Readonly<{
  id: string;
  createdAt: string;
  status: BacktestStatus;
  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  tradeCount: number | null;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
}>;

export type BacktestRunDetail = Readonly<{
  id: string;
  createdAt: string;
  status: BacktestStatus;
  parameterSetId: string | null;
  paramsSnapshot: unknown;
  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  initialEquity: number;
  finalEquity: number | null;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  tradeCount: number | null;
  errorMessage: string | null;
}>;

export type Trade = Readonly<{
  id: string;
  sessionDateNy: string;
  direction: "long" | "short";
  entryTimeUtc: string;
  entryPrice: number;
  exitTimeUtc: string;
  exitPrice: number;
  quantity: number;
  feeTotal: number;
  pnl: number;
  rMultiple: number | null;
  exitReason: string;
}>;

export type EquityPoint = Readonly<{
  timeUtc: string;
  equity: number;
}>;

export type BacktestCompareRow = Readonly<{
  runId: string;
  createdAt: string;
  symbol: string;
  interval: string;
  status: BacktestStatus;
  metrics: Readonly<{
    totalReturnPct: number | null;
    maxDrawdownPct: number | null;
    winRatePct: number | null;
    profitFactor: number | null;
    tradeCount: number | null;
  }>;
}>;

export type BacktestCompareResponse = Readonly<{
  rows: readonly BacktestCompareRow[];
}>;

function isBacktestStatus(value: unknown): value is BacktestStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed";
}

function isNumberOrNull(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function parseOffsetLimitPage<T>(value: unknown, parseItem: (v: unknown) => T | null): OffsetLimitPage<T> {
  if (!isRecord(value)) {
    throw new Error("Invalid API response (expected object)");
  }

  const itemsV = getRecordProp(value, "items");
  const totalV = getRecordProp(value, "total");
  const offsetV = getRecordProp(value, "offset");
  const limitV = getRecordProp(value, "limit");

  if (!Array.isArray(itemsV) || typeof totalV !== "number" || typeof offsetV !== "number" || typeof limitV !== "number") {
    throw new Error("Invalid paged response shape");
  }

  const parsedItems: T[] = itemsV.map((it) => parseItem(it)).filter((it): it is T => it !== null);

  return {
    items: parsedItems,
    total: totalV,
    offset: offsetV,
    limit: limitV
  };
}

function parseParameterSet(value: unknown): ParameterSet | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = getRecordProp(value, "id");
  const createdAt = getRecordProp(value, "createdAt");
  const updatedAt = getRecordProp(value, "updatedAt");
  const name = getRecordProp(value, "name");
  const description = getRecordProp(value, "description");
  const paramsVersion = getRecordProp(value, "paramsVersion");
  const params = getRecordProp(value, "params");

  if (!isString(id) || !isIsoUtcString(createdAt) || !isIsoUtcString(updatedAt) || !isString(name) || !isString(paramsVersion)) {
    return null;
  }

  if (!(description === null || isString(description) || description === undefined)) {
    return null;
  }

  return {
    id,
    createdAt,
    updatedAt,
    name,
    description: description === undefined ? null : description,
    paramsVersion,
    params
  };
}

function parseBacktestRunSummary(value: unknown): BacktestRunSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = getRecordProp(value, "id");
  const createdAt = getRecordProp(value, "createdAt");
  const status = getRecordProp(value, "status");
  const symbol = getRecordProp(value, "symbol");
  const interval = getRecordProp(value, "interval");
  const startTimeUtc = getRecordProp(value, "startTimeUtc");
  const endTimeUtc = getRecordProp(value, "endTimeUtc");

  const tradeCount = getRecordProp(value, "tradeCount");
  const totalReturnPct = getRecordProp(value, "totalReturnPct");
  const maxDrawdownPct = getRecordProp(value, "maxDrawdownPct");
  const winRatePct = getRecordProp(value, "winRatePct");
  const profitFactor = getRecordProp(value, "profitFactor");

  if (!isString(id) || !isIsoUtcString(createdAt) || !isBacktestStatus(status) || !isString(symbol) || !isString(interval)) {
    return null;
  }

  if (!isIsoUtcString(startTimeUtc) || !isIsoUtcString(endTimeUtc)) {
    return null;
  }

  if (!isNumberOrNull(tradeCount) || !isNumberOrNull(totalReturnPct) || !isNumberOrNull(maxDrawdownPct) || !isNumberOrNull(winRatePct) || !isNumberOrNull(profitFactor)) {
    return null;
  }

  return {
    id,
    createdAt,
    status,
    symbol,
    interval,
    startTimeUtc,
    endTimeUtc,
    tradeCount,
    totalReturnPct,
    maxDrawdownPct,
    winRatePct,
    profitFactor
  };
}

function parseBacktestRunDetail(value: unknown): BacktestRunDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = getRecordProp(value, "id");
  const createdAt = getRecordProp(value, "createdAt");
  const status = getRecordProp(value, "status");
  const parameterSetId = getRecordProp(value, "parameterSetId");
  const paramsSnapshot = getRecordProp(value, "paramsSnapshot");
  const symbol = getRecordProp(value, "symbol");
  const interval = getRecordProp(value, "interval");
  const startTimeUtc = getRecordProp(value, "startTimeUtc");
  const endTimeUtc = getRecordProp(value, "endTimeUtc");
  const initialEquity = getRecordProp(value, "initialEquity");

  const finalEquity = getRecordProp(value, "finalEquity");
  const totalReturnPct = getRecordProp(value, "totalReturnPct");
  const maxDrawdownPct = getRecordProp(value, "maxDrawdownPct");
  const winRatePct = getRecordProp(value, "winRatePct");
  const profitFactor = getRecordProp(value, "profitFactor");
  const tradeCount = getRecordProp(value, "tradeCount");
  const errorMessage = getRecordProp(value, "errorMessage");

  if (!isString(id) || !isIsoUtcString(createdAt) || !isBacktestStatus(status) || !isString(symbol) || !isString(interval)) {
    return null;
  }

  if (!isIsoUtcString(startTimeUtc) || !isIsoUtcString(endTimeUtc)) {
    return null;
  }

  if (typeof initialEquity !== "number") {
    return null;
  }

  if (!(parameterSetId === null || isString(parameterSetId) || parameterSetId === undefined)) {
    return null;
  }

  if (!isNumberOrNull(finalEquity) || !isNumberOrNull(totalReturnPct) || !isNumberOrNull(maxDrawdownPct) || !isNumberOrNull(winRatePct) || !isNumberOrNull(profitFactor) || !isNumberOrNull(tradeCount)) {
    return null;
  }

  if (!(errorMessage === null || isString(errorMessage) || errorMessage === undefined)) {
    return null;
  }

  return {
    id,
    createdAt,
    status,
    parameterSetId: parameterSetId === undefined ? null : parameterSetId,
    paramsSnapshot,
    symbol,
    interval,
    startTimeUtc,
    endTimeUtc,
    initialEquity,
    finalEquity,
    totalReturnPct,
    maxDrawdownPct,
    winRatePct,
    profitFactor,
    tradeCount,
    errorMessage: errorMessage === undefined ? null : errorMessage
  };
}

function parseTrade(value: unknown): Trade | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = getRecordProp(value, "id");
  const sessionDateNy = getRecordProp(value, "sessionDateNy");
  const direction = getRecordProp(value, "direction");
  const entryTimeUtc = getRecordProp(value, "entryTimeUtc");
  const entryPrice = getRecordProp(value, "entryPrice");
  const exitTimeUtc = getRecordProp(value, "exitTimeUtc");
  const exitPrice = getRecordProp(value, "exitPrice");
  const quantity = getRecordProp(value, "quantity");
  const feeTotal = getRecordProp(value, "feeTotal");
  const pnl = getRecordProp(value, "pnl");
  const rMultiple = getRecordProp(value, "rMultiple");
  const exitReason = getRecordProp(value, "exitReason");

  if (!isString(id) || !isString(sessionDateNy) || (direction !== "long" && direction !== "short")) {
    return null;
  }

  if (!isIsoUtcString(entryTimeUtc) || typeof entryPrice !== "number" || !isIsoUtcString(exitTimeUtc) || typeof exitPrice !== "number") {
    return null;
  }

  if (typeof quantity !== "number" || typeof feeTotal !== "number" || typeof pnl !== "number") {
    return null;
  }

  if (!(typeof rMultiple === "number" || rMultiple === null || rMultiple === undefined)) {
    return null;
  }

  if (!isString(exitReason)) {
    return null;
  }

  return {
    id,
    sessionDateNy,
    direction,
    entryTimeUtc,
    entryPrice,
    exitTimeUtc,
    exitPrice,
    quantity,
    feeTotal,
    pnl,
    rMultiple: rMultiple === undefined ? null : rMultiple,
    exitReason
  };
}

function parseEquityPoint(value: unknown): EquityPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const timeUtc = getRecordProp(value, "timeUtc");
  const equity = getRecordProp(value, "equity");

  if (!isIsoUtcString(timeUtc) || typeof equity !== "number") {
    return null;
  }

  return { timeUtc, equity };
}

function parseBacktestCompareResponse(value: unknown): BacktestCompareResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid compare response");
  }

  const rowsV = getRecordProp(value, "rows");

  if (!Array.isArray(rowsV)) {
    throw new Error("Invalid compare response rows");
  }

  const rows: BacktestCompareRow[] = rowsV
    .map((r): BacktestCompareRow | null => {
      if (!isRecord(r)) {
        return null;
      }

      const runId = getRecordProp(r, "runId");
      const createdAt = getRecordProp(r, "createdAt");
      const symbol = getRecordProp(r, "symbol");
      const interval = getRecordProp(r, "interval");
      const status = getRecordProp(r, "status");
      const metrics = getRecordProp(r, "metrics");

      if (!isString(runId) || !isIsoUtcString(createdAt) || !isString(symbol) || !isString(interval) || !isBacktestStatus(status)) {
        return null;
      }

      if (!isRecord(metrics)) {
        return null;
      }

      const totalReturnPct = getRecordProp(metrics, "totalReturnPct");
      const maxDrawdownPct = getRecordProp(metrics, "maxDrawdownPct");
      const winRatePct = getRecordProp(metrics, "winRatePct");
      const profitFactor = getRecordProp(metrics, "profitFactor");
      const tradeCount = getRecordProp(metrics, "tradeCount");

      if (!isNumberOrNull(totalReturnPct) || !isNumberOrNull(maxDrawdownPct) || !isNumberOrNull(winRatePct) || !isNumberOrNull(profitFactor) || !isNumberOrNull(tradeCount)) {
        return null;
      }

      return {
        runId,
        createdAt,
        symbol,
        interval,
        status,
        metrics: {
          totalReturnPct,
          maxDrawdownPct,
          winRatePct,
          profitFactor,
          tradeCount
        }
      };
    })
    .filter((r): r is BacktestCompareRow => r !== null);

  return { rows };
}

/**
 * Lists parameter sets (paged).
 *
 * API: `GET /v1/parameter-sets?offset=0&limit=50`
 */
export async function apiListParameterSets(offset: number, limit: number): Promise<OffsetLimitPage<ParameterSet>> {
  const json = await fetchJson({
    method: "GET",
    path: "/v1/parameter-sets",
    query: {
      offset: String(offset),
      limit: String(limit)
    }
  });

  return parseOffsetLimitPage(json, parseParameterSet);
}

/**
 * Fetches a single parameter set by ID.
 */
export async function apiGetParameterSet(id: string): Promise<ParameterSet> {
  const json = await fetchJson({
    method: "GET",
    path: `/v1/parameter-sets/${encodeURIComponent(id)}`
  });

  const parsed = parseParameterSet(json);

  if (!parsed) {
    throw new Error("Invalid parameter set payload");
  }

  return parsed;
}

export type CreateParameterSetRequest = Readonly<{
  name: string;
  description?: string;
  params: StrategyParams;
}>;

/**
 * Creates a new parameter set.
 */
export async function apiCreateParameterSet(req: CreateParameterSetRequest): Promise<ParameterSet> {
  const json = await fetchJson({
    method: "POST",
    path: "/v1/parameter-sets",
    body: req
  });

  const parsed = parseParameterSet(json);

  if (!parsed) {
    throw new Error("Invalid create parameter set response");
  }

  return parsed;
}

export type RunBacktestRequest = Readonly<{
  parameterSetId?: string;
  params?: StrategyParams;
  symbol: string;
  interval: string;
  startTimeUtc: string;
  endTimeUtc: string;
  initialEquity?: number;
}>;

/**
 * Starts a backtest run.
 *
 * API: `POST /v1/backtests`
 */
export async function apiRunBacktest(req: RunBacktestRequest): Promise<BacktestRunDetail> {
  const json = await fetchJson({
    method: "POST",
    path: "/v1/backtests",
    body: req
  });

  const parsed = parseBacktestRunDetail(json);

  if (!parsed) {
    // Some backends may return a "summary" shape; fall back to summary parsing.
    const summary = parseBacktestRunSummary(json);

    if (summary) {
      return {
        id: summary.id,
        createdAt: summary.createdAt,
        status: summary.status,
        parameterSetId: null,
        paramsSnapshot: null,
        symbol: summary.symbol,
        interval: summary.interval,
        startTimeUtc: summary.startTimeUtc,
        endTimeUtc: summary.endTimeUtc,
        initialEquity: 0,
        finalEquity: null,
        totalReturnPct: summary.totalReturnPct,
        maxDrawdownPct: summary.maxDrawdownPct,
        winRatePct: summary.winRatePct,
        profitFactor: summary.profitFactor,
        tradeCount: summary.tradeCount,
        errorMessage: null
      };
    }

    throw new Error("Invalid backtest run response");
  }

  return parsed;
}

/**
 * Fetches a backtest run by ID.
 *
 * API: `GET /v1/backtests/:runId`
 */
export async function apiGetBacktestRun(runId: string): Promise<BacktestRunDetail> {
  const json = await fetchJson({
    method: "GET",
    path: `/v1/backtests/${encodeURIComponent(runId)}`
  });

  const parsed = parseBacktestRunDetail(json);

  if (!parsed) {
    throw new Error("Invalid backtest run payload");
  }

  return parsed;
}

/**
 * Lists backtest runs (paged).
 *
 * API: `GET /v1/backtests?offset=0&limit=50`
 */
export async function apiListBacktestRuns(offset: number, limit: number): Promise<OffsetLimitPage<BacktestRunSummary>> {
  const json = await fetchJson({
    method: "GET",
    path: "/v1/backtests",
    query: {
      offset: String(offset),
      limit: String(limit)
    }
  });

  return parseOffsetLimitPage(json, parseBacktestRunSummary);
}

/**
 * Lists trades for a run (paged).
 *
 * API: `GET /v1/backtests/:runId/trades?offset=0&limit=50`
 */
export async function apiListTrades(runId: string, offset: number, limit: number): Promise<OffsetLimitPage<Trade>> {
  const json = await fetchJson({
    method: "GET",
    path: `/v1/backtests/${encodeURIComponent(runId)}/trades`,
    query: {
      offset: String(offset),
      limit: String(limit)
    }
  });

  return parseOffsetLimitPage(json, parseTrade);
}

/**
 * Lists equity points for a run (paged).
 *
 * API: `GET /v1/backtests/:runId/equity?offset=0&limit=50`
 */
export async function apiListEquity(runId: string, offset: number, limit: number): Promise<OffsetLimitPage<EquityPoint>> {
  const json = await fetchJson({
    method: "GET",
    path: `/v1/backtests/${encodeURIComponent(runId)}/equity`,
    query: {
      offset: String(offset),
      limit: String(limit)
    }
  });

  return parseOffsetLimitPage(json, parseEquityPoint);
}

/**
 * Compares runs by summary metrics.
 *
 * API: `POST /v1/backtests/compare`
 */
export async function apiCompareRuns(runIds: readonly string[]): Promise<BacktestCompareResponse> {
  const json = await fetchJson({
    method: "POST",
    path: "/v1/backtests/compare",
    body: {
      runIds
    }
  });

  return parseBacktestCompareResponse(json);
}
