import { DateTime } from "luxon";
import { Candle, MarketSession, SessionTimeMode } from "./types";

/**
 * Converts a UTC timestamp (ms) to a DateTime in UTC+8.
 */
export function toUtc8(timestampMs: number): DateTime {
  return DateTime.fromMillis(timestampMs).setZone("Asia/Singapore");
}

/**
 * Returns "H:mm:ss" string from a UTC timestamp (ms), in UTC+8.
 * Uses single-digit hours (e.g. "8:00:00" not "08:00:00") to match Darren's format.
 */
export function toTimeString(timestampMs: number): string {
  return toUtc8(timestampMs).toFormat("H:mm:ss");
}

/**
 * Returns "dd/mm/yyyy" date string from a UTC timestamp (ms), in UTC+8.
 */
export function toDateString(timestampMs: number): string {
  return toUtc8(timestampMs).toFormat("dd/MM/yyyy");
}

/**
 * Returns the day-of-week abbreviation ("Mon", "Tue", ...) from a UTC timestamp (ms), in UTC+8.
 */
export function toDayString(timestampMs: number): string {
  return toUtc8(timestampMs).toFormat("ccc");
}

/**
 * Returns the month string ("January", "February", ...) from a UTC timestamp (ms), in UTC+8.
 */
export function toMonthString(timestampMs: number): string {
  return toUtc8(timestampMs).toFormat("MMMM");
}

/**
 * Returns the UTC+8 daily cycle start (08:00:00 UTC+8 = 00:00:00 UTC) for a given date.
 * Input: any UTC ms within the cycle.
 * Output: UTC ms of 00:00:00 UTC on that same UTC calendar day.
 */
export function getCycleStartUtcMs(timestampMs: number): number {
  return DateTime.fromMillis(timestampMs).setZone("UTC").startOf("day").toMillis();
}

// ============================================================================
// DST Calendar Helpers
// ============================================================================

/**
 * Returns the UTC ms of the Nth occurrence of a given weekday in a month.
 * weekday: 0=Sun, 1=Mon … 6=Sat (JS getDay convention).
 * occurrence: 1 = first, 2 = second, -1 = last.
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): number {
  if (occurrence >= 1) {
    // Nth from start of month (1-based)
    const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1));
    let day = firstDayOfMonth.getUTCDay();
    // Distance to target weekday
    let offset = (weekday - day + 7) % 7;
    offset += (occurrence - 1) * 7;
    return Date.UTC(year, month - 1, 1 + offset);
  } else {
    // Last occurrence: start from end of month, walk backwards
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)); // Day 0 of next month = last day
    const day = lastDayOfMonth.getUTCDay();
    const offset = (day - weekday + 7) % 7;
    return Date.UTC(year, month - 1, lastDayOfMonth.getUTCDate() - offset);
  }
}

/**
 * Returns true if the given UTC timestamp falls within the US DST period.
 * US DST: 2nd Sunday of March 02:00 local → 1st Sunday of November 02:00 local.
 * For UTC+8 date comparison purposes we use UTC midnight boundaries.
 *
 * Supported years: 2024–2030.
 */
export function isUsDst(timestampMs: number): boolean {
  const dt = toUtc8(timestampMs);
  const year = dt.year;
  // 2nd Sunday of March (UTC midnight)
  const start = nthWeekdayOfMonth(year, 3, 0, 2);
  // 1st Sunday of November (UTC midnight)
  const end   = nthWeekdayOfMonth(year, 11, 0, 1);
  return timestampMs >= start && timestampMs < end;
}

/**
 * Returns true if the given UTC timestamp falls within the UK DST / BST period.
 * UK DST: Last Sunday of March 01:00 UTC → Last Sunday of October 01:00 UTC.
 * For UTC+8 date comparison purposes we use UTC midnight boundaries.
 *
 * Supported years: 2024–2030.
 */
export function isUkDst(timestampMs: number): boolean {
  const dt = toUtc8(timestampMs);
  const year = dt.year;
  // Last Sunday of March (UTC midnight)
  const start = nthWeekdayOfMonth(year, 3, 0, -1);
  // Last Sunday of October (UTC midnight)
  const end   = nthWeekdayOfMonth(year, 10, 0, -1);
  return timestampMs >= start && timestampMs < end;
}

