"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { promoteEnvironmentAction, retireEnvironmentAction } from "@/app/behavior/environments/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = Readonly<{
  environmentId: string;
  status: string;
  configId: string | null;
}>;

/**
 * Promote / retire / run backtest for a behavior environment.
 */
export function EnvironmentActionsClient(props: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [backtestPending, setBacktestPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isRetired = props.status === "retired";
  const atLive = props.status === "live";

  function onPromote(): void {
    setMessage(null);
    startTransition(() => {
      void (async () => {
        const res = await promoteEnvironmentAction({ id: props.environmentId });
        if (!res.ok) {
          setMessage(res.message);
          return;
        }
        router.refresh();
      })();
    });
  }

  function onRetire(): void {
    setMessage(null);
    startTransition(() => {
      void (async () => {
        const res = await retireEnvironmentAction({ id: props.environmentId });
        if (!res.ok) {
          setMessage(res.message);
          return;
        }
        router.refresh();
      })();
    });
  }

  async function onRunBacktest(fd: FormData): Promise<void> {
    setMessage(null);
    const start = String(fd.get("bt_start") ?? "").trim();
    const end = String(fd.get("bt_end") ?? "").trim();
    if (start.length === 0 || end.length === 0) {
      setMessage("Start and end dates are required.");
      return;
    }
    setBacktestPending(true);
    try {
      const res = await fetch("/api/behavior/run-backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environment_id: props.environmentId,
          start,
          end
        })
      });
      const body = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setMessage(typeof body.error === "string" ? body.error : `HTTP ${String(res.status)}`);
        return;
      }
      router.refresh();
      setMessage("Backtest finished. Stats updated.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Backtest request failed.");
    } finally {
      setBacktestPending(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-medium">Pipeline</h2>
      <p className="text-muted-foreground text-sm">
        Status: <span className="text-foreground font-medium">{props.status}</span>
        {props.configId !== null ? (
          <>
            {" "}
            · Config:{" "}
            <a href={`/config/${props.configId}`} className="text-primary underline">
              open
            </a>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={pending || isRetired || atLive} onClick={onPromote}>
          Promote
        </Button>
        <Button type="button" variant="destructive" disabled={pending || isRetired} onClick={onRetire}>
          Retire
        </Button>
      </div>
      <form action={onRunBacktest} className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">Run backtest (Yahoo candles)</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="bt_start">Start (YYYY-MM-DD)</Label>
            <Input id="bt_start" name="bt_start" type="text" placeholder="2024-01-01" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bt_end">End (YYYY-MM-DD)</Label>
            <Input id="bt_end" name="bt_end" type="text" placeholder="2024-06-01" required />
          </div>
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={backtestPending || isRetired}>
          {backtestPending ? "Running…" : "Run backtest"}
        </Button>
      </form>
      {message !== null ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
