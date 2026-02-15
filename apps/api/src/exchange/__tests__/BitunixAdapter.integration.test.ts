import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { BitunixAdapter } from "../BitunixAdapter.js";
import type { ExchangeCandle } from "../types.js";

type TestConfig = Readonly<{
  apiKey: string;
  secretKey: string;
  symbol: string;
  interval: "1m";
  orderQty: number | null;
}>;

function buildTestConfig(): TestConfig | null {
  const apiKey = process.env.BITUNIX_TESTNET_API_KEY;
  const secretKey = process.env.BITUNIX_TESTNET_SECRET_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return null;
  }
  if (typeof secretKey !== "string" || secretKey.length === 0) {
    return null;
  }

  const symbol = typeof process.env.BITUNIX_TESTNET_SYMBOL === "string" && process.env.BITUNIX_TESTNET_SYMBOL.length > 0
    ? process.env.BITUNIX_TESTNET_SYMBOL
    : "BTC-USD";
  const interval = "1m";
  const qtyRaw = process.env.BITUNIX_TESTNET_ORDER_QTY;
  const qtyParsed = qtyRaw === undefined ? null : Number(qtyRaw);
  const orderQty = Number.isFinite(qtyParsed) && qtyParsed !== null && qtyParsed > 0 ? qtyParsed : null;

  return { apiKey, secretKey, symbol, interval, orderQty };
}

const config = buildTestConfig();
const describeIf = config === null ? describe.skip : describe;

describeIf("BitunixAdapter testnet integration", () => {
  let adapter: BitunixAdapter;

  beforeAll(async () => {
    if (config === null) {
      return;
    }
    adapter = new BitunixAdapter({
      symbol: config.symbol,
      interval: config.interval,
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      testMode: true,
      marketType: "futures"
    });
    await adapter.connect();
  });

  afterAll(async () => {
    if (config === null) {
      return;
    }
    await adapter.disconnect();
  });

  it("fetches latest candles via REST fallback", async () => {
    const candles = await adapter.getLatestCandles({ limit: 1 });
    expect(candles.length).toBeGreaterThan(0);
    const candle = candles[0] as ExchangeCandle | undefined;
    expect(candle?.close).toBeTypeOf("number");
  });

  it("streams candles over WebSocket", async () => {
    const received = await new Promise<ExchangeCandle>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;
      const timeout = setTimeout(() => {
        if (unsubscribe !== null) {
          unsubscribe();
        }
        reject(new Error("Timed out waiting for WebSocket candle"));
      }, 30_000);

      adapter.subscribeToCandles({
        onCandles: (candles) => {
          const candle = candles[0];
          if (candle !== undefined) {
            clearTimeout(timeout);
            if (unsubscribe !== null) {
              unsubscribe();
            }
            resolve(candle);
          }
        },
        onError: (error) => {
          clearTimeout(timeout);
          if (unsubscribe !== null) {
            unsubscribe();
          }
          reject(error);
        }
      }).then((handler) => {
        unsubscribe = handler;
      }).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    expect(received.close).toBeTypeOf("number");
  }, 40_000);

  const itIfOrderQty = config?.orderQty === null ? it.skip : it;

  itIfOrderQty("places a market order and polls for confirmation", async () => {
    if (config === null || config.orderQty === null) {
      return;
    }
    const order = await adapter.placeMarketOrder({
      side: "buy",
      quantity: config.orderQty
    });
    expect(order.id.length).toBeGreaterThan(0);
    expect(["pending", "open", "filled"].includes(order.status)).toBe(true);
    expect(order.quantity).toBeGreaterThan(0);
  }, 40_000);
});
