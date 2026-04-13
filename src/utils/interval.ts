/**
 * Supported bar intervals for Phase 1.
 *
 * Docs note:
 * - `dstb-docs/raw/docs/architecture.md` describes data flow; effective intervals are defined in this module and call sites.
 * - We keep this aligned with the shared/UI schemas for Phase 1.
 */
export type BarInterval =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "90m"
  | "1h"
  | "4h"
  | "1d";

/**
 * Parses an interval string into minutes.
 *
 * @throws If the interval is not supported.
 */
export function intervalToMinutes(interval: string): number {
  switch (interval) {
    case "1m":
      return 1;
    case "2m":
      return 2;
    case "5m":
      return 5;
    case "15m":
      return 15;
    case "30m":
      return 30;
    case "60m":
      return 60;
    case "90m":
      return 90;
    case "1h":
      return 60;
    case "4h":
      return 240;
    case "1d":
      return 1440;
    default:
      throw new Error(`Unsupported interval: ${interval}`);
  }
}

/**
 * Converts an interval string into milliseconds.
 */
export function intervalToMs(interval: string): number {
  return intervalToMinutes(interval) * 60_000;
}





