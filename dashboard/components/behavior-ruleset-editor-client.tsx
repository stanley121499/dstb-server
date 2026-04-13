"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { setActiveRuleset, upsertRuleset } from "@/app/behavior/rulesets/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type AnalyzerPick = Readonly<{
  id: string;
  name: string;
  slug: string;
}>;

export type RulesetEntry = Readonly<{
  analyzer_id: string;
  params: Record<string, unknown>;
}>;

type Props = Readonly<{
  rulesetId?: string;
  initialName: string;
  initialNotes: string;
  initialEntries: RulesetEntry[];
  allAnalyzers: AnalyzerPick[];
  isActive: boolean;
}>;

function paramsPretty(p: Record<string, unknown>): string {
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return "{}";
  }
}

/**
 * Ruleset builder: ordered analyzers, per-analyzer params JSON, save, run analysis, set active.
 */
export function BehaviorRulesetEditorClient(props: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(props.initialName);
  const [notes, setNotes] = useState(props.initialNotes);
  const [ordered, setOrdered] = useState<RulesetEntry[]>(() => [...props.initialEntries]);
  const [message, setMessage] = useState("");
  const [runFrom, setRunFrom] = useState("");
  const [runTo, setRunTo] = useState("");
  const [runSymbol, setRunSymbol] = useState("");
  const [runLog, setRunLog] = useState("");
  const [runPending, setRunPending] = useState(false);

  const [paramsText, setParamsText] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const e of props.initialEntries) {
      m[e.analyzer_id] = paramsPretty(e.params);
    }
    return m;
  });

  const mergeParamsFromState = useCallback((): RulesetEntry[] | { error: string } => {
    const out: RulesetEntry[] = [];
    for (const e of ordered) {
      const raw = paramsText[e.analyzer_id];
      if (raw === undefined) {
        out.push(e);
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return { error: `Params for ${e.analyzer_id} must be a JSON object` };
        }
        out.push({ analyzer_id: e.analyzer_id, params: parsed as Record<string, unknown> });
      } catch {
        return { error: `Invalid JSON for analyzer params (${e.analyzer_id})` };
      }
    }
    return out;
  }, [ordered, paramsText]);

  const onSave = useCallback(() => {
    setMessage("");
    const merged = mergeParamsFromState();
    if ("error" in merged) {
      setMessage(merged.error);
      return;
    }
    startTransition(() => {
      void (async () => {
        const res = await upsertRuleset({
          ...(props.rulesetId !== undefined ? { id: props.rulesetId } : {}),
          name: name.trim(),
          notes: notes.trim(),
          analyzers_json: JSON.stringify(merged),
        });
        if (res.ok) {
          setMessage("Saved.");
          if (props.rulesetId === undefined) {
            router.push(`/behavior/rulesets/${res.id}`);
          } else {
            router.refresh();
          }
        } else {
          setMessage(res.message);
        }
      })();
    });
  }, [mergeParamsFromState, name, notes, props.rulesetId, router]);

  const onSetActive = useCallback(() => {
    if (props.rulesetId === undefined) {
      return;
    }
    setMessage("");
    startTransition(() => {
      void (async () => {
        const res = await setActiveRuleset(props.rulesetId ?? "");
        if (res.ok) {
          setMessage("Set as active ruleset.");
          router.refresh();
        } else {
          setMessage(res.message);
        }
      })();
    });
  }, [props.rulesetId, router]);

  const onRunAnalysis = useCallback(() => {
    if (props.rulesetId === undefined) {
      setMessage("Save the ruleset before running analysis.");
      return;
    }
    setRunLog("");
    setMessage("");
    setRunPending(true);
    void (async () => {
      try {
        const body: Record<string, unknown> = { ruleset_id: props.rulesetId };
        if (runFrom.length > 0) {
          body["from"] = runFrom;
        }
        if (runTo.length > 0) {
          body["to"] = runTo;
        }
        if (runSymbol.trim().length > 0) {
          body["symbol"] = runSymbol.trim();
        }
        const res = await fetch("/api/behavior/reanalyze-ruleset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as unknown;
        setRunLog(JSON.stringify(json, null, 2));
        if (!res.ok) {
          const err =
            typeof json === "object" && json !== null && "error" in json && typeof (json as { error: string }).error === "string"
              ? (json as { error: string }).error
              : `HTTP ${String(res.status)}`;
          setMessage(err);
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setRunPending(false);
      }
    })();
  }, [props.rulesetId, runFrom, runSymbol, runTo]);

  const toggleAnalyzer = useCallback(
    (id: string, checked: boolean) => {
      setOrdered((prev) => {
        if (checked) {
          if (prev.some((p) => p.analyzer_id === id)) {
            return prev;
          }
          return [...prev, { analyzer_id: id, params: {} }];
        }
        return prev.filter((p) => p.analyzer_id !== id);
      });
      if (checked) {
        setParamsText((p) => ({ ...p, [id]: "{}" }));
      }
    },
    []
  );

  const moveEntry = useCallback((index: number, dir: -1 | 1) => {
    setOrdered((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const t = next[index];
      const u = next[j];
      if (t === undefined || u === undefined) {
        return prev;
      }
      next[index] = u;
      next[j] = t;
      return next;
    });
  }, []);

  const analyzerMeta = useCallback(
    (id: string) => props.allAnalyzers.find((a) => a.id === id),
    [props.allAnalyzers]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void onSave()} disabled={pending || name.trim().length === 0}>
          Save ruleset
        </Button>
        {props.rulesetId !== undefined ? (
          <>
            <Button type="button" variant="secondary" onClick={() => void onSetActive()} disabled={pending}>
              Set as active
            </Button>
            <Button type="button" variant="outline" onClick={() => void onRunAnalysis()} disabled={runPending}>
              {runPending ? "Running…" : "Run analysis"}
            </Button>
          </>
        ) : null}
        <Link href="/behavior/rulesets" className="text-muted-foreground text-sm underline">
          Back to rulesets
        </Link>
      </div>
      {props.isActive ? <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">This ruleset is active.</p> : null}
      {message.length > 0 ? <p className="text-destructive text-sm">{message}</p> : null}

      <div className="space-y-2">
        <Label htmlFor="rs-name">Name</Label>
        <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="rs-notes">Notes (hypothesis)</Label>
        <Textarea id="rs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyzers in ruleset</CardTitle>
          <p className="text-muted-foreground text-sm">Toggle inclusion and order. Params are merged with each analyzer&apos;s defaults.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Available</p>
            <ul className="space-y-2">
              {props.allAnalyzers.map((a) => {
                const on = ordered.some((e) => e.analyzer_id === a.id);
                return (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => toggleAnalyzer(a.id, e.target.checked)}
                      id={`chk-${a.id}`}
                    />
                    <label htmlFor={`chk-${a.id}`} className="cursor-pointer">
                      <span className="font-medium">{a.name}</span>{" "}
                      <span className="text-muted-foreground font-mono text-xs">({a.slug})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Order &amp; parameter overrides</p>
            {ordered.length === 0 ? <p className="text-muted-foreground text-sm">No analyzers selected.</p> : null}
            {ordered.map((e, idx) => {
              const meta = analyzerMeta(e.analyzer_id);
              return (
                <div key={e.analyzer_id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{meta?.name ?? e.analyzer_id}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => moveEntry(idx, -1)} disabled={idx === 0}>
                      Up
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => moveEntry(idx, 1)} disabled={idx === ordered.length - 1}>
                      Down
                    </Button>
                  </div>
                  <Label className="text-xs">params (JSON object)</Label>
                  <Textarea
                    className="font-mono text-xs"
                    rows={5}
                    value={paramsText[e.analyzer_id] ?? "{}"}
                    onChange={(ev) =>
                      setParamsText((prev) => ({
                        ...prev,
                        [e.analyzer_id]: ev.target.value,
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {props.rulesetId !== undefined ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run analysis (bot server)</CardTitle>
            <p className="text-muted-foreground text-sm">
              Recomputes `behavior_results` for this ruleset over raw cycles. Optional filters use `YYYY-MM-DD` dates.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="rf">From</Label>
              <Input id="rf" placeholder="2024-01-01" value={runFrom} onChange={(e) => setRunFrom(e.target.value)} className="w-36" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt">To</Label>
              <Input id="rt" placeholder="2024-12-31" value={runTo} onChange={(e) => setRunTo(e.target.value)} className="w-36" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rsym">Symbol</Label>
              <Input id="rsym" placeholder="e.g. BTCUSDT" value={runSymbol} onChange={(e) => setRunSymbol(e.target.value)} className="w-40" />
            </div>
            {runLog.length > 0 ? (
              <pre className="bg-muted w-full max-w-xl overflow-auto rounded-md p-2 text-xs">{runLog}</pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