// ============================================================================
// Session Classification
// ============================================================================

/**
 * Classifies a UTC ms timestamp into a MarketSession label using UTC+8 time.
 *
 * OVERLAP RULE — "Incoming session takes dominance" (Darren's rule):
 *   When two sessions are concurrently active, whichever STARTED MOST RECENTLY
 *   is the "incoming" fresh-liquidity session and takes the assigned label.
 *   Example: UK_H2 opens 21:00, US_PRE opens 21:30 → at 21:30 US_PRE is incoming → US_PRE wins.
 *
 * DST AWARENESS:
 *   Asia sessions (08:00–15:59 UTC+8) and MKT_CLOSED/MKT_RESET are invariant.
 *   UK sessions shift 1h earlier during UK BST (last Sun Mar → last Sun Oct).
 *   US sessions shift 1h earlier during US DST (2nd Sun Mar → 1st Sun Nov).
 *   Four schedule variants: STD | US_DST | UK_DST | BOTH_DST.
 *
 * --- FINAL UTC+8 windows per variant (non-overlapping, sequential) ---
 *
 * STD          US_DST_ONLY      UK_DST_ONLY      BOTH_DST
 * 16:00 UK_PRE  16:00 UK_PRE    15:00 UK_PRE     15:00 UK_PRE
 * 17:00 UK_H1   17:00 UK_H1     16:00 UK_H1      16:00 UK_H1
 * 19:00 UK_TP_H1 19:00 UK_TP_H1 18:00 UK_TP_H1   18:00 UK_TP_H1
 * 21:00 UK_H2   20:30 US_PRE*   20:00 UK_H2      20:00 UK_H2
 * 21:30 US_PRE  21:00 UK_H2*    21:30 US_PRE      20:30 US_PRE
 * 22:30 US_H1   21:30 US_H1     22:00 UK_TP_H2*  21:30 US_H1
 * 23:00 UK_TP_H2 22:30 UK_H2?  22:30 US_H1      22:00 UK_TP_H2
 *  → US_H1 wins 21:30+ not UK_H2
 * 23:00 UK_TP_H2                23:00 US_H1 cont  23:00 US_TP_H1
 * 00:00 US_H1   00:00 US_TP_H1  00:00 US_H1 cont  00:00 US_TP_H1 cont
 * 01:00 US_TP_H1 01:30 US_H2    01:00 US_TP_H1   01:30 US_H2
 * 02:30 US_H2   03:00 US_TP_H2  02:30 US_H2      03:00 US_TP_H2
 * 04:00 US_TP_H2                04:00 US_TP_H2
 *
 * (*) See inline comments for overlap resolution.
 */
export function classifySession(timestampMs: number): MarketSession {
  const dt = toUtc8(timestampMs);
  const t = dt.hour * 100 + dt.minute; // HHMM integer for range comparison

  // ---- Asia + Market Closed/Reset — invariant regardless of DST ----
  if (t >= 800  && t <= 859)  return "ASIA_PRE";
  if (t >= 900  && t <= 1059) return "ASIA_H1";
  if (t >= 1100 && t <= 1229) return "ASIA_TP_H1";
  if (t >= 1230 && t <= 1459) return "ASIA_H2";
  if (t >= 1500 && t <= 1559) return "ASIA_TP_H2";
  if (t >= 500  && t <= 629)  return "MKT_CLOSED";
  if (t >= 630  && t <= 759)  return "MKT_RESET";

  // ---- Route to the correct session table ----
  const usDst = isUsDst(timestampMs);
  const ukDst = isUkDst(timestampMs);

  if (usDst && ukDst) return classifySessionBothDst(t);
  if (usDst)          return classifySessionUsDst(t);
  if (ukDst)          return classifySessionUkDst(t);
  return classifySessionStd(t);
}

