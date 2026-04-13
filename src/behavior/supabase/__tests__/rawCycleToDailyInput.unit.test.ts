import { describe, expect, it } from "vitest";

import { cycleStartUtcMsFromCycleDate, dailyCycleInputFromRawCycleRow } from "../rawCycleToDailyInput.js";

describe("rawCycleToDailyInput", () => {
  it("cycleStartUtcMsFromCycleDate matches UTC midnight", () => {
    expect(cycleStartUtcMsFromCycleDate("2024-06-15")).toBe(Date.UTC(2024, 5, 15));
  });

  it("dailyCycleInputFromRawCycleRow maps sandbox candles", () => {
    const input = dailyCycleInputFromRawCycleRow({
      cycle_date: "2024-01-10",
      candles: {
        "15m": [{ t: 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }],
        "4h": [{ t: 2000, o: 1, h: 2, l: 0.5, c: 1.5, v: 20 }],
      },
      reference_levels: { pdh: 100, pdl: 90, sessionOpen: 95 },
      metadata: { uid: 7, writeDate: "10/01/2024" },
    });
    expect(input.cycleStartUtcMs).toBe(Date.UTC(2024, 0, 10));
    expect(input.allCandles15m).toHaveLength(1);
    expect(input.allCandles15m[0]?.timeUtcMs).toBe(1000);
    expect(input.pdh).toBe(100);
    expect(input.pdl).toBe(90);
    expect(input.uid).toBe(7);
    expect(input.writeDate).toBe("10/01/2024");
  });
});
