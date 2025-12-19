import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { NumberField } from "../components/NumberField";
import { RadioGroup } from "../components/RadioGroup";
import { SelectField } from "../components/SelectField";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { JsonViewer } from "../components/JsonViewer";

import {
  createDefaultStrategyParams,
  parseStrategyParams,
  SUPPORTED_INTERVALS,
  SUPPORTED_SYMBOLS,
  validateStrategyParams,
  type DirectionMode,
  type EntryMode,
  type IntervalId,
  type SizingMode,
  type StopMode,
  type StrategyParams,
  type SymbolId,
  type TakeProfitMode,
  type TimeExitMode,
  type TrailingStopMode,
  type ValidationIssue
} from "../domain/strategyParams";
import { apiCreateParameterSet, apiGetParameterSet, type ParameterSet } from "../lib/dstbApi";
import { parseNumber } from "../lib/numberParsing";

type ParamNumberFieldId =
  | "entry.breakoutBufferBps"
  | "atr.atrLength"
  | "atr.atrFilter.minAtrBps"
  | "atr.atrFilter.maxAtrBps"
  | "risk.riskPctPerTrade"
  | "risk.fixedNotional"
  | "risk.atrStopMultiple"
  | "risk.tpRMultiple"
  | "risk.atrTrailMultiple"
  | "risk.barsAfterEntry"
  | "execution.feeBps"
  | "execution.slippageBps";

type NumberFieldState = Readonly<Record<ParamNumberFieldId, string>>;

function intervalToMinutes(interval: IntervalId): number {
  const map: Readonly<Record<IntervalId, number>> = {
    "1m": 1,
    "2m": 2,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "60m": 60,
    "90m": 90,
    "1h": 60,
    "1d": 1440
  };

  return map[interval];
}

function copyName(original: string): string {
  const trimmed = original.trim();
  return trimmed.length > 0 ? `${trimmed} (copy)` : "Copy";
}

function issuesToMap(issues: readonly ValidationIssue[]): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};

  for (const issue of issues) {
    if (!map[issue.path]) {
      map[issue.path] = issue.message;
    }
  }

  return map;
}

function initNumberFields(params: StrategyParams): NumberFieldState {
  return {
    "entry.breakoutBufferBps": String(params.entry.breakoutBufferBps),
    "atr.atrLength": String(params.atr.atrLength),
    "atr.atrFilter.minAtrBps": String(params.atr.atrFilter.minAtrBps),
    "atr.atrFilter.maxAtrBps": String(params.atr.atrFilter.maxAtrBps),
    "risk.riskPctPerTrade": String(params.risk.riskPctPerTrade),
    "risk.fixedNotional": String(params.risk.fixedNotional),
    "risk.atrStopMultiple": String(params.risk.atrStopMultiple),
    "risk.tpRMultiple": String(params.risk.tpRMultiple),
    "risk.atrTrailMultiple": String(params.risk.atrTrailMultiple),
    "risk.barsAfterEntry": String(params.risk.barsAfterEntry),
    "execution.feeBps": String(params.execution.feeBps),
    "execution.slippageBps": String(params.execution.slippageBps)
  };
}

