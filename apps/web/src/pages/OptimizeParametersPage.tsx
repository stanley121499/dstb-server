import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Play } from "lucide-react";

import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

import {
  apiListParameterSets,
  apiGetParameterSet,
  apiRunGridSearch,
  type ParameterSet,
  type GridOverride,
} from "../lib/dstbApi";
import { parseDatetimeLocalAsUtcIso } from "../lib/dateTime";
import { parseNumber } from "../lib/numberParsing";
import {
  parseStrategyParams,
  type IntervalId,
  type StrategyParams,
  type SymbolId,
} from "../domain/strategyParams";

type ParameterOverride = {
  id: string;
  path: string;
  values: string; // Comma-separated values
};

const AVAILABLE_SYMBOLS: readonly SymbolId[] = ["BTC-USD", "ETH-USD"] as const;
const AVAILABLE_INTERVALS: readonly IntervalId[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "1d",
] as const;

/**
 * Parameter metadata with paths, descriptions, and suggested ranges.
 */
const PARAMETER_METADATA = [
  {
    path: "session.openingRangeMinutes",
    label: "Opening Range Duration",
    description: "Minutes after session start to define the range",
    suggestedValues: "15,30,60",
    rangeGuide: "Typical: 15-90 minutes. Lower = more trades, Higher = better breakout confirmation"
  },
  {
    path: "entry.breakoutBufferBps",
    label: "Breakout Buffer (bps)",
    description: "Additional buffer beyond range high/low in basis points",
    suggestedValues: "0,5,10,15",
    rangeGuide: "Typical: 0-20 bps. 0 = no buffer, 10-15 = reduces false breakouts"
  },
  {
    path: "entry.maxTradesPerSession",
    label: "Max Trades Per Session",
    description: "Maximum number of trades allowed per trading session",
    suggestedValues: "1,2,3",
    rangeGuide: "Typical: 1-5 trades. Lower = more selective, Higher = more opportunities"
  },
  {
    path: "atr.atrLength",
    label: "ATR Period",
    description: "Number of bars used to calculate Average True Range",
    suggestedValues: "10,14,20",
    rangeGuide: "Typical: 10-20 bars. 14 is industry standard. Lower = more reactive"
  },
  {
    path: "risk.riskPctPerTrade",
    label: "Risk Per Trade (%)",
    description: "Percentage of equity risked per trade",
    suggestedValues: "1,2,3",
    rangeGuide: "Typical: 0.5-3%. Professionals use 1-2%. Never exceed 5%"
  },
  {
    path: "risk.atrStopMultiple",
    label: "Stop Loss (ATR Multiple)",
    description: "Stop loss distance as multiple of ATR",
    suggestedValues: "1.5,2.0,2.5",
    rangeGuide: "Typical: 1.5-3.0x ATR. Lower = tighter stop, Higher = more room"
  },
  {
    path: "risk.tpRMultiple",
    label: "Take Profit (R-Multiple)",
    description: "Take profit target as multiple of initial risk",
    suggestedValues: "2,3,4",
    rangeGuide: "Typical: 2-5R. 2R = conservative, 3R = balanced, 4R+ = aggressive"
  },
  {
    path: "risk.atrTrailMultiple",
    label: "Trailing Stop (ATR Multiple)",
    description: "Trailing stop distance as multiple of ATR",
    suggestedValues: "2.0,2.5,3.0",
    rangeGuide: "Typical: 2-4x ATR. Must be >= stop multiple. Higher = locks in more profit"
  },
  {
    path: "risk.fixedNotional",
    label: "Fixed Position Size ($)",
    description: "Fixed dollar amount per trade (when using fixed_notional mode)",
    suggestedValues: "1000,2000,5000",
    rangeGuide: "Depends on account size. Consider 1-5% of total equity"
  },
  {
    path: "execution.feeBps",
    label: "Trading Fees (bps)",
    description: "Transaction fee per trade in basis points",
    suggestedValues: "5,10,15",
    rangeGuide: "Crypto: 5-20 bps. Binance ~10 bps, Coinbase ~50 bps"
  },
  {
    path: "execution.slippageBps",
    label: "Slippage (bps)",
    description: "Expected slippage per trade in basis points",
    suggestedValues: "5,10,20",
    rangeGuide: "Liquid markets: 5-10 bps. Less liquid: 10-30 bps"
  }
] as const;

