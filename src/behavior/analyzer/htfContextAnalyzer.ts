import { Candle, HtfEdge, HtfLocation, HtfBias } from "../types";
import { computeEma } from "../utils";

export type HtfContextInput = Readonly<{
  candles4h: readonly Candle[];
  decisionConfirmTimeUtcMs: number;
  decisionLevelPrice: number;
  expectedDirection: "UP" | "DOWN" | "N/A";
}>;

export type HtfContextResult = Readonly<{
  htfEdge: HtfEdge;
  location: HtfLocation;
  bias: HtfBias;
  rangeHigh: number;
  rangeLow: number;
  ema55: number | null;
  ema200: number | null;
}>;

export function analyzeHtfContext(input: HtfContextInput): HtfContextResult {
  const { candles4h, decisionConfirmTimeUtcMs, decisionLevelPrice, expectedDirection } = input;

  let refIndex = -1;
  const HTF_DURATION_MS = 4 * 60 * 60 * 1000;

  for (let i = candles4h.length - 1; i >= 0; i--) {
    const c = candles4h[i];
    if (c && c.timeUtcMs + HTF_DURATION_MS <= decisionConfirmTimeUtcMs) {
      refIndex = i;
      break;
    }
  }

  if (refIndex < 11) {
    console.warn("[htfContextAnalyzer] Fewer than 12 4H candles available. Defaulting to MID_NEUTRAL.");
    return {
      htfEdge: "MID_NEUTRAL",
      location: "MID",
      bias: "NEUTRAL",
      rangeHigh: 0,
      rangeLow: 0,
      ema55: null,
      ema200: null
    };
  }

  if (expectedDirection === "N/A") {
    return {
      htfEdge: "MID_NEUTRAL",
      location: "MID",
      bias: "NEUTRAL",
      rangeHigh: 0,
      rangeLow: 0,
      ema55: null,
      ema200: null
    };
  }

  let rh = -Infinity;
  let rl = Infinity;
  for (let i = refIndex - 11; i <= refIndex; i++) {
    const c = candles4h[i];
    if (c) {
      if (c.high > rh) rh = c.high;
      if (c.low < rl) rl = c.low;
    }
  }

  const rangeWidth = rh - rl;
  const edgeBand = rangeWidth * 0.20;

  let location: HtfLocation = "MID";
  if (decisionLevelPrice >= (rh - edgeBand) || decisionLevelPrice <= (rl + edgeBand)) {
    location = "EDGE";
  }

  const ema55 = computeEma(candles4h, refIndex, 55);
  const ema200 = computeEma(candles4h, refIndex, 200);

  let bias: HtfBias = "NEUTRAL";
  if (ema55 !== null && ema200 !== null) {
    if (ema55 > ema200) bias = "BULL";
    else if (ema55 < ema200) bias = "BEAR";
  }

  let isSupport = false;
  if (expectedDirection === "UP" && bias === "BULL") isSupport = true;
  if (expectedDirection === "DOWN" && bias === "BEAR") isSupport = true;

  let htfEdge: HtfEdge = "MID_NEUTRAL";
  if (location === "EDGE" && isSupport) htfEdge = "EDGE_ALIGN";
  else if (location === "EDGE" && !isSupport) htfEdge = "EDGE_CONFLICT";
  else if (location === "MID" && isSupport) htfEdge = "MID_ALIGN";
  else if (location === "MID" && !isSupport) htfEdge = "MID_NEUTRAL";

  return {
    htfEdge,
    location,
    bias,
    rangeHigh: rh,
    rangeLow: rl,
    ema55,
    ema200
  };
}
