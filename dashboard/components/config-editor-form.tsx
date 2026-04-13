"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createConfigAction, updateConfigAction } from "@/app/actions/config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_ORB_ATR_PARAMS_JSON } from "@/lib/defaultOrbParams";

/** Strategy slugs that have a registered Zod schema on the server (keep in sync with lib/server/paramsValidation.ts). */
const STRATEGIES_WITH_STRICT_PARAMS = ["orb-atr"] as const;


export type VersionRow = Readonly<{
  id: string;
  version: number;
  created_at: string;
  change_note: string | null;
  params: Record<string, unknown>;
  risk_mgmt: Record<string, unknown>;
}>;

export type ConfigEditorInitial = Readonly<{
  name: string;
  strategy: string;
  symbol: string;
  interval: string;
  exchange: string;
  initial_balance: number;
  maxDailyLossPct: number;
  maxPositionSizePct: number;
  paramsJson: string;
}>;

/**
 * Hybrid config editor: labeled basics + JSON params + version history (edit mode).
 */
export function ConfigEditorForm(props: Readonly<{
  mode: "edit" | "create";
  configId?: string;
  initial: ConfigEditorInitial;
  versions?: VersionRow[];
}>): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(props.initial.name);
  const [strategy, setStrategy] = useState(props.initial.strategy);
  const [symbol, setSymbol] = useState(props.initial.symbol);
  const [interval, setInterval] = useState(props.initial.interval);
  const [exchange, setExchange] = useState(props.initial.exchange);
  const [initialBalance, setInitialBalance] = useState(String(props.initial.initial_balance));
  const [maxDailyLossPct, setMaxDailyLossPct] = useState(String(props.initial.maxDailyLossPct));
  const [maxPositionSizePct, setMaxPositionSizePct] = useState(String(props.initial.maxPositionSizePct));
  const [paramsJson, setParamsJson] = useState(props.initial.paramsJson);
  const [changeNote, setChangeNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const noStrictValidator = useMemo(() => !STRATEGIES_WITH_STRICT_PARAMS.some((s) => s === strategy), [strategy]);

  function prettyParams(): void {
    try {
      const o = JSON.parse(paramsJson) as unknown;
      setParamsJson(JSON.stringify(o, null, 2));
      setMessage(null);
    } catch {
      setMessage("Cannot pretty-print: invalid JSON.");
    }
  }

  function restoreVersion(v: VersionRow): void {
    setParamsJson(JSON.stringify(v.params, null, 2));
    const rm = v.risk_mgmt;
    const md = rm["maxDailyLossPct"];
    const mp = rm["maxPositionSizePct"];
    if (typeof md === "number" || typeof md === "string") {
      setMaxDailyLossPct(String(md));
    }
    if (typeof mp === "number" || typeof mp === "string") {
      setMaxPositionSizePct(String(mp));
    }
    setMessage("Loaded version into the form - click Save to persist.");
  }

  function onStrategyChange(next: string): void {
    setStrategy(next);
    if (next === "orb-atr" && props.mode === "create") {
      setParamsJson(DEFAULT_ORB_ATR_PARAMS_JSON);
    }
  }

  function submit(): void {
    setMessage(null);
    setWarning(null);
    const payload = {
      name,
      strategy,
      symbol,
      interval,
      exchange,
      initial_balance: Number(initialBalance),
      maxDailyLossPct: Number(maxDailyLossPct),
      maxPositionSizePct: Number(maxPositionSizePct),
      paramsJson,
      changeNote: changeNote.length > 0 ? changeNote : undefined
    };
    startTransition(() => {
      void (async () => {
        if (props.mode === "edit" && props.configId !== undefined) {
          const res = await updateConfigAction({ ...payload, configId: props.configId });
          if (!res.ok) {
            setMessage(res.message ?? "Save failed.");
            return;
          }
          if (res.warning !== undefined) {
            setWarning(res.warning);
          }
          setChangeNote("");
          router.refresh();
          setMessage("Saved.");
          return;
        }
        const res = await createConfigAction(payload);
        if (!res.ok) {
          setMessage(res.message ?? "Create failed.");
          return;
        }
        if (res.warning !== undefined) {
          setWarning(res.warning);
        }
        if (res.configId !== undefined) {
          router.push(`/config/${res.configId}`);
        }
      })();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {props.mode === "create" ? "New config" : "Edit config"}
          </h1>
          <p className="text-sm text-muted-foreground">
            API keys stay in Supabase (`credentials_ref`) - not edited here.
          </p>
        </div>

        {noStrictValidator ? (
          <Alert>
            <AlertTitle>No strict params validator</AlertTitle>
            <AlertDescription>
              This strategy is not in the Zod map yet. You can still save; tell Stanley to add a schema after you align on
              the JSON shape.
            </AlertDescription>
          </Alert>
        ) : null}

        {warning !== null ? (
          <Alert>
            <AlertTitle>Notice</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ) : null}

        {message !== null ? (
          <Alert variant={message.includes("fail") || message.includes("Invalid") ? "destructive" : "default"}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy">Strategy</Label>
              <Input
                id="strategy"
                value={strategy}
                onChange={(e) => onStrategyChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input id="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval">Interval</Label>
              <Input id="interval" value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exchange">Exchange</Label>
              <select
                id="exchange"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
              >
                <option value="paper">paper</option>
                <option value="bitunix">bitunix</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sizing &amp; risk</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="ib">Initial balance</Label>
              <Input
                id="ib"
                type="number"
                step="any"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mdl">Max daily loss %</Label>
              <Input
                id="mdl"
                type="number"
                step="any"
                value={maxDailyLossPct}
                onChange={(e) => setMaxDailyLossPct(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mps">Max position size %</Label>
              <Input
                id="mps"
                type="number"
                step="any"
                value={maxPositionSizePct}
                onChange={(e) => setMaxPositionSizePct(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Strategy params (JSON)</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={prettyParams}>
              Pretty print
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
              className="min-h-[280px] font-mono text-sm"
              spellCheck={false}
            />
            
          </CardContent>
        </Card>

        {props.mode === "edit" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change note</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What changed?" />
            </CardContent>
          </Card>
        ) : null}

        <Button type="button" disabled={pending} onClick={() => submit()}>
          {pending ? "Saving..." : props.mode === "create" ? "Create config" : "Save new version"}
        </Button>
      </div>

      {props.mode === "edit" && props.versions !== undefined && props.versions.length > 0 ? (
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="text-base">Version history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {props.versions.map((v) => (
              <div key={v.id} className="rounded-md border p-2">
                <div className="font-medium">v{v.version}</div>
                <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</div>
                {v.change_note !== null && v.change_note.length > 0 ? (
                  <div className="mt-1 text-xs">{v.change_note}</div>
                ) : null}
                <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => restoreVersion(v)}>
                  Load into editor
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
