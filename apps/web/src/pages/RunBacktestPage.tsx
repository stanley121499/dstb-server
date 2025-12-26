import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { RadioGroup } from "../components/RadioGroup";
import { JsonViewer } from "../components/JsonViewer";
import { RecentRunsList, type RecentRun } from "../components/RecentRunsList";

import { apiGetParameterSet, apiListParameterSets, apiRunBacktest, apiListBacktestRuns, type ParameterSet } from "../lib/dstbApi";
import { parseDatetimeLocalAsUtcIso } from "../lib/dateTime";
import { parseNumber } from "../lib/numberParsing";
import { createDefaultStrategyParams, parseStrategyParams, type IntervalId, type StrategyParams, type SymbolId } from "../domain/strategyParams";

type RunMode = "parameter_set" | "inline_json";

function toSymbolIdOrNull(value: string | null): SymbolId | null {
  if (value === "BTC-USD" || value === "ETH-USD") {
    return value;
  }

  return null;
}

function toIntervalIdOrNull(value: string | null): IntervalId | null {
  if (value === "1m") {
    return "1m";
  }

  if (value === "2m") {
    return "2m";
  }

  if (value === "5m") {
    return "5m";
  }

  if (value === "15m") {
    return "15m";
  }

  if (value === "30m") {
    return "30m";
  }

  if (value === "60m") {
    return "60m";
  }

  if (value === "90m") {
    return "90m";
  }

  if (value === "1h") {
    return "1h";
  }

  if (value === "1d") {
    return "1d";
  }

  return null;
}