/**
 * STD — both UK and US on winter schedule (UTC+8 windows).
 * Overlap resolution (most-recently-started wins):
 *   21:00–21:29 → UK_H2  (UK alone; US_PRE arrives 21:30)
 *   21:30–22:29 → US_PRE (incoming over UK_H2)
 *   22:30–22:59 → US_H1  (incoming; US_H1 starts 22:30, newer than US_PRE 21:30)
 *   23:00–23:59 → UK_TP_H2 (incoming; UK_TP_H2 starts 23:00, newer than US_H1 22:30)
 *   00:00–00:59 → US_H1  (US_H1 continues; UK_TP_H2 ended at 23:59)
 */
function classifySessionStd(t: number): MarketSession {
  if (t >= 1600 && t <= 1659) return "UK_PRE";
  if (t >= 1700 && t <= 1859) return "UK_H1";
  if (t >= 1900 && t <= 2059) return "UK_TP_H1";
  if (t >= 2100 && t <= 2129) return "UK_H2";
  if (t >= 2130 && t <= 2229) return "US_PRE";
  if (t >= 2230 && t <= 2259) return "US_H1";
  if (t >= 2300 && t <= 2359) return "UK_TP_H2";
  if (t >= 0    && t <= 59)   return "US_H1";
  if (t >= 100  && t <= 229)  return "US_TP_H1";
  if (t >= 230  && t <= 359)  return "US_H2";
  if (t >= 400  && t <= 459)  return "US_TP_H2";
  return "N/A";
}

/**
 * US DST only — US sessions shift 1h earlier; UK stays at STD times (UTC+8).
 *   US_PRE  → 20:30  US_H1  → 21:30  US_TP_H1 → 00:00
 *   US_H2   → 01:30  US_TP_H2 → 03:00
 * Overlap resolution:
 *   19:00–20:29 → UK_TP_H1   (UK alone until US_PRE arrives 20:30)
 *   20:30–20:59 → US_PRE     (incoming over UK_TP_H1)
 *   21:00–21:29 → UK_H2      (UK_H2 starts 21:00; US_PRE started 20:30 → UK_H2 is MORE recent → UK_H2 wins)
 *   21:30–22:59 → US_H1      (incoming; US_H1 starts 21:30, newer than UK_H2 21:00)
 *   23:00–23:59 → UK_TP_H2   (incoming; UK_TP_H2 starts 23:00, newer than US_H1 21:30)
 *   00:00–01:29 → US_TP_H1   (incoming; US_TP_H1 DST starts 00:00, newer than UK_TP_H2 23:00)
 *   01:30–02:59 → US_H2      (DST: 02:30 STD → 01:30 DST)
 *   03:00–03:59 → US_TP_H2   (DST: 04:00 STD → 03:00 DST)
 */
function classifySessionUsDst(t: number): MarketSession {
  if (t >= 1600 && t <= 1659) return "UK_PRE";
  if (t >= 1700 && t <= 1859) return "UK_H1";
  if (t >= 1900 && t <= 2029) return "UK_TP_H1";  // ends when US_PRE arrives at 20:30
  if (t >= 2030 && t <= 2059) return "US_PRE";    // incoming over UK_TP_H1
  if (t >= 2100 && t <= 2129) return "UK_H2";     // UK_H2 starts 21:00 — newer than US_PRE (20:30) → wins
  if (t >= 2130 && t <= 2259) return "US_H1";     // US_H1 starts 21:30 — newer than UK_H2 (21:00) → wins
  if (t >= 2300 && t <= 2359) return "UK_TP_H2";  // UK_TP_H2 starts 23:00 — newer than US_H1 (21:30) → wins
  if (t >= 0    && t <= 129)  return "US_TP_H1";  // US_TP_H1 DST starts 00:00 — newer than UK_TP_H2 (23:00) → wins
  if (t >= 130  && t <= 259)  return "US_H2";     // 01:30–02:59
  if (t >= 300  && t <= 359)  return "US_TP_H2";  // 03:00–03:59
  return "N/A";
}

