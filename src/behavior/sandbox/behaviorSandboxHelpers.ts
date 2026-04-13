/**
 * Host-side implementations for analyzer `input.helpers.*` (sync; copied across isolate boundary).
 */

export type SandboxCandle = Readonly<{
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}>;

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

function asCandle(raw: unknown): SandboxCandle | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const t = readNum(o["t"]);
  const open = readNum(o["o"]);
  const high = readNum(o["h"]);
  const low = readNum(o["l"]);
  const close = readNum(o["c"]);
  const vol = readNum(o["v"]);
  if (t === null || open === null || high === null || low === null || close === null || vol === null) {
    return null;
  }
  return { t, o: open, h: high, l: low, c: close, v: vol };
}

/**
 * Compares candle close to a price level with a tiny relative tolerance (inside = near touch).
 */
export function getCandlePosition(candle: unknown, level: unknown): "ABOVE" | "BELOW" | "INSIDE" {
  const c = asCandle(candle);
  const lv = readNum(level);
  if (c === null || lv === null) {
    return "INSIDE";
  }
  const tol = Math.max(Math.abs(lv) * 1e-6, 1e-12);
  const close = c.c;
  if (Math.abs(close - lv) <= tol) {
    return "INSIDE";
  }
  return close > lv ? "ABOVE" : "BELOW";
}

/**
 * First candle whose range includes the level (wick or body through level).
 */
export function findFirstInteraction(candles: unknown, level: unknown): { index: number; candle: SandboxCandle } | null {
  const lv = readNum(level);
  if (lv === null || !Array.isArray(candles)) {
    return null;
  }
  for (let i = 0; i < candles.length; i++) {
    const c = asCandle(candles[i]);
    if (c === null) {
      continue;
    }
    if (c.h >= lv && c.l <= lv) {
      return { index: i, candle: c };
    }
  }
  return null;
}

export function getCandlesInWindow(candles: unknown, startMs: unknown, endMs: unknown): SandboxCandle[] {
  if (!Array.isArray(candles)) {
    return [];
  }
  const s = readNum(startMs);
  const e = readNum(endMs);
  if (s === null || e === null) {
    return [];
  }
  const out: SandboxCandle[] = [];
  for (const item of candles) {
    const c = asCandle(item);
    if (c === null) {
      continue;
    }
    if (c.t >= s && c.t <= e) {
      out.push(c);
    }
  }
  return out;
}

/**
 * True if wick (high or low) touched level within thresholdBps of range (basis points of range).
 */
export function hasWickTouch(candle: unknown, level: unknown, thresholdBps: unknown): boolean {
  const c = asCandle(candle);
  const lv = readNum(level);
  const bps = readNum(thresholdBps);
  if (c === null || lv === null || bps === null) {
    return false;
  }
  const range = c.h - c.l;
  if (!Number.isFinite(range) || range <= 0) {
    return c.h >= lv && c.l <= lv;
  }
  const tol = (range * bps) / 10000;
  const bodyHigh = Math.max(c.o, c.c);
  const bodyLow = Math.min(c.o, c.c);
  const upperWick = c.h > bodyHigh && c.h - Math.max(bodyHigh, lv) <= tol && c.h >= lv;
  const lowerWick = c.l < bodyLow && Math.min(bodyLow, lv) - c.l <= tol && c.l <= lv;
  const through = c.h >= lv && c.l <= lv;
  return through || upperWick || lowerWick;
}