function safeJsonParse(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Run Backtest screen.
 */
export function RunBacktestPage(): React.ReactElement {
  const navigate = useNavigate();

  const [mode, setMode] = useState<RunMode>("parameter_set");

  const [parameterSets, setParameterSets] = useState<readonly ParameterSet[]>([]);
  const [selectedParameterSetId, setSelectedParameterSetId] = useState<string>("");

  const [symbol, setSymbol] = useState<SymbolId>("BTC-USD");
  const [interval, setInterval] = useState<IntervalId>("5m");

  const [startLocal, setStartLocal] = useState<string>("");
  const [endLocal, setEndLocal] = useState<string>("");
  const [initialEquity, setInitialEquity] = useState<string>("10000");

  const [inlineJson, setInlineJson] = useState<string>(() => JSON.stringify(createDefaultStrategyParams(), null, 2));

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [recentRuns, setRecentRuns] = useState<readonly RecentRun[]>([]);
  const [recentRunsLoading, setRecentRunsLoading] = useState<boolean>(false);

  const parameterSetOptions = useMemo(() => {
    return parameterSets.map((ps) => ({
      value: ps.id,
      label: ps.name
    }));
  }, [parameterSets]);

  const loadParameterSets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const page = await apiListParameterSets(0, 100);
      setParameterSets(page.items);

      if (page.items.length > 0 && selectedParameterSetId.trim().length === 0) {
        const first = page.items[0];
        if (first !== undefined) {
          setSelectedParameterSetId(first.id);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load parameter sets");
    } finally {
      setIsLoading(false);
    }
  }, [selectedParameterSetId]);

  const loadRecentRuns = useCallback(async () => {
    setRecentRunsLoading(true);

    try {
      const page = await apiListBacktestRuns(0, 5);
      setRecentRuns(
        page.items.map((run) => ({
          id: run.id,
          createdAt: run.createdAt,
          status: run.status,
          symbol: run.symbol,
          interval: run.interval,
          totalReturnPct: run.totalReturnPct,
          tradeCount: run.tradeCount
        }))
      );
    } catch {
      // Non-critical; silently fail.
    } finally {
      setRecentRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParameterSets();
    void loadRecentRuns();
  }, [loadParameterSets, loadRecentRuns]);

  useEffect(() => {
    if (mode !== "parameter_set") {
      return;
    }

    const id = selectedParameterSetId.trim();

    if (id.length === 0) {
      return;
    }

    // When a parameter set is selected, prefill symbol/interval from its params (if possible).
    let cancelled = false;

    void apiGetParameterSet(id)
      .then((ps) => {
        if (cancelled) {
          return;
        }

        const parsed = parseStrategyParams(ps.params);

        if (!parsed) {
          return;
        }

        const s = toSymbolIdOrNull(parsed.symbol);
        const i = toIntervalIdOrNull(parsed.interval);

        if (s) {
          setSymbol(s);
        }

        if (i) {
          setInterval(i);
        }
      })
      .catch(() => {
        // Non-fatal; user can still run by selecting symbol/interval.
      });

    return () => {
      cancelled = true;
    };
  }, [mode, selectedParameterSetId]);

  const symbolOptions = useMemo(() => {
    return [
      { value: "BTC-USD" satisfies SymbolId, label: "BTC-USD" },
      { value: "ETH-USD" satisfies SymbolId, label: "ETH-USD" }
    ] as const;
  }, []);

  const intervalOptions = useMemo(() => {
    return [
      { value: "1m" satisfies IntervalId, label: "1m" },
      { value: "2m" satisfies IntervalId, label: "2m" },
      { value: "5m" satisfies IntervalId, label: "5m" },
      { value: "15m" satisfies IntervalId, label: "15m" },
      { value: "30m" satisfies IntervalId, label: "30m" },
      { value: "1h" satisfies IntervalId, label: "1h" },
      { value: "1d" satisfies IntervalId, label: "1d" }
    ] as const;
  }, []);

  const onRun = useCallback(async () => {
    setError(null);

    const startParsed = parseDatetimeLocalAsUtcIso(startLocal);
    const endParsed = parseDatetimeLocalAsUtcIso(endLocal);

    if (startParsed.error || !startParsed.isoUtc) {
      setError(`Start time: ${startParsed.error ?? "Invalid"}`);
      return;
    }

    if (endParsed.error || !endParsed.isoUtc) {
      setError(`End time: ${endParsed.error ?? "Invalid"}`);
      return;
    }

    if (new Date(startParsed.isoUtc).getTime() >= new Date(endParsed.isoUtc).getTime()) {
      setError("Start time must be before end time");
      return;
    }

    const equityParsed = parseNumber(initialEquity, { min: 0, allowEmpty: true });

    if (equityParsed.error) {
      setError(`Initial equity: ${equityParsed.error}`);
      return;
    }

    let bodyParams: StrategyParams | undefined;
    let parameterSetId: string | undefined;

    if (mode === "parameter_set") {
      const id = selectedParameterSetId.trim();

      if (id.length === 0) {
        setError("Select a parameter set");
        return;
      }

      parameterSetId = id;
    } else {
      const parsed = parseStrategyParams(safeJsonParse(inlineJson));

      if (!parsed) {
        setError("Inline params JSON is invalid (expected StrategyParams v1.0)");
        return;
      }

      bodyParams = parsed;
    }

    setIsLoading(true);

    try {
      const initialEquityValue = equityParsed.value === null ? undefined : equityParsed.value;
      const baseReq = {
        symbol,
        interval,
        startTimeUtc: startParsed.isoUtc,
        endTimeUtc: endParsed.isoUtc,
        ...(initialEquityValue === undefined ? {} : { initialEquity: initialEquityValue })
      };

      const req =
        mode === "parameter_set" && parameterSetId !== undefined
          ? { ...baseReq, parameterSetId }
          : bodyParams !== undefined
              ? { ...baseReq, params: bodyParams }
              : baseReq;

      const run = await apiRunBacktest(req);

      navigate(`/backtests/${run.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to run backtest");
    } finally {
      setIsLoading(false);
    }
  }, [endLocal, initialEquity, inlineJson, interval, mode, navigate, selectedParameterSetId, startLocal, symbol]);

  return (
    <div className="page-container">
      <PageHeader
        title="Run Backtest"
        description="Configure and execute a backtest against historical data"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void loadParameterSets()} disabled={isLoading}>
              Refresh Sets
            </Button>
            <Button onClick={() => void onRun()} disabled={isLoading}>
              {isLoading ? "Running..." : "Run Backtest"}
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5 p-4">
          <p className="text-small text-destructive">{error}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Configuration Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Backtest Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Parameter Source Selection */}
              <div className="space-y-2">
                <Label>Parameter Source</Label>
                <RadioGroup<RunMode>
                  label=""
                  value={mode}
                  options={[
                    { value: "parameter_set", label: "Saved parameter set" },
                    { value: "inline_json", label: "Inline params (JSON)" }
                  ]}
                  onChange={setMode}
                />
              </div>

              {/* Parameter Set or Inline JSON */}
              {mode === "parameter_set" ? (
                <div className="space-y-2">
                  <Label htmlFor="parameter-set">Parameter Set</Label>
                  <Select value={selectedParameterSetId} onValueChange={setSelectedParameterSetId}>
                    <SelectTrigger id="parameter-set">
                      <SelectValue placeholder="Select a parameter set" />
                    </SelectTrigger>
                    <SelectContent>
                      {parameterSetOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-caption text-muted-foreground">
                    Used as parameterSetId in the request
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="inline-json">Inline Parameters (JSON)</Label>
                  <textarea
                    id="inline-json"
                    value={inlineJson}
                    onChange={(ev) => setInlineJson(ev.target.value)}
                    className="flex min-h-[200px] w-full rounded-sm border border-input bg-background px-3 py-2 text-small ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150 font-mono"
                  />
                  <p className="text-caption text-muted-foreground">
                    Parsed and validated client-side before sending
                  </p>
                </div>
              )}

              {/* Symbol & Interval */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbol</Label>
                  <Select value={symbol} onValueChange={(v) => setSymbol(v as SymbolId)}>
                    <SelectTrigger id="symbol">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {symbolOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interval">Interval</Label>
                  <Select value={interval} onValueChange={(v) => setInterval(v as IntervalId)}>
                    <SelectTrigger id="interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {intervalOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Date Range & Initial Equity */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-time">Start Time (UTC)</Label>
                  <Input
                    id="start-time"
                    type="datetime-local"
                    value={startLocal}
                    onChange={(ev) => setStartLocal(ev.target.value)}
                  />
                  <p className="text-caption text-muted-foreground">Interpreted as UTC</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end-time">End Time (UTC)</Label>
                  <Input
                    id="end-time"
                    type="datetime-local"
                    value={endLocal}
                    onChange={(ev) => setEndLocal(ev.target.value)}
                  />
                  <p className="text-caption text-muted-foreground">Interpreted as UTC</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initial-equity">Initial Equity (optional)</Label>
                  <Input
                    id="initial-equity"
                    type="number"
                    min={0}
                    step={1}
                    value={initialEquity}
                    onChange={(ev) => setInitialEquity(ev.target.value)}
                    placeholder="10000"
                  />
                  <p className="text-caption text-muted-foreground">
                    Backend default if empty
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Parsed Preview Card */}
          {mode === "inline_json" && (
            <Card>
              <CardHeader>
                <CardTitle>Parsed Parameters Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonViewer value={parseStrategyParams(safeJsonParse(inlineJson))} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent Runs Sidebar */}
        <div>
          <RecentRunsList runs={recentRuns} isLoading={recentRunsLoading} />
        </div>
      </div>
    </div>
  );
}




