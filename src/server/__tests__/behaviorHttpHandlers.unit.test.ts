import { describe, expect, it } from "vitest";

import { behaviorApiAuthorized, parseDerivedParamsForBacktest } from "../behaviorHttpHandlers.js";

describe("behaviorApiAuthorized", () => {
  it("accepts matching Bearer token", () => {
    const req = {
      headers: {
        authorization: "Bearer secret-one",
      },
    } as import("node:http").IncomingMessage;
    expect(behaviorApiAuthorized(req, "secret-one")).toBe(true);
  });

  it("rejects wrong Bearer token", () => {
    const req = {
      headers: {
        authorization: "Bearer other",
      },
    } as import("node:http").IncomingMessage;
    expect(behaviorApiAuthorized(req, "secret-one")).toBe(false);
  });

  it("accepts X-Behavior-Api-Key header", () => {
    const req = {
      headers: {
        "x-behavior-api-key": "k",
      },
    } as import("node:http").IncomingMessage;
    expect(behaviorApiAuthorized(req, "k")).toBe(true);
  });

  it("rejects empty secret", () => {
    const req = {
      headers: {
        authorization: "Bearer ",
      },
    } as import("node:http").IncomingMessage;
    expect(behaviorApiAuthorized(req, "")).toBe(false);
  });
});

describe("parseDerivedParamsForBacktest", () => {
  it("accepts valid derived_params", () => {
    const r = parseDerivedParamsForBacktest({
      strategy: "orb-atr",
      symbol: "BTC-USD",
      interval: "15m",
      initial_balance: 10000,
      params: { version: "1.0" }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strategy).toBe("orb-atr");
      expect(r.initialBalance).toBe(10000);
    }
  });

  it("rejects non-object", () => {
    const r = parseDerivedParamsForBacktest(null);
    expect(r.ok).toBe(false);
  });
});