/**
 * UK DST only — UK sessions shift 1h earlier; US stays at STD times (UTC+8).
 *   UK_PRE → 15:00  UK_H1 → 16:00  UK_TP_H1 → 18:00
 *   UK_H2  → 20:00  UK_TP_H2 → 22:00
 * Overlap resolution:
 *   20:00–21:29 → UK_H2      (UK alone until US_PRE arrives 21:30 STD)
 *   21:30–21:59 → US_PRE     (incoming over UK_H2)
 *   22:00–22:29 → UK_TP_H2   (UK_TP_H2 starts 22:00 — newer than US_PRE 21:30 → wins)
 *   22:30–23:59 → US_H1      (US_H1 starts 22:30 — newer than UK_TP_H2 22:00 → wins; runs into 00:xx)
 *   00:00–00:59 → US_H1      (continues alone after UK_TP_H2 ended at 22:59)
 */
function classifySessionUkDst(t: number): MarketSession {
  if (t >= 1500 && t <= 1559) return "UK_PRE";
  if (t >= 1600 && t <= 1759) return "UK_H1";
  if (t >= 1800 && t <= 1959) return "UK_TP_H1";
  if (t >= 2000 && t <= 2129) return "UK_H2";     // UK alone; US_PRE not until 21:30
  if (t >= 2130 && t <= 2159) return "US_PRE";    // incoming at 21:30
  if (t >= 2200 && t <= 2229) return "UK_TP_H2";  // UK_TP_H2 starts 22:00 — newer → wins
  if (t >= 2230 && t <= 2359) return "US_H1";     // US_H1 starts 22:30 — newer → wins
  if (t >= 0    && t <= 59)   return "US_H1";     // continues alone
  if (t >= 100  && t <= 229)  return "US_TP_H1";
  if (t >= 230  && t <= 359)  return "US_H2";
  if (t >= 400  && t <= 459)  return "US_TP_H2";
  return "N/A";
}

/**
 * BOTH DST — UK and US both shift 1h earlier (UTC+8).
 *   UK: UK_PRE→15:00  UK_H1→16:00  UK_TP_H1→18:00  UK_H2→20:00  UK_TP_H2→22:00
 *   US: US_PRE→20:30  US_H1→21:30  US_TP_H1→23:00  US_H2→01:30  US_TP_H2→03:00
 * Overlap resolution (same rule — most recently started wins):
 *   20:00–20:29 → UK_H2      (UK_H2 starts 20:00; US_PRE not until 20:30)
 *   20:30–21:29 → US_PRE     (US_PRE starts 20:30 — newer than UK_H2 20:00 → wins)
 *   21:30–21:59 → US_H1      (US_H1 starts 21:30 — newer than US_PRE 20:30 → wins)
 *   22:00–22:59 → UK_TP_H2   (UK_TP_H2 starts 22:00 — newer than US_H1 21:30 → wins)
 *   23:00–01:29 → US_TP_H1   (US_TP_H1 DST starts 23:00 — newer than UK_TP_H2 22:00 → wins)
 *   01:30–02:59 → US_H2
 *   03:00–03:59 → US_TP_H2
 */
function classifySessionBothDst(t: number): MarketSession {
  if (t >= 1500 && t <= 1559) return "UK_PRE";
  if (t >= 1600 && t <= 1759) return "UK_H1";
  if (t >= 1800 && t <= 1959) return "UK_TP_H1";
  if (t >= 2000 && t <= 2029) return "UK_H2";     // UK alone before US_PRE at 20:30
  if (t >= 2030 && t <= 2129) return "US_PRE";    // incoming at 20:30
  if (t >= 2130 && t <= 2159) return "US_H1";     // incoming at 21:30
  if (t >= 2200 && t <= 2259) return "UK_TP_H2";  // incoming at 22:00
  if (t >= 2300 && t <= 2359) return "US_TP_H1";  // incoming at 23:00 (DST)
  if (t >= 0    && t <= 129)  return "US_TP_H1";  // continues 00:00–01:29
  if (t >= 130  && t <= 259)  return "US_H2";
  if (t >= 300  && t <= 359)  return "US_TP_H2";
  return "N/A";
}

// ============================================================================
// Session Time Mode Classification
// ============================================================================

