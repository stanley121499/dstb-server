import type { ChartCandle } from "@/lib/tradeChart";

function readNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parses behavior_raw_cycles.candles["15m"] format: `{ t, o, h, l, c, v }[]` into chart candles.
 */
export function parseBehaviorCandlesJson(payload: unknown): ChartCandle[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const out: ChartCandle[] = [];
  for (const item of payload) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const o = item as Record<string, unknown>;
    const t = readNum(o["t"]);
    const open = readNum(o["o"]);
    const high = readNum(o["h"]);
    const low = readNum(o["l"]);
    const close = readNum(o["c"]);
    if (t === null || open === null || high === null || low === null || close === null) {
      continue;
    }
    out.push({ timeUtcMs: t, open, high, low, close });
  }
  return out.sort((a, b) => a.timeUtcMs - b.timeUtcMs);
}
