import { describe, expect, it } from "vitest";

import { SandboxedAnalyzerRunner } from "../SandboxedAnalyzerRunner.js";

describe("SandboxedAnalyzerRunner", () => {
  it("runs a minimal analyzer and returns label + details", async () => {
    const runner = new SandboxedAnalyzerRunner({ timeoutMs: 3000, memoryMb: 32 });
    const code = `
      function analyze(input) {
        var c15 = input.candles["15m"];
        return {
          label: c15 && c15.length > 0 ? "HAS_DATA" : "EMPTY",
          details: { count: c15 ? c15.length : 0 }
        };
      }
    `;
    const out = await runner.runAnalyzerCode(code, {
      candles: {
        "15m": [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }],
        "4h": [],
      },
      referenceLevels: { pdh: 2, pdl: 0.5, sessionOpen: 1 },
      params: {},
    });
    expect(out.label).toBe("HAS_DATA");
    expect(out.details["count"]).toBe(1);
  });

  it("returns ERROR for invalid output", async () => {
    const runner = new SandboxedAnalyzerRunner({ timeoutMs: 3000, memoryMb: 32 });
    const code = `
      function analyze(input) {
        return "not-an-object";
      }
    `;
    const out = await runner.runAnalyzerCode(code, {
      candles: { "15m": [], "4h": [] },
      referenceLevels: { pdh: 0, pdl: 0, sessionOpen: 0 },
      params: {},
    });
    expect(out.label).toBe("ERROR");
  });
});
