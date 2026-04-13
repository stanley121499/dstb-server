"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { cloneAnalyzer, updateAnalyzer } from "@/app/behavior/analyzers/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MonacoEditor = dynamic(async () => (await import("@monaco-editor/react")).default, {
  ssr: false,
  loading: () => <div className="text-muted-foreground h-[320px] rounded-md border p-4 text-sm">Loading editor…</div>,
});

export type AnalyzerRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  description: string | null;
  code: string;
  execution_mode: string;
  param_defaults: Record<string, unknown>;
  param_schema: Record<string, unknown>;
  version: number;
  tested: boolean;
}>;

export type RawCycleOption = Readonly<{
  id: string;
  symbol: string;
  cycle_date: string;
}>;

type Props = Readonly<{
  analyzer: AnalyzerRow;
  rawCycles: RawCycleOption[];
}>;

function jsonStringifyPretty(v: Record<string, unknown>): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "{}";
  }
}

/**
 * Analyzer detail: Monaco code, LLM prompt panel, test run via API proxy, save / clone.
 */
export function BehaviorAnalyzerDetailClient(props: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(props.analyzer.name);
  const [description, setDescription] = useState(props.analyzer.description ?? "");
  const [code, setCode] = useState(props.analyzer.code);
  const [executionMode, setExecutionMode] = useState(props.analyzer.execution_mode);
  const [paramDefaultsJson, setParamDefaultsJson] = useState(jsonStringifyPretty(props.analyzer.param_defaults));
  const [paramSchemaJson, setParamSchemaJson] = useState(jsonStringifyPretty(props.analyzer.param_schema));
  const [rawCycleId, setRawCycleId] = useState(props.rawCycles[0]?.id ?? "");
  const [testOutput, setTestOutput] = useState<string>("");
  const [testPending, setTestPending] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [promptMd, setPromptMd] = useState<string>("");
  const [cloneSlug, setCloneSlug] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [nlRules, setNlRules] = useState("");
  const [genPending, setGenPending] = useState(false);

  useEffect(() => {
    void fetch("/behavior-analyzer-prompt.md")
      .then((r) => r.text())
      .then(setPromptMd)
      .catch(() => {
        setPromptMd("Could not load prompt template.");
      });
  }, []);

  const onSave = useCallback(() => {
    setMessage("");
    startTransition(() => {
      void (async () => {
        const em = executionMode === "native_s2" ? "native_s2" : "sandbox";
        const res = await updateAnalyzer({
          id: props.analyzer.id,
          name,
          description,
          code,
          execution_mode: em,
          param_defaults_json: paramDefaultsJson,
          param_schema_json: paramSchemaJson,
        });
        if (res.ok) {
          setMessage("Saved.");
          router.refresh();
        } else {
          setMessage(res.message);
        }
      })();
    });
  }, [
    code,
    description,
    executionMode,
    name,
    paramDefaultsJson,
    paramSchemaJson,
    props.analyzer.id,
    router,
  ]);

  const onTestRun = useCallback(() => {
    setTestOutput("");
    setMessage("");
    if (rawCycleId.length === 0) {
      setMessage("Select a raw cycle for Test Run.");
      return;
    }
    setTestPending(true);
    void (async () => {
      try {
        const res = await fetch("/api/behavior/test-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            raw_cycle_id: rawCycleId,
            analyzer_id: props.analyzer.id,
            code_override: code !== props.analyzer.code ? code : undefined,
            execution_mode_override: executionMode !== props.analyzer.execution_mode ? executionMode : undefined,
          }),
        });
        const json = (await res.json()) as unknown;
        if (!res.ok) {
          const err =
            typeof json === "object" && json !== null && "error" in json && typeof (json as { error: string }).error === "string"
              ? (json as { error: string }).error
              : `HTTP ${String(res.status)}`;
          setMessage(err);
          return;
        }
        setTestOutput(JSON.stringify(json, null, 2));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setTestPending(false);
      }
    })();
  }, [code, executionMode, props.analyzer.execution_mode, props.analyzer.code, props.analyzer.id, rawCycleId]);

  const onGenerateCode = useCallback(() => {
    setMessage("");
    if (nlRules.trim().length === 0) {
      setMessage("Describe your rules in natural language first.");
      return;
    }
    setGenPending(true);
    void (async () => {
      try {
        const res = await fetch("/api/behavior/generate-analyzer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            natural_language: nlRules.trim(),
            existing_code: code.length > 0 ? code : undefined,
            slug: props.analyzer.slug
          })
        });
        const json = (await res.json()) as { error?: string; code?: string };
        if (!res.ok) {
          setMessage(typeof json.error === "string" ? json.error : `HTTP ${String(res.status)}`);
          return;
        }
        if (typeof json.code === "string" && json.code.length > 0) {
          setCode(json.code);
          setMessage("Generated code applied to the editor (not saved yet).");
        } else {
          setMessage("No code returned.");
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setGenPending(false);
      }
    })();
  }, [code, nlRules, props.analyzer.slug]);

  const onClone = useCallback(() => {
    setMessage("");
    startTransition(() => {
      void (async () => {
        const res = await cloneAnalyzer({
          sourceId: props.analyzer.id,
          slug: cloneSlug.trim(),
          name: cloneName.trim() || `${props.analyzer.name} (copy)`,
        });
        if (res.ok) {
          router.push(`/behavior/analyzers/${res.id}`);
        } else {
          setMessage(res.message);
        }
      })();
    });
  }, [cloneName, cloneSlug, props.analyzer.id, props.analyzer.name, router]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void onSave()} disabled={pending}>
          Save (bumps version)
        </Button>
        <Button type="button" variant="secondary" onClick={() => void onTestRun()} disabled={testPending}>
          {testPending ? "Running…" : "Test Run"}
        </Button>
        <Link href="/behavior/analyzers" className="text-muted-foreground text-sm underline">
          Back to list
        </Link>
      </div>
      {message.length > 0 ? <p className="text-destructive text-sm">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="an-name">Name</Label>
          <Input id="an-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="an-slug">Slug (read-only)</Label>
          <Input id="an-slug" value={props.analyzer.slug} readOnly className="bg-muted" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="an-desc">Description</Label>
        <Textarea id="an-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="an-mode">Execution mode</Label>
        <select
          id="an-mode"
          className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full max-w-xs rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
          value={executionMode}
          onChange={(e) => setExecutionMode(e.target.value)}
        >
          <option value="sandbox">sandbox (LLM / JS in isolate)</option>
          <option value="native_s2">native_s2 (built-in TypeScript analyzer)</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label>Code</Label>
        <div className="overflow-hidden rounded-md border">
          <MonacoEditor
            height="320px"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={code}
            onChange={(v) => setCode(typeof v === "string" ? v : "")}
            options={{ minimap: { enabled: false }, fontSize: 13 }}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pd">param_defaults (JSON)</Label>
          <Textarea id="pd" className="font-mono text-xs" rows={8} value={paramDefaultsJson} onChange={(e) => setParamDefaultsJson(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ps">param_schema (JSON)</Label>
          <Textarea id="ps" className="font-mono text-xs" rows={8} value={paramSchemaJson} onChange={(e) => setParamSchemaJson(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test Run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="rc">Raw cycle</Label>
            <select
              id="rc"
              className="border-input bg-background flex h-9 w-full max-w-md rounded-md border px-3 text-sm"
              value={rawCycleId}
              onChange={(e) => setRawCycleId(e.target.value)}
            >
              {props.rawCycles.length === 0 ? <option value="">No raw cycles</option> : null}
              {props.rawCycles.map((r) => (
                <option key={r.id} value={r.id}>
                  {`${r.symbol} · ${r.cycle_date}`}
                </option>
              ))}
            </select>
          </div>
          {testOutput.length > 0 ? (
            <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs">{testOutput}</pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate code (server LLM)</CardTitle>
          <p className="text-muted-foreground text-sm">
            Requires <code className="text-xs">OPENAI_API_KEY</code> or <code className="text-xs">ANTHROPIC_API_KEY</code> on the
            dashboard host. Code replaces the editor buffer until you save.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="nl-rules">Natural language rules</Label>
            <Textarea
              id="nl-rules"
              rows={5}
              value={nlRules}
              onChange={(e) => setNlRules(e.target.value)}
              placeholder="e.g. Label the cycle ACCEPTANCE when price holds above PDH for two 15m closes…"
            />
          </div>
          <Button type="button" variant="secondary" disabled={genPending} onClick={() => void onGenerateCode()}>
            {genPending ? "Generating…" : "Generate code"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM prompt template</CardTitle>
          <p className="text-muted-foreground text-sm">Copy this spec into your LLM, then paste generated code above.</p>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted max-h-96 overflow-auto whitespace-pre-wrap rounded-md p-3 text-xs">{promptMd}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clone analyzer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="cl-slug">New slug</Label>
            <Input id="cl-slug" value={cloneSlug} onChange={(e) => setCloneSlug(e.target.value)} placeholder="my_analyzer_v2" className="w-56" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-name">New name</Label>
            <Input id="cl-name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="Display name" className="w-56" />
          </div>
          <Button type="button" variant="outline" onClick={() => void onClone()} disabled={pending || cloneSlug.trim().length === 0}>
            Clone
          </Button>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        Version {String(props.analyzer.version)} · tested: {props.analyzer.tested ? "yes" : "no"}
      </p>
    </div>
  );
}
