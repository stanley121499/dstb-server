import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { NumberField } from "../components/NumberField";
import { RadioGroup } from "../components/RadioGroup";
import { SelectField } from "../components/SelectField";
import { JsonViewer } from "../components/JsonViewer";

import { apiGetParameterSet, apiListParameterSets, apiRunBacktest, type ParameterSet } from "../lib/dstbApi";
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

  useEffect(() => {
    void loadParameterSets();
  }, [loadParameterSets]);

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
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="col">
          <p className="h1" style={{ marginBottom: 2 }}>
            Run Backtest
          </p>
          <span className="muted">Runs `POST /v1/backtests` and navigates to results.</span>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="button" onClick={() => void loadParameterSets()} disabled={isLoading}>
            Refresh parameter sets
          </button>
          <button className="btn btnPrimary" type="button" onClick={() => void onRun()} disabled={isLoading}>
            {isLoading ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      <div className="hr" />

      {error ? <div className="errorBox" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardHeader">
          <p className="h2">Inputs</p>
        </div>
        <div className="cardBody">
          <RadioGroup<RunMode>
            label="Params source"
            value={mode}
            options={[
              { value: "parameter_set", label: "Saved parameter set" },
              { value: "inline_json", label: "Inline params (JSON)" }
            ]}
            onChange={setMode}
          />

          <div style={{ height: 10 }} />

          {mode === "parameter_set" ? (
            <SelectField<string>
              label="Parameter set"
              value={selectedParameterSetId}
              options={parameterSetOptions}
              onChange={setSelectedParameterSetId}
              help="Used as parameterSetId in the request."
            />
          ) : (
            <label className="col" style={{ gap: 6 }}>
              <span className="label">Inline params JSON</span>
              <textarea className="textarea" value={inlineJson} onChange={(ev) => setInlineJson(ev.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>
                Parsed and validated client-side before sending.
              </span>
            </label>
          )}

          <div style={{ height: 10 }} />

          <div className="row">
            <SelectField<SymbolId> label="Symbol" value={symbol} options={symbolOptions} onChange={setSymbol} />
            <SelectField<IntervalId> label="Interval" value={interval} options={intervalOptions} onChange={setInterval} />
          </div>

          <div style={{ height: 10 }} />

          <div className="row">
            <label className="col" style={{ gap: 6, minWidth: 260 }}>
              <span className="label">Start time (UTC)</span>
              <input className="input" type="datetime-local" value={startLocal} onChange={(ev) => setStartLocal(ev.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>Interpreted as UTC.</span>
            </label>

            <label className="col" style={{ gap: 6, minWidth: 260 }}>
              <span className="label">End time (UTC)</span>
              <input className="input" type="datetime-local" value={endLocal} onChange={(ev) => setEndLocal(ev.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>Interpreted as UTC.</span>
            </label>

            <NumberField
              label="Initial equity (optional)"
              value={initialEquity}
              onChange={setInitialEquity}
              min={0}
              step={1}
              help="If empty, the backend may use a default."
            />
          </div>
        </div>
      </div>

      {mode === "inline_json" ? (
        <div className="card">
          <div className="cardHeader">
            <p className="h2">Parsed inline params preview</p>
          </div>
          <div className="cardBody">
            <JsonViewer value={parseStrategyParams(safeJsonParse(inlineJson))} />
          </div>
        </div>
      ) : null}

      <div style={{ height: 24 }} />
    </div>
  );
}
