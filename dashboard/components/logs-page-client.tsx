"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LogRowView } from "@/app/logs/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type BotOption = Readonly<{ id: string; label: string }>;

type Props = Readonly<{
  initialRows: readonly LogRowView[];
  botOptions: readonly BotOption[];
  initialBot: string;
  initialLevel: string;
  initialFrom: string;
  initialTo: string;
}>;

function levelColor(level: string): string {
  switch (level.toUpperCase()) {
    case "ERROR":
    case "CRITICAL":
      return "text-destructive";
    case "WARN":
    case "WARNING":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-foreground";
  }
}

/**
 * Log filters + table; subscribes to Realtime INSERT on `bot_logs` when available.
 */
export function LogsPageClient(props: Props): React.ReactElement {
  const router = useRouter();
  const [rows, setRows] = useState<LogRowView[]>(() => [...props.initialRows]);
  const [liveNote, setLiveNote] = useState<string>("");

  const labelByBot = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of props.botOptions) {
      m.set(b.id, b.label);
    }
    return m;
  }, [props.botOptions]);

  useEffect(() => {
    setRows([...props.initialRows]);
  }, [props.initialRows]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel("bot_logs_inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_logs" },
        (payload) => {
          if (cancelled) {
            return;
          }
          const rec = payload.new as Record<string, unknown>;
          const bid = typeof rec["bot_id"] === "string" ? rec["bot_id"] : null;
          const meta =
            typeof rec["metadata"] === "object" && rec["metadata"] !== null && !Array.isArray(rec["metadata"])
              ? (rec["metadata"] as Record<string, unknown>)
              : {};
          const row: LogRowView = {
            id: Number(rec["id"]),
            bot_id: bid,
            level: String(rec["level"] ?? ""),
            event: String(rec["event"] ?? ""),
            message: String(rec["message"] ?? ""),
            metadata: meta,
            created_at: String(rec["created_at"] ?? ""),
            bot_label: bid !== null ? (labelByBot.get(bid) ?? bid) : "—"
          };
          setRows((prev) => [row, ...prev].slice(0, 500));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLiveNote("Live updates on");
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLiveNote("Live updates unavailable (check Realtime publication for bot_logs)");
        }
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [labelByBot]);

  const onFilterSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const bot = String(fd.get("bot") ?? "").trim();
      const level = String(fd.get("level") ?? "").trim();
      const from = String(fd.get("from") ?? "").trim();
      const to = String(fd.get("to") ?? "").trim();
      const p = new URLSearchParams();
      if (bot.length > 0) {
        p.set("bot", bot);
      }
      if (level.length > 0) {
        p.set("level", level);
      }
      if (from.length > 0) {
        p.set("from", from);
      }
      if (to.length > 0) {
        p.set("to", to);
      }
      const qs = p.toString();
      router.push(qs.length > 0 ? `/logs?${qs}` : "/logs");
    },
    [router]
  );

  return (
    <div className="space-y-4">
      <form onSubmit={onFilterSubmit} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="f-bot">Bot</Label>
          <select
            id="f-bot"
            name="bot"
            defaultValue={props.initialBot}
            className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">All</option>
            {props.botOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-level">Level</Label>
          <select
            id="f-level"
            name="level"
            defaultValue={props.initialLevel}
            className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">All</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={props.initialFrom} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={props.initialTo} />
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Link href="/logs" className="text-muted-foreground text-sm underline">
            Clear
          </Link>
          {liveNote.length > 0 ? <span className="text-muted-foreground text-xs">{liveNote}</span> : null}
        </div>
      </form>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Time</TableHead>
              <TableHead>Bot</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center text-sm">
                  No rows.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{r.created_at}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs">{r.bot_label}</TableCell>
                  <TableCell className={`text-xs font-medium ${levelColor(r.level)}`}>{r.level}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs font-mono">{r.event}</TableCell>
                  <TableCell className="max-w-xl text-xs">
                    <div className="whitespace-pre-wrap break-words">{r.message}</div>
                    {Object.keys(r.metadata).length > 0 ? (
                      <pre className="bg-muted mt-1 max-h-24 overflow-auto rounded p-2 text-[10px]">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
