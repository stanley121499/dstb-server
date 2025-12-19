import { z } from "zod";

import type { SupabaseClient } from "./client.js";

export type RunEventLevel = "info" | "warn" | "error";

const runEventInsertSchema = z
  .object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    level: z.union([z.literal("info"), z.literal("warn"), z.literal("error")]),
    code: z.string().min(1),
    message: z.string().min(1),
    context: z.record(z.string(), z.unknown())
  })
  .strict();

export type RunEventInsert = z.infer<typeof runEventInsertSchema>;

/**
 * Writes a structured run event (per `docs/17-supabase-schema-and-migrations.md`).
 */
export async function insertRunEvent(args: Readonly<{ supabase: SupabaseClient; event: RunEventInsert }>): Promise<void> {
  const payload = runEventInsertSchema.parse(args.event);
  const result = await args.supabase.from("run_events").insert(payload);
  if (result.error !== null) {
    throw result.error;
  }
}

