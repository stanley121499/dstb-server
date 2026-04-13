"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { createAnalyzer } from "@/app/behavior/analyzers/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MonacoEditor = dynamic(async () => (await import("@monaco-editor/react")).default, {
  ssr: false,
  loading: () => <div className="text-muted-foreground h-[280px] rounded-md border p-4 text-sm">Loading editor…</div>,
});

const DEFAULT_CODE = `function analyze(input) {
  var n = input.candles["15m"].length;
  return {
    label: n > 0 ? "HAS_DATA" : "NO_DATA",
    details: { barCount: n },
  };
}
`;

/**
 * Create analyzer form with Monaco and embedded prompt reference.
 */
export function BehaviorAnalyzerNewClient(): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE);
  const [executionMode, setExecutionMode] = useState<"sandbox" | "native_s2">("sandbox");
  const [paramDefaultsJson, setParamDefaultsJson] = useState("{}");
  const [paramSchemaJson, setParamSchemaJson] = useState("{}");
  const [message, setMessage] = useState("");
  const [promptMd, setPromptMd] = useState("");

  useEffect(() => {
    void fetch("/behavior-analyzer-prompt.md")
      .then((r) => r.text())
      .then(setPromptMd)
      .catch(() => {
        setPromptMd("Could not load prompt template.");
      });
  }, []);

  const onCreate = useCallback(() => {
    setMessage("");
    startTransition(() => {
      void (async () => {
        const res = await createAnalyzer({
          slug: slug.trim(),
          name: name.trim(),
          description: description.trim(),
          code,
          execution_mode: executionMode,
          param_defaults_json: paramDefaultsJson,
          param_schema_json: paramSchemaJson,
        });
        if (res.ok) {
          router.push(`/behavior/analyzers/${res.id}`);
        } else {
          setMessage(res.message);
        }
      })();
    });
  }, [code, description, executionMode, name, paramDefaultsJson, paramSchemaJson, router, slug]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void onCreate()} disabled={pending || slug.trim().length === 0 || name.trim().length === 0}>
          Create analyzer
        </Button>
      </div>
      {message.length > 0 ? <p className="text-destructive text-sm">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="n-slug">Slug</Label>
          <Input id="n-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my_label_rules" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="n-name">Name</Label>
          <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="n-desc">Description</Label>
        <Textarea id="n-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="n-mode">Execution mode</Label>
        <select
          id="n-mode"
          className="border-input bg-background flex h-9 w-full max-w-xs rounded-md border px-3 text-sm"
          value={executionMode}
          onChange={(e) => setExecutionMode(e.target.value === "native_s2" ? "native_s2" : "sandbox")}
        >
          <option value="sandbox">sandbox</option>
          <option value="native_s2">native_s2</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label>Code</Label>
        <div className="overflow-hidden rounded-md border">
          <MonacoEditor
            height="280px"
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
          <Label htmlFor="n-pd">param_defaults (JSON)</Label>
          <Textarea id="n-pd" className="font-mono text-xs" rows={6} value={paramDefaultsJson} onChange={(e) => setParamDefaultsJson(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="n-ps">param_schema (JSON)</Label>
          <Textarea id="n-ps" className="font-mono text-xs" rows={6} value={paramSchemaJson} onChange={(e) => setParamSchemaJson(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM prompt template</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted max-h-80 overflow-auto whitespace-pre-wrap rounded-md p-3 text-xs">{promptMd}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
