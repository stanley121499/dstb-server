import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Save, Copy, RefreshCw } from "lucide-react";

import { NumberField } from "../components/NumberField";
import { RadioGroup } from "../components/RadioGroup";
import { SelectField } from "../components/SelectField";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { JsonViewer } from "../components/JsonViewer";
import { Tooltip } from "../components/Tooltip";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";

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
import { helpText } from "../lib/helpText";

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
    <div className="page-container max-w-5xl">
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-2">
          <h1 className="text-display font-bold">
            {props.mode === "create" ? "Create Strategy" : "Edit Strategy"}
          </h1>
          <p className="text-body text-muted-foreground">Configure your opening range breakout strategy parameters</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" asChild>
            <Link to="/strategies">Cancel</Link>
          </Button>
          {props.mode === "create" ? (
            <Button onClick={() => void onSave("create")} disabled={isLoading}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          ) : (
            <Button onClick={() => void onSave("save_as_new")} disabled={isLoading}>
              <Copy className="h-4 w-4 mr-2" />
              Save as New
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-small text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      )}
      {props.mode === "edit" && (
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div className="space-y-1">
                <p className="text-caption text-muted-foreground">
                  {id ? `Loaded ID: ${id}` : "Missing ID"}
                </p>
                <p className="text-caption text-muted-foreground">
                  Update endpoint is not defined in v1 API contracts; use "Save as new".
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void loadIfNeeded()} disabled={isLoading}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reload
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {openingRangeWarning && (
        <Card className="mb-6 border-warning/50 bg-warning/5">
          <CardContent className="pt-6">
            <p className="text-small text-warning-foreground font-medium">{openingRangeWarning}</p>
          </CardContent>
        </Card>
      )}

      {issues.length > 0 && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-small font-semibold text-destructive mb-3">Validation Issues</p>
            <ul className="list-disc list-inside space-y-1">
              {issues.map((i) => (
                <li key={`${i.path}:${i.message}`} className="text-small text-destructive">
                  <span className="font-medium">{i.path}:</span> {i.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
          <CardDescription>Basic information about this strategy configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="My ORB config" />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder="Notes" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Instrument</CardTitle>
          <CardDescription>Select the symbol and timeframe for this strategy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectField<SymbolId> label="Symbol" value={draft.symbol} options={symbolOptions} onChange={setSymbol} />
            <SelectField<IntervalId> label="Effective interval" value={draft.interval} options={intervalOptions} onChange={setInterval} />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Timezone fixed to America/New_York. Session start fixed to 09:30.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Entry</CardTitle>
          <CardDescription>Configure how trades are entered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup<DirectionMode>
            label="Direction mode"
            value={draft.entry.directionMode}
            options={directionOptions}
            onChange={(directionMode) => setDraft((prev) => ({ ...prev, entry: { ...prev.entry, directionMode } }))}
          />

          <Separator />

          <RadioGroup<EntryMode>
            label="Entry mode"
            value={draft.entry.entryMode}
            options={entryModeOptions}
            onChange={(entryMode) => setDraft((prev) => ({ ...prev, entry: { ...prev.entry, entryMode } }))}
          />

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>ATR (Average True Range)</CardTitle>
          <CardDescription>Configure volatility measurement for position sizing and stops</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tooltip content={helpText.strategy.atrLength}>
            <NumberField
              label="ATR length"
              value={numbers["atr.atrLength"]}
              onChange={(v) => setNumbers((prev) => ({ ...prev, "atr.atrLength": v }))}
              min={1}
              step={1}
              error={fieldErrors["atr.atrLength"] ?? validationMap["atr.atrLength"] ?? null}
            />
          </Tooltip>

          <div style={{ height: 10 }} />

          <ToggleSwitch
            label="ATR filter"
            checked={draft.atr.atrFilter.enabled}
            onChange={(enabled) => setDraft((prev) => ({ ...prev, atr: { ...prev.atr, atrFilter: { ...prev.atr.atrFilter, enabled } } }))}
            description="Trade only if ATR is within the configured band."
          />

          {draft.atr.atrFilter.enabled ? (
            <div style={{ marginTop: 10 }} className="row">
              <Tooltip content={helpText.strategy.atrFilterMin}>
                <NumberField
                  label="Min ATR (bps)"
                  value={numbers["atr.atrFilter.minAtrBps"]}
                  onChange={(v) => setNumbers((prev) => ({ ...prev, "atr.atrFilter.minAtrBps": v }))}
                  min={0}
                  step={1}
                  error={fieldErrors["atr.atrFilter.minAtrBps"] ?? validationMap["atr.atrFilter.minAtrBps"] ?? null}
                />
              </Tooltip>
              <Tooltip content={helpText.strategy.atrFilterMax}>
                <NumberField
                  label="Max ATR (bps)"
                  value={numbers["atr.atrFilter.maxAtrBps"]}
                  onChange={(v) => setNumbers((prev) => ({ ...prev, "atr.atrFilter.maxAtrBps": v }))}
                  min={0}
                  step={1}
                  error={fieldErrors["atr.atrFilter.maxAtrBps"] ?? validationMap["atr.atrFilter.maxAtrBps"] ?? null}
                />
              </Tooltip>
            </div>
          ) : null}
        </CardContent>
      </Card>

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
            <Tooltip content={helpText.strategy.riskPctPerTrade}>
              <NumberField
                label="Risk % per trade"
                value={numbers["risk.riskPctPerTrade"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.riskPctPerTrade": v }))}
                min={0}
                step={0.01}
                help="Example: 0.5 means 0.5% of equity risked per trade."
                error={fieldErrors["risk.riskPctPerTrade"] ?? validationMap["risk.riskPctPerTrade"] ?? null}
              />
            </Tooltip>
          ) : (
            <Tooltip content={helpText.strategy.fixedNotional}>
              <NumberField
                label="Fixed notional"
                value={numbers["risk.fixedNotional"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.fixedNotional": v }))}
                min={0}
                step={1}
                help="Example: 1000 means $1000 per trade."
                error={fieldErrors["risk.fixedNotional"] ?? validationMap["risk.fixedNotional"] ?? null}
              />
            </Tooltip>
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
              <Tooltip content={helpText.strategy.atrStopMultiple}>
                <NumberField
                  label="ATR stop multiple"
                  value={numbers["risk.atrStopMultiple"]}
                  onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.atrStopMultiple": v }))}
                  min={0}
                  step={0.1}
                  error={fieldErrors["risk.atrStopMultiple"] ?? validationMap["risk.atrStopMultiple"] ?? null}
                />
              </Tooltip>
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
              <Tooltip content={helpText.strategy.tpRMultiple}>
                <NumberField
                  label="TP R multiple"
                  value={numbers["risk.tpRMultiple"]}
                  onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.tpRMultiple": v }))}
                  min={0}
                  step={0.1}
                  error={fieldErrors["risk.tpRMultiple"] ?? validationMap["risk.tpRMultiple"] ?? null}
                />
              </Tooltip>
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
              <Tooltip content={helpText.strategy.atrTrailMultiple}>
                <NumberField
                  label="ATR trail multiple"
                  value={numbers["risk.atrTrailMultiple"]}
                  onChange={(v) => setNumbers((prev) => ({ ...prev, "risk.atrTrailMultiple": v }))}
                  min={0}
                  step={0.1}
                  error={fieldErrors["risk.atrTrailMultiple"] ?? validationMap["risk.atrTrailMultiple"] ?? null}
                />
              </Tooltip>
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
            <Tooltip content={helpText.strategy.feeBps}>
              <NumberField
                label="Fee (bps)"
                value={numbers["execution.feeBps"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "execution.feeBps": v }))}
                min={0}
                step={1}
                error={fieldErrors["execution.feeBps"] ?? validationMap["execution.feeBps"] ?? null}
              />
            </Tooltip>
            <Tooltip content={helpText.strategy.slippageBps}>
              <NumberField
                label="Slippage (bps)"
                value={numbers["execution.slippageBps"]}
                onChange={(v) => setNumbers((prev) => ({ ...prev, "execution.slippageBps": v }))}
                min={0}
                step={1}
                error={fieldErrors["execution.slippageBps"] ?? validationMap["execution.slippageBps"] ?? null}
              />
            </Tooltip>
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

 