/**
 * Determines the Session Time Mode (STD / DST / C/R / N/A) for a first interaction event.
 *
 * Rules (from Darren's data sheet):
 *   - No interaction (session = "N/A")               → "N/A"
 *   - MKT_CLOSED or MKT_RESET                        → "C/R"
 *   - ASIA_* sessions                                → always "STD"
 *   - UK_* sessions  → check UK DST calendar         → "DST" or "STD"
 *   - US_* sessions  → check US DST calendar         → "DST" or "STD"
 *
 * @param timestampMs - The UTC ms of the first interaction candle open time.
 * @param session     - The already-classified MarketSession for that candle.
 */
export function classifySessionTimeMode(timestampMs: number, session: MarketSession): SessionTimeMode {
  if (session === "N/A") return "N/A";
  if (session === "MKT_CLOSED" || session === "MKT_RESET") return "C/R";

  if (session.startsWith("ASIA_")) return "STD";

  if (session.startsWith("UK_")) {
    return isUkDst(timestampMs) ? "DST" : "STD";
  }

  if (session.startsWith("US_")) {
    return isUsDst(timestampMs) ? "DST" : "STD";
  }

  return "N/A";
}

/**
 * Computes the ATR(14) using Wilder's smoothing method on an array of candles.
 * Returns null if fewer than 15 candles are provided.
 * The ATR is calculated at the candle at the given index (inclusive).
 */
export function computeAtr(candles: readonly Candle[], atIndex: number, period: number): number | null {
  if (atIndex < period) return null;

  let sumTr = 0;
  for (let i = 1; i <= period; i++) {
    const high = candles[i]?.high ?? 0;
    const low = candles[i]?.low ?? 0;
    const prevClose = candles[i - 1]?.close ?? low;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    sumTr += Math.max(tr1, tr2, tr3);
  }

  let prevAtr = sumTr / period;

  for (let i = period + 1; i <= atIndex; i++) {
    const high = candles[i]?.high ?? 0;
    const low = candles[i]?.low ?? 0;
    const prevClose = candles[i - 1]?.close ?? low;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    const tr = Math.max(tr1, tr2, tr3);

    // Wilder's Smoothing
    prevAtr = (prevAtr * (period - 1) + tr) / period;
  }

  return prevAtr;
}

/**
 * Computes EMA for a given period over the close prices of candles.
 * Uses standard EMA formula: multiplier = 2 / (period + 1).
 * Returns null if fewer candles than period are provided.
 * The EMA is computed at the candle at the given index (inclusive).
 */
export function computeEma(candles: readonly Candle[], atIndex: number, period: number): number | null {
  if (atIndex < period - 1) return null;

  const multiplier = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i]?.close ?? 0;
  }
  let prevEma = sum / period;

  for (let i = period; i <= atIndex; i++) {
    const close = candles[i]?.close ?? 0;
    prevEma = (close - prevEma) * multiplier + prevEma;
  }

  return prevEma;
}

/**
 * Given an array of 15M candles and a UTC+8 cycle start (00:00:00 UTC),
 * returns only the candles that fall within [cycleStartUtcMs, cycleStartUtcMs + 24h).
 */
export function filterCycleCandles(candles: readonly Candle[], cycleStartUtcMs: number): readonly Candle[] {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return candles.filter((c) => c.timeUtcMs >= cycleStartUtcMs && c.timeUtcMs < cycleStartUtcMs + ONE_DAY_MS);
}

/**
 * Returns candles that fall within the Asia Range window:
 * 16:00:00 UTC (previous calendar day) to 23:59:59 UTC (= 00:00–07:59 UTC+8).
 */
export function filterAsiaCandles(candles: readonly Candle[], cycleStartUtcMs: number): readonly Candle[] {
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
  return candles.filter((c) => c.timeUtcMs >= cycleStartUtcMs - EIGHT_HOURS_MS && c.timeUtcMs < cycleStartUtcMs);
}

/**
 * Finds the index of a candle whose open time matches the given UTC timestamp (ms).
 * Returns -1 if not found.
 */
export function findCandleIndex(candles: readonly Candle[], openTimeUtcMs: number): number {
  return candles.findIndex((c) => c.timeUtcMs === openTimeUtcMs);
}