const COMMON_PATHS = PARAMETER_METADATA.map((p) => p.path);

/**
 * OptimizeParametersPage: Grid search UI for testing all parameter combinations.
 */
export function OptimizeParametersPage(): React.ReactElement {
  const navigate = useNavigate();

  const [parameterSets, setParameterSets] = useState<readonly ParameterSet[]>([]);
  const [selectedParameterSetId, setSelectedParameterSetId] = useState<string>("");
  const [baseParams, setBaseParams] = useState<StrategyParams | null>(null);

  const [selectedSymbols, setSelectedSymbols] = useState<Set<SymbolId>>(
    new Set(["BTC-USD"])
  );
  const [selectedIntervals, setSelectedIntervals] = useState<Set<IntervalId>>(
    new Set(["5m", "15m", "1h"])
  );

  const [overrides, setOverrides] = useState<ParameterOverride[]>([
    { id: crypto.randomUUID(), path: "session.openingRangeMinutes", values: "15,30,60" },
  ]);

  const [startLocal, setStartLocal] = useState<string>("");
  const [endLocal, setEndLocal] = useState<string>("");
  const [initialEquity, setInitialEquity] = useState<string>("10000");

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [estimatedRuns, setEstimatedRuns] = useState<number>(0);

  // Load parameter sets on mount
  useEffect(() => {
    let cancelled = false;

    void apiListParameterSets(0, 100)
      .then((page) => {
        if (cancelled) {
          return;
        }

        setParameterSets(page.items);

        if (page.items.length > 0 && selectedParameterSetId.trim().length === 0) {
          const first = page.items[0];
          if (first !== undefined) {
            setSelectedParameterSetId(first.id);
          }
        }
      })
      .catch(() => {
        // Non-fatal
      });

    return () => {
      cancelled = true;
    };
  }, [selectedParameterSetId]);

  // Load base params when parameter set changes
  useEffect(() => {
    if (selectedParameterSetId.trim().length === 0) {
      setBaseParams(null);
      return;
    }

    let cancelled = false;

    void apiGetParameterSet(selectedParameterSetId)
      .then((ps) => {
        if (cancelled) {
          return;
        }

        const parsed = parseStrategyParams(ps.params);
        if (parsed) {
          setBaseParams(parsed);
        }
      })
      .catch(() => {
        // Non-fatal
      });

    return () => {
      cancelled = true;
    };
  }, [selectedParameterSetId]);

  // Calculate estimated run count
  useEffect(() => {
    const symbolCount = selectedSymbols.size;
    const intervalCount = selectedIntervals.size;
    
    let combinationCount = 1;
    for (const override of overrides) {
      const values = override.values.split(",").map((v) => v.trim()).filter((v) => v.length > 0);
      combinationCount *= Math.max(values.length, 1);
    }

    setEstimatedRuns(symbolCount * intervalCount * combinationCount);
  }, [selectedSymbols, selectedIntervals, overrides]);

  const parameterSetOptions = useMemo(() => {
    return parameterSets.map((ps) => ({
      value: ps.id,
      label: ps.name,
    }));
  }, [parameterSets]);

  const onAddOverride = useCallback(() => {
    setOverrides((prev) => [
      ...prev,
      { id: crypto.randomUUID(), path: "", values: "" },
    ]);
  }, []);

  const onRemoveOverride = useCallback((id: string) => {
    setOverrides((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const onUpdateOverride = useCallback(
    (id: string, field: keyof ParameterOverride, value: string) => {
      setOverrides((prev) =>
        prev.map((o) => {
          if (o.id !== id) {
            return o;
          }

          // If path is changing, auto-populate suggested values
          if (field === "path") {
            const metadata = PARAMETER_METADATA.find((m) => m.path === value);
            if (metadata && o.values.trim().length === 0) {
              return { ...o, path: value, values: metadata.suggestedValues };
            }
          }

          return { ...o, [field]: value };
        })
      );
    },
    []
  );

  const onToggleSymbol = useCallback((symbol: SymbolId, checked: boolean) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(symbol);
      } else {
        next.delete(symbol);
      }
      return next;
    });
  }, []);

  const onToggleInterval = useCallback((interval: IntervalId, checked: boolean) => {
    setSelectedIntervals((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(interval);
      } else {
        next.delete(interval);
      }
      return next;
    });
  }, []);

  const onRunOptimization = useCallback(async () => {
    setError(null);
    setSuccessMessage(null);

    if (!baseParams) {
      setError("Select a parameter set first");
      return;
    }

    if (selectedSymbols.size === 0) {
      setError("Select at least one symbol");
      return;
    }

    if (selectedIntervals.size === 0) {
      setError("Select at least one interval");
      return;
    }

    if (overrides.length === 0) {
      setError("Add at least one parameter override");
      return;
    }

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

    // Parse and validate overrides
    const parsedOverrides: GridOverride[] = [];

    for (const override of overrides) {
      if (override.path.trim().length === 0) {
        setError("All parameter paths must be non-empty");
        return;
      }

      const valueTokens = override.values
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);

      if (valueTokens.length === 0) {
        setError(`Parameter "${override.path}" has no values`);
        return;
      }

      // Try to parse as numbers, fall back to strings/booleans
      const parsedValues: (number | string | boolean)[] = valueTokens.map((token) => {
        if (token === "true") {
          return true;
        }
        if (token === "false") {
          return false;
        }

        const num = Number(token);
        if (!Number.isNaN(num)) {
          return num;
        }

        return token;
      });

      parsedOverrides.push({
        path: override.path,
        values: parsedValues,
      });
    }

    setIsLoading(true);

    try {
      const response = await apiRunGridSearch({
        baseParams,
        overrides: parsedOverrides,
        symbols: Array.from(selectedSymbols),
        intervals: Array.from(selectedIntervals),
        startTimeUtc: startParsed.isoUtc,
        endTimeUtc: endParsed.isoUtc,
        ...(equityParsed.value !== null && { initialEquity: equityParsed.value }),
      });

      // Show success message with details
      setSuccessMessage(
        `✅ Successfully queued ${response.totalQueued} backtests! They are being processed. Redirecting to results...`
      );

      // Store grid search metadata in sessionStorage
      sessionStorage.setItem("optimizationGridId", response.gridRunId);
      sessionStorage.setItem("optimizationTotalQueued", String(response.totalQueued));
      sessionStorage.setItem("optimizationTimestamp", response.timestamp);

      // Redirect to results page (we'll fetch runs by timestamp)
      setTimeout(() => {
        navigate(`/optimize/results?gridId=${encodeURIComponent(response.gridRunId)}`);
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start optimization");
      setIsLoading(false);
    }
  }, [
    baseParams,
    selectedSymbols,
    selectedIntervals,
    overrides,
    startLocal,
    endLocal,
    initialEquity,
    navigate,
  ]);

  return (
    <div className="page-container">
      <PageHeader
        title="Optimize Parameters"
        description="Test all combinations of parameters across symbols and timeframes"
        actions={
          <Button onClick={() => void onRunOptimization()} disabled={isLoading || !baseParams}>
            <Play className="h-4 w-4 mr-2" />
            {isLoading ? "Queueing Tests (may take several minutes)..." : `Run ${estimatedRuns} Tests`}
          </Button>
        }
      />

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5 p-4">
          <p className="text-small text-destructive">{error}</p>
        </Card>
      )}

      {successMessage && (
        <Card className="mb-6 border-success/50 bg-success-background p-4">
          <p className="text-small text-success-foreground font-medium">{successMessage}</p>
          <p className="text-caption text-muted-foreground mt-1">
            You can monitor progress on the Runs page. Results will appear shortly.
          </p>
        </Card>
      )}

      <div className="space-y-6">
        {/* Base Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Base Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="parameter-set">Base Parameter Set</Label>
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
                All tests will use this as the base configuration
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Symbols to Test</Label>
                <div className="space-y-2">
                  {AVAILABLE_SYMBOLS.map((symbol) => (
                    <div key={symbol} className="flex items-center space-x-2">
                      <Checkbox
                        id={`symbol-${symbol}`}
                        checked={selectedSymbols.has(symbol)}
                        onCheckedChange={(checked) =>
                          onToggleSymbol(symbol, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`symbol-${symbol}`}
                        className="text-small font-normal cursor-pointer"
                      >
                        {symbol}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Intervals to Test</Label>
                <div className="space-y-2">
                  {AVAILABLE_INTERVALS.map((interval) => (
                    <div key={interval} className="flex items-center space-x-2">
                      <Checkbox
                        id={`interval-${interval}`}
                        checked={selectedIntervals.has(interval)}
                        onCheckedChange={(checked) =>
                          onToggleInterval(interval, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`interval-${interval}`}
                        className="text-small font-normal cursor-pointer"
                      >
                        {interval}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Parameter Overrides */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Parameter Overrides</CardTitle>
              <Button variant="outline" size="sm" onClick={onAddOverride}>
                <Plus className="h-4 w-4 mr-2" />
                Add Override
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-small text-muted-foreground">
              Define which parameters to vary and what values to test. All combinations will be
              tested.
            </p>

            {overrides.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No parameter overrides defined. Click "Add Override" to begin.
              </div>
            ) : (
              <div className="space-y-4">
                {overrides.map((override, index) => {
                  const metadata = PARAMETER_METADATA.find((m) => m.path === override.path) ?? null;

                  return (
                    <div
                      key={override.id}
                      className="grid grid-cols-1 gap-4 p-4 border border-border rounded-sm bg-secondary/20"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr_auto] gap-4 items-start">
                        <div className="space-y-2">
                          <Label htmlFor={`path-${override.id}`}>
                            Parameter Path {index + 1}
                          </Label>
                          <Input
                            id={`path-${override.id}`}
                            placeholder="e.g., session.openingRangeMinutes"
                            value={override.path}
                            onChange={(ev) =>
                              onUpdateOverride(override.id, "path", ev.target.value)
                            }
                            list={`common-paths-${override.id}`}
                          />
                          <datalist id={`common-paths-${override.id}`}>
                            {PARAMETER_METADATA.map((param) => (
                              <option key={param.path} value={param.path}>
                                {param.label}
                              </option>
                            ))}
                          </datalist>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`values-${override.id}`}>
                            Values (comma-separated)
                          </Label>
                          <Input
                            id={`values-${override.id}`}
                            placeholder="e.g., 15,30,60"
                            value={override.values}
                            onChange={(ev) =>
                              onUpdateOverride(override.id, "values", ev.target.value)
                            }
                          />
                          <p className="text-caption text-muted-foreground">
                            Numbers, strings, or true/false
                          </p>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveOverride(override.id)}
                          className="mt-8"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Helpful guidance for selected parameter */}
                      {metadata && (
                        <div className="pt-2 border-t border-border/50">
                          <p className="text-small font-medium text-foreground mb-1">
                            💡 {metadata.label}
                          </p>
                          <p className="text-caption text-muted-foreground mb-2">
                            {metadata.description}
                          </p>
                          <div className="flex items-start gap-2">
                            <span className="text-caption font-medium text-muted-foreground whitespace-nowrap">
                              Suggested:
                            </span>
                            <div className="flex-1">
                              <code className="text-caption bg-secondary px-2 py-0.5 rounded text-foreground">
                                {metadata.suggestedValues}
                              </code>
                              <p className="text-caption text-muted-foreground mt-1">
                                {metadata.rangeGuide}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Date Range & Equity */}
        <Card>
          <CardHeader>
            <CardTitle>Date Range & Initial Equity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <Label htmlFor="initial-equity">Initial Equity</Label>
                <Input
                  id="initial-equity"
                  type="number"
                  min={0}
                  step={1}
                  value={initialEquity}
                  onChange={(ev) => setInitialEquity(ev.target.value)}
                  placeholder="10000"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Estimation Summary */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-small font-medium mb-1">Estimated Tests</p>
                <p className="text-caption text-muted-foreground">
                  {selectedSymbols.size} symbols × {selectedIntervals.size} intervals ×{" "}
                  {Math.ceil(
                    estimatedRuns / (selectedSymbols.size * selectedIntervals.size || 1)
                  )}{" "}
                  parameter combinations
                </p>
              </div>
              <div className="text-right">
                <p className="text-h2 font-bold text-primary">{estimatedRuns}</p>
                <p className="text-caption text-muted-foreground">total runs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}



