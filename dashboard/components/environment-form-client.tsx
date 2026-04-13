"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createEnvironmentAction, updateEnvironmentAction } from "@/app/behavior/environments/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type RulesetOption = Readonly<{
  id: string;
  name: string;
}>;

type Props = Readonly<{
  mode: "create" | "edit";
  environmentId?: string;
  initialName: string;
  initialRulesetId: string;
  initialDerivedParamsJson: string;
  initialNotes: string;
  rulesets: readonly RulesetOption[];
}>;

/**
 * Create / edit behavior environment: name, optional ruleset, derived params JSON, notes.
 */
export function EnvironmentFormClient(props: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(fd: FormData): Promise<void> {
    setMessage(null);
    const name = String(fd.get("name") ?? "").trim();
    const rulesetRaw = String(fd.get("ruleset_id") ?? "").trim();
    const derivedParamsJson = String(fd.get("derived_params_json") ?? "");
    const notes = String(fd.get("notes") ?? "");

    startTransition(() => {
      void (async () => {
        if (props.mode === "create") {
          const res = await createEnvironmentAction({
            name,
            rulesetId: rulesetRaw.length > 0 ? rulesetRaw : null,
            derivedParamsJson,
            notes
          });
          if (!res.ok) {
            setMessage(res.message);
            return;
          }
          router.push(`/behavior/environments/${res.id}`);
          router.refresh();
          return;
        }
        if (props.environmentId === undefined) {
          setMessage("Missing environment id.");
          return;
        }
        const res = await updateEnvironmentAction({
          id: props.environmentId,
          name,
          rulesetId: rulesetRaw.length > 0 ? rulesetRaw : null,
          derivedParamsJson,
          notes
        });
        if (!res.ok) {
          setMessage(res.message);
          return;
        }
        router.refresh();
        setMessage("Saved.");
      })();
    });
  }

  return (
    <form action={onSubmit} className="max-w-3xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Environment name</Label>
        <Input id="name" name="name" defaultValue={props.initialName} required maxLength={300} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ruleset_id">Ruleset (optional)</Label>
        <select
          id="ruleset_id"
          name="ruleset_id"
          defaultValue={props.initialRulesetId}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <option value="">— none —</option>
          {props.rulesets.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="derived_params_json">Derived params (JSON → maps to bot config on promote)</Label>
        <Textarea
          id="derived_params_json"
          name="derived_params_json"
          defaultValue={props.initialDerivedParamsJson}
          rows={16}
          className="font-mono text-xs"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={props.initialNotes} rows={3} />
      </div>
      {message !== null ? <p className="text-destructive text-sm">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : props.mode === "create" ? "Create" : "Save"}
      </Button>
    </form>
  );
}
