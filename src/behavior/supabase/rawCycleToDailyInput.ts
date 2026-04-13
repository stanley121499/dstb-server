import { DateTime } from "luxon";
import { z } from "zod";

import type { Candle, DailyCycleInput } from "../types.js";
import { toDateString } from "../utils.js";

const SandboxCandleSchema = z.object({
  t: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

const CandlesPayloadSchema = z.object({
  "15m": z.array(SandboxCandleSchema),
  "4h": z.array(SandboxCandleSchema),
});

const ReferenceLevelsSchema = z.object({
  pdh: z.number(),
  pdl: z.number(),
  sessionOpen: z.number().optional(),
});

const MetadataSchema = z
  .object({
    uid: z.union([z.number(), z.string()]).optional(),
    writeDate: z.string().optional(),
  })
  .passthrough();

/**
 * UTC midnight ms for a `YYYY-MM-DD` cycle_date (matches BehaviorBot / Supabase sync).
 */
export function cycleStartUtcMsFromCycleDate(cycleDate: string): number {
  const dt = DateTime.fromISO(`${cycleDate}T00:00:00.000Z`, { zone: "utc" });
  if (!dt.isValid) {
    throw new Error(`Invalid cycle_date: ${cycleDate}`);
  }
  return dt.toMillis();
}

function candleFromSandbox(row: z.infer<typeof SandboxCandleSchema>): Candle {
  return {
    timeUtcMs: row.t,
    open: row.o,
    high: row.h,
    low: row.l,
    close: row.c,
    volume: row.v,
  };
}

export type RawCycleRowForInput = Readonly<{
  cycle_date: string;
  candles: unknown;
  reference_levels: unknown;
  metadata: unknown;
}>;

/**
 * Rebuilds `DailyCycleInput` from a `behavior_raw_cycles` row for native S2 and sandbox runners.
 */
export function dailyCycleInputFromRawCycleRow(row: RawCycleRowForInput): DailyCycleInput {
  const candlesParsed = CandlesPayloadSchema.safeParse(row.candles);
  if (!candlesParsed.success) {
    throw new Error(`Invalid raw cycle candles JSON: ${candlesParsed.error.message}`);
  }
  const refParsed = ReferenceLevelsSchema.safeParse(row.reference_levels);
  if (!refParsed.success) {
    throw new Error(`Invalid raw cycle reference_levels JSON: ${refParsed.error.message}`);
  }
  const metaParsed = MetadataSchema.safeParse(row.metadata ?? {});
  const meta = metaParsed.success ? metaParsed.data : {};

  const cycleStartUtcMs = cycleStartUtcMsFromCycleDate(row.cycle_date);
  const uidRaw = meta.uid;
  const uid =
    typeof uidRaw === "number"
      ? uidRaw
      : typeof uidRaw === "string"
        ? Number.parseInt(uidRaw, 10) || 0
        : 0;
  const writeDate = typeof meta.writeDate === "string" ? meta.writeDate : toDateString(cycleStartUtcMs);

  return {
    cycleStartUtcMs,
    allCandles15m: candlesParsed.data["15m"].map(candleFromSandbox),
    candles4h: candlesParsed.data["4h"].map(candleFromSandbox),
    pdh: refParsed.data.pdh,
    pdl: refParsed.data.pdl,
    uid,
    writeDate,
  };
}