function buildParams(draft: StrategyParams, numbers: NumberFieldState): Readonly<{ params: StrategyParams | null; issues: ValidationIssue[]; fieldErrors: Readonly<Record<string, string>> }> {
  const fieldErrors: Record<string, string> = {};

  const breakoutBuffer = parseNumber(numbers["entry.breakoutBufferBps"], { min: 0 });
  const atrLength = parseNumber(numbers["atr.atrLength"], { min: 1 });
  const minAtrBps = parseNumber(numbers["atr.atrFilter.minAtrBps"], { min: 0 });
  const maxAtrBps = parseNumber(numbers["atr.atrFilter.maxAtrBps"], { min: 0 });
  const riskPctPerTrade = parseNumber(numbers["risk.riskPctPerTrade"], { min: 0 });
  const fixedNotional = parseNumber(numbers["risk.fixedNotional"], { min: 0 });
  const atrStopMultiple = parseNumber(numbers["risk.atrStopMultiple"], { min: 0 });
  const tpRMultiple = parseNumber(numbers["risk.tpRMultiple"], { min: 0 });
  const atrTrailMultiple = parseNumber(numbers["risk.atrTrailMultiple"], { min: 0 });
  const barsAfterEntry = parseNumber(numbers["risk.barsAfterEntry"], { min: 0 });
  const feeBps = parseNumber(numbers["execution.feeBps"], { min: 0 });
  const slippageBps = parseNumber(numbers["execution.slippageBps"], { min: 0 });

  const parsedMap: Readonly<Record<ParamNumberFieldId, { value: number | null; error: string | null }>> = {
    "entry.breakoutBufferBps": breakoutBuffer,
    "atr.atrLength": atrLength,
    "atr.atrFilter.minAtrBps": minAtrBps,
    "atr.atrFilter.maxAtrBps": maxAtrBps,
    "risk.riskPctPerTrade": riskPctPerTrade,
    "risk.fixedNotional": fixedNotional,
    "risk.atrStopMultiple": atrStopMultiple,
    "risk.tpRMultiple": tpRMultiple,
    "risk.atrTrailMultiple": atrTrailMultiple,
    "risk.barsAfterEntry": barsAfterEntry,
    "execution.feeBps": feeBps,
    "execution.slippageBps": slippageBps
  };

  for (const [k, v] of Object.entries(parsedMap)) {
    if (v.error) {
      fieldErrors[k] = v.error;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { params: null, issues: [{ path: "form", message: "Fix invalid numeric inputs" }], fieldErrors };
  }

  const params: StrategyParams = {
    ...draft,
    entry: {
      ...draft.entry,
      breakoutBufferBps: breakoutBuffer.value ?? 0
    },
    atr: {
      ...draft.atr,
      atrLength: atrLength.value ?? 14,
      atrFilter: {
        ...draft.atr.atrFilter,
        minAtrBps: minAtrBps.value ?? 0,
        maxAtrBps: maxAtrBps.value ?? 0
      }
    },
    risk: {
      ...draft.risk,
      riskPctPerTrade: riskPctPerTrade.value ?? 0,
      fixedNotional: fixedNotional.value ?? 0,
      atrStopMultiple: atrStopMultiple.value ?? 0,
      tpRMultiple: tpRMultiple.value ?? 0,
      atrTrailMultiple: atrTrailMultiple.value ?? 0,
      barsAfterEntry: barsAfterEntry.value ?? 0
    },
    execution: {
      ...draft.execution,
      feeBps: feeBps.value ?? 0,
      slippageBps: slippageBps.value ?? 0
    }
  };

  const issues = validateStrategyParams(params);
  return { params: issues.length === 0 ? params : null, issues, fieldErrors };
}

/**
 * Parameter set editor.
 *
 * API note:
 * - v1 API contracts define create/list/get, but do not define update.
 * - In "edit" mode, we allow the user to tweak fields and "Save as new".
 */
export function ParameterSetEditorPage(props: Readonly<{ mode: "create" | "edit" }>): React.ReactElement {
  const navigate = useNavigate();
  const params = useParams();
  const id = props.mode === "edit" ? params.id ?? null : null;

  const [loaded, setLoaded] = useState<ParameterSet | null>(null);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [draft, setDraft] = useState<StrategyParams>(() => createDefaultStrategyParams());
  const [numbers, setNumbers] = useState<NumberFieldState>(() => initNumberFields(createDefaultStrategyParams()));
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const validationMap = useMemo(() => issuesToMap(issues), [issues]);

  const openingRangeWarning = useMemo(() => {
    const barMinutes = intervalToMinutes(draft.interval);
    const orMinutes = draft.session.openingRangeMinutes;

    if (orMinutes < barMinutes) {
      return `Opening range (${orMinutes}m) is smaller than interval (${barMinutes}m). This is usually not meaningful.`;
    }

    return null;
  }, [draft.interval, draft.session.openingRangeMinutes]);

  const loadIfNeeded = useCallback(async () => {
    if (props.mode !== "edit" || !id) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ps = await apiGetParameterSet(id);
      setLoaded(ps);
      setName(ps.name);
      setDescription(ps.description ?? "");

      const parsed = parseStrategyParams(ps.params);

      if (!parsed) {
        throw new Error("This parameter set has an invalid params payload (expected StrategyParams v1.0)");
      }

      setDraft(parsed);
      setNumbers(initNumberFields(parsed));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load parameter set");
    } finally {
      setIsLoading(false);
    }
  }, [id, props.mode]);

  useEffect(() => {
    void loadIfNeeded();
  }, [loadIfNeeded]);

  const onSave = useCallback(
    async (mode: "create" | "save_as_new") => {
      setError(null);
      setIssues([]);
      setFieldErrors({});

      const trimmedName = name.trim();

      if (trimmedName.length === 0) {
        setError("Name is required");
        return;
      }

      const built = buildParams(draft, numbers);
      setIssues(built.issues);
      setFieldErrors(built.fieldErrors);

      if (!built.params) {
        return;
      }

      setIsLoading(true);

      try {
        const desc = description.trim();
        const req =
          desc.length > 0
            ? { name: mode === "save_as_new" && loaded ? copyName(trimmedName) : trimmedName, description: desc, params: built.params }
            : { name: mode === "save_as_new" && loaded ? copyName(trimmedName) : trimmedName, params: built.params };

        const created = await apiCreateParameterSet(req);

        navigate(`/parameter-sets/${created.id}`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to save parameter set");
      } finally {
        setIsLoading(false);
      }
    },
    [description, draft, loaded, name, navigate, numbers]
  );

  const symbolOptions = useMemo(
    () => SUPPORTED_SYMBOLS.map((s) => ({ value: s, label: s })),
    []
  );

  const intervalOptions = useMemo(
    () => SUPPORTED_INTERVALS.map((i) => ({ value: i, label: i })),
    []
  );

  const directionOptions = useMemo(
    () =>
      [
        { value: "long_only" satisfies DirectionMode, label: "Long only" },
        { value: "short_only" satisfies DirectionMode, label: "Short only" },
        { value: "long_short" satisfies DirectionMode, label: "Long + Short" }
      ] as const,
    []
  );

  const entryModeOptions = useMemo(
    () =>
      [
        { value: "stop_breakout" satisfies EntryMode, label: "Stop breakout", description: "Triggers when price trades beyond OR levels" },
        { value: "close_confirm" satisfies EntryMode, label: "Close confirm", description: "Triggers when a bar closes beyond OR levels" }
      ] as const,
    []
  );

  const sizingModeOptions = useMemo(
    () =>
      [
        { value: "fixed_risk_pct" satisfies SizingMode, label: "Fixed risk %" },
        { value: "fixed_notional" satisfies SizingMode, label: "Fixed notional" }
      ] as const,
    []
  );

  const stopModeOptions = useMemo(
    () =>
      [
        { value: "atr_multiple" satisfies StopMode, label: "ATR multiple" },
        { value: "or_opposite" satisfies StopMode, label: "OR opposite" },
        { value: "or_midpoint" satisfies StopMode, label: "OR midpoint" }
      ] as const,
    []
  );

  const tpEnabled = draft.risk.takeProfitMode !== "disabled";
  const trailingEnabled = draft.risk.trailingStopMode !== "disabled";
  const timeExitEnabled = draft.risk.timeExitMode !== "disabled";

  const openingRangeValue = useMemo<"5" | "15" | "30" | "60">(() => {
    if (draft.session.openingRangeMinutes === 5) {
      return "5";
    }

    if (draft.session.openingRangeMinutes === 15) {
      return "15";
    }

    if (draft.session.openingRangeMinutes === 30) {
      return "30";
    }

    return "60";
  }, [draft.session.openingRangeMinutes]);

  const maxTradesValue = useMemo<"1" | "2">(() => {
    return draft.entry.maxTradesPerSession === 1 ? "1" : "2";
  }, [draft.entry.maxTradesPerSession]);

  const setSymbol = useCallback(
    (symbol: SymbolId) => {
      setDraft((prev) => ({ ...prev, symbol }));
    },
    []
  );

  const setInterval = useCallback(
    (interval: IntervalId) => {
      setDraft((prev) => ({ ...prev, interval }));
    },
    []
  );

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="col">
          <p className="h1" style={{ marginBottom: 2 }}>
            {props.mode === "create" ? "Create Parameter Set" : "Parameter Set"}
          </p>
          <span className="muted">Maps 1:1 to the strategy schema in docs.</span>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <Link className="btn" to="/parameter-sets">
            Back
          </Link>
          {props.mode === "create" ? (
            <button className="btn btnPrimary" type="button" onClick={() => void onSave("create")} disabled={isLoading}>
              Save
            </button>
          ) : (
            <button className="btn btnPrimary" type="button" onClick={() => void onSave("save_as_new")} disabled={isLoading}>
              Save as new
            </button>
          )}
        </div>
      </div>

      <div className="hr" />

      {error ? <div className="errorBox" style={{ marginBottom: 12 }}>{error}</div> : null}
      {props.mode === "edit" ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardBody">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {id ? `Loaded ID: ${id}` : "Missing ID"}
              </span>
              <button className="btn" type="button" onClick={() => void loadIfNeeded()} disabled={isLoading}>
                Reload
              </button>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Update endpoint is not defined in v1 API contracts; use “Save as new”.
            </div>
          </div>
        </div>
      ) : null}

      {openingRangeWarning ? <div className="errorBox" style={{ marginBottom: 12 }}>{openingRangeWarning}</div> : null}

      {issues.length > 0 ? (
        <div className="errorBox" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Validation issues</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {issues.map((i) => (
              <li key={`${i.path}:${i.message}`}>{`${i.path}: ${i.message}`}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Metadata</p>
        </div>
        <div className="cardBody">
          <div className="row">
            <label className="col" style={{ flex: 1, minWidth: 260 }}>
              <span className="label">Name</span>
              <input className="input" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="My ORB config" />
            </label>
            <label className="col" style={{ flex: 1, minWidth: 260 }}>
              <span className="label">Description (optional)</span>
              <input className="input" value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder="Notes" />
            </label>
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Instrument</p>
        </div>
        <div className="cardBody">
          <div className="row">
            <SelectField<SymbolId> label="Symbol" value={draft.symbol} options={symbolOptions} onChange={setSymbol} />
            <SelectField<IntervalId> label="Effective interval" value={draft.interval} options={intervalOptions} onChange={setInterval} />
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Session</p>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Timezone fixed to America/New_York. Session start fixed to 09:30.
          </p>
        </div>
        <div className="cardBody">
          <SelectField<"5" | "15" | "30" | "60">
            label="Opening range minutes"
            value={openingRangeValue}
            options={[
              { value: "5", label: "5" },
              { value: "15", label: "15" },
              { value: "30", label: "30" },
              { value: "60", label: "60" }
            ]}
            onChange={(v) => {
              const next = Number(v);
              if (next === 5 || next === 15 || next === 30 || next === 60) {
                setDraft((prev) => ({
                  ...prev,
                  session: {
                    ...prev.session,
                    openingRangeMinutes: next
                  }
                }));
              }
            }}
          />
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Entry</p>
        </div>
        <div className="cardBody">
          <RadioGroup<DirectionMode>
            label="Direction mode"
            value={draft.entry.directionMode}
            options={directionOptions}
            onChange={(directionMode) => setDraft((prev) => ({ ...prev, entry: { ...prev.entry, directionMode } }))}
          />

          <div style={{ height: 10 }} />

          <RadioGroup<EntryMode>
            label="Entry mode"
            value={draft.entry.entryMode}
            options={entryModeOptions}
            onChange={(entryMode) => setDraft((prev) => ({ ...prev, entry: { ...prev.entry, entryMode } }))}
          />

          <div style={{ height: 10 }} />

          <div className="row">
            <NumberField
              label="Breakout buffer (bps)"
              value={numbers["entry.breakoutBufferBps"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "entry.breakoutBufferBps": v }))}
              min={0}
              step={1}
              error={fieldErrors["entry.breakoutBufferBps"] ?? validationMap["entry.breakoutBufferBps"] ?? null}
            />

            <SelectField<"1" | "2">
              label="Max trades per session"
              value={maxTradesValue}
              options={[
                { value: "1", label: "1" },
                { value: "2", label: "2" }
              ]}
              onChange={(v) => {
                const next = Number(v);
                if (next === 1 || next === 2) {
                  setDraft((prev) => ({ ...prev, entry: { ...prev.entry, maxTradesPerSession: next } }));
                }
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">ATR</p>
        </div>
        <div className="cardBody">
          <div className="row">
            <NumberField
              label="ATR length"
              value={numbers["atr.atrLength"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "atr.atrLength": v }))}
              min={1}
              step={1}
              error={fieldErrors["atr.atrLength"] ?? validationMap["atr.atrLength"] ?? null}
            />
          </div>

          <div style={{ height: 10 }} />

          <ToggleSwitch
            label="ATR filter"
            checked={draft.atr.atrFilter.enabled}
            onChange={(enabled) => setDraft((prev) => ({ ...prev, atr: { ...prev.atr, atrFilter: { ...prev.atr.atrFilter, enabled } } }))}
            description="Trade only if ATR is within the configured band."
          />

          {draft.atr.atrFilter.enabled ? (
            <div style={{ marginTop: 10 }} className="row">
              <NumberField
                label="Min ATR (bps)"
                value={numbers["atr.atrFilter.minAtrBps"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "atr.atrFilter.minAtrBps": v }))}
                min={0}
                step={1}
                error={fieldErrors["atr.atrFilter.minAtrBps"] ?? validationMap["atr.atrFilter.minAtrBps"] ?? null}
              />
              <NumberField
                label="Max ATR (bps)"
                value={numbers["atr.atrFilter.maxAtrBps"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "atr.atrFilter.maxAtrBps": v }))}
                min={0}
                step={1}
                error={fieldErrors["atr.atrFilter.maxAtrBps"] ?? validationMap["atr.atrFilter.maxAtrBps"] ?? null}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Risk</p>
        </div>
        <div className="cardBody">
          <RadioGroup<SizingMode>
            label="Sizing mode"
            value={draft.risk.sizingMode}
            options={sizingModeOptions}
            onChange={(sizingMode) => setDraft((prev) => ({ ...prev, risk: { ...prev.risk, sizingMode } }))}
          />

          <div style={{ height: 10 }} />

          {draft.risk.sizingMode === "fixed_risk_pct" ? (
            <NumberField
              label="Risk % per trade"
              value={numbers["risk.riskPctPerTrade"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.riskPctPerTrade": v }))}
              min={0}
              step={0.01}
              help="Example: 0.5 means 0.5% of equity risked per trade."
              error={fieldErrors["risk.riskPctPerTrade"] ?? validationMap["risk.riskPctPerTrade"] ?? null}
            />
          ) : (
            <NumberField
              label="Fixed notional"
              value={numbers["risk.fixedNotional"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.fixedNotional": v }))}
              min={0}
              step={1}
              help="Example: 1000 means $1000 per trade."
              error={fieldErrors["risk.fixedNotional"] ?? validationMap["risk.fixedNotional"] ?? null}
            />
          )}

          <div style={{ height: 10 }} />

          <RadioGroup<StopMode>
            label="Stop mode"
            value={draft.risk.stopMode}
            options={stopModeOptions}
            onChange={(stopMode) => setDraft((prev) => ({ ...prev, risk: { ...prev.risk, stopMode } }))}
          />

          {draft.risk.stopMode === "atr_multiple" ? (
            <div style={{ marginTop: 10 }}>
              <NumberField
                label="ATR stop multiple"
                value={numbers["risk.atrStopMultiple"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.atrStopMultiple": v }))}
                min={0}
                step={0.1}
                error={fieldErrors["risk.atrStopMultiple"] ?? validationMap["risk.atrStopMultiple"] ?? null}
              />
            </div>
          ) : null}

          <div style={{ height: 10 }} />

          <ToggleSwitch
            label="Take profit"
            checked={tpEnabled}
            onChange={(checked) =>
              setDraft((prev) => ({
                ...prev,
                risk: {
                  ...prev.risk,
                  takeProfitMode: checked ? ("r_multiple" satisfies TakeProfitMode) : "disabled"
                }
              }))
            }
            description="Enable/disable TP (R-multiple)."
          />

          {tpEnabled ? (
            <div style={{ marginTop: 10 }}>
              <NumberField
                label="TP R multiple"
                value={numbers["risk.tpRMultiple"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.tpRMultiple": v }))}
                min={0}
                step={0.1}
                error={fieldErrors["risk.tpRMultiple"] ?? validationMap["risk.tpRMultiple"] ?? null}
              />
            </div>
          ) : null}

          <div style={{ height: 10 }} />

          <ToggleSwitch
            label="Trailing stop"
            checked={trailingEnabled}
            onChange={(checked) =>
              setDraft((prev) => ({
                ...prev,
                risk: {
                  ...prev.risk,
                  trailingStopMode: checked ? ("atr_trailing" satisfies TrailingStopMode) : "disabled"
                }
              }))
            }
            description="Enable/disable trailing stop (ATR-based)."
          />

          {trailingEnabled ? (
            <div style={{ marginTop: 10 }}>
              <NumberField
                label="ATR trail multiple"
                value={numbers["risk.atrTrailMultiple"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.atrTrailMultiple": v }))}
                min={0}
                step={0.1}
                error={fieldErrors["risk.atrTrailMultiple"] ?? validationMap["risk.atrTrailMultiple"] ?? null}
              />
            </div>
          ) : null}

          <div style={{ height: 10 }} />

          <ToggleSwitch
            label="Time exit"
            checked={timeExitEnabled}
            onChange={(checked) =>
              setDraft((prev) => ({
                ...prev,
                risk: {
                  ...prev.risk,
                  timeExitMode: checked ? ("bars_after_entry" satisfies TimeExitMode) : "disabled"
                }
              }))
            }
            description="Enable/disable time-based exits."
          />

          {timeExitEnabled ? (
            <div style={{ marginTop: 10 }} className="row">
              <SelectField<Exclude<TimeExitMode, "disabled">>
                label="Time exit mode"
                value={draft.risk.timeExitMode === "session_end" ? "session_end" : "bars_after_entry"}
                options={[
                  { value: "bars_after_entry", label: "Bars after entry" },
                  { value: "session_end", label: "Session end" }
                ]}
                onChange={(timeExitMode) => setDraft((prev) => ({ ...prev, risk: { ...prev.risk, timeExitMode } }))}
              />

              {draft.risk.timeExitMode === "bars_after_entry" ? (
                <NumberField
                  label="Bars after entry"
                  value={numbers["risk.barsAfterEntry"]}
                  onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.barsAfterEntry": v }))}
                  min={0}
                  step={1}
                  error={fieldErrors["risk.barsAfterEntry"] ?? validationMap["risk.barsAfterEntry"] ?? null}
                />
              ) : (
                <label className="col" style={{ gap: 6, minWidth: 220 }}>
                  <span className="label">Session end time</span>
                  <input
                    className="input"
                    value={draft.risk.sessionEndTime}
                    onChange={(ev) => setDraft((prev) => ({ ...prev, risk: { ...prev.risk, sessionEndTime: ev.target.value } }))}
                    placeholder="16:00"
                  />
                  {validationMap["risk.sessionEndTime"] ? (
                    <span style={{ color: "var(--danger)", fontSize: 12 }}>{validationMap["risk.sessionEndTime"]}</span>
                  ) : null}
                </label>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Execution realism</p>
        </div>
        <div className="cardBody">
          <div className="row">
            <NumberField
              label="Fee (bps)"
              value={numbers["execution.feeBps"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "execution.feeBps": v }))}
              min={0}
              step={1}
              error={fieldErrors["execution.feeBps"] ?? validationMap["execution.feeBps"] ?? null}
            />
            <NumberField
              label="Slippage (bps)"
              value={numbers["execution.slippageBps"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "execution.slippageBps": v }))}
              min={0}
              step={1}
              error={fieldErrors["execution.slippageBps"] ?? validationMap["execution.slippageBps"] ?? null}
            />
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="cardHeader">
          <p className="h2">Raw params (for reproducibility)</p>
        </div>
        <div className="cardBody">
          <JsonViewer value={draft} />
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}
