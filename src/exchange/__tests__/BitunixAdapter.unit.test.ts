/**
 * Bitunix Adapter — Unit Tests
 *
 * Strategy: every test mocks `httpClient.request` (the single shared transport)
 * so no real network calls are made. Each test then:
 *   1. Sets up a realistic fixture payload (matching real Bitunix response shapes)
 *   2. Calls the method under test
 *   3. Asserts the outgoing request params (path, method, query, body)
 *   4. Asserts the parsed output has the correct domain types and values
 *
 * This catches:
 *   - Wrong HTTP method or path
 *   - Missing / misspelled query / body params
 *   - Parser regressions (mis-mapped field names)
 *   - Input validation (INVALID_PARAMETER throws)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BitunixAdapter, type BatchOrderParams } from "../BitunixAdapter.js";
import { ExchangeError } from "../ExchangeError.js";

// ---------------------------------------------------------------------------
// Test harness — replaces httpClient.request with a spy
// ---------------------------------------------------------------------------

class TestableBitunixAdapter extends BitunixAdapter {
  public readonly mockRequest = vi.fn();

  public constructor(args: ConstructorParameters<typeof BitunixAdapter>[0]) {
    super(args);
    this.httpClient.request = this.mockRequest;
  }

  public setConnected(connected: boolean): void {
    // @ts-ignore
    this.isConnectedFlag = connected;
  }
}

const makeAdapter = () => {
  const adapter = new TestableBitunixAdapter({
    symbol: "BTC-USDT",
    interval: "1m",
    apiKey: "test-key",
    secretKey: "test-secret",
    marketType: "futures"
  });
  adapter.setConnected(true);
  return adapter;
};

// Helpers to build realistic Bitunix fixture payloads
const orderFixture = {
  orderId: "ORD001",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  status: "NEW",
  origQty: "0.1",
  executedQty: "0",
  price: "30000",
  time: 1678888888000,
  updateTime: 1678888889000
};

const tpslFixture = {
  tpslId: "TPSL001",
  symbol: "BTCUSDT",
  positionId: "POS001",
  tpslType: "TAKE_PROFIT",
  status: "INIT",
  triggerPrice: "35000",
  qty: "0.1",
  side: "SELL",
  createTime: 1678888888000,
  updateTime: 1678888889000
};

const positionFixture = {
  positionId: "POS001",
  symbol: "BTCUSDT",
  side: "BUY",
  entryPrice: "30000",
  available: "0.5",
  realizedPnl: "10",
  fee: "0.1",
  openTime: 1678888888000,
  updateTime: 1678888889000
};

const historyPositionFixture = {
  positionId: "HPOS001",
  symbol: "BTCUSDT",
  side: "BUY",
  entryPrice: "28000",
  closePrice: "32000",
  qty: "0.5",
  realizedPnl: "2000",
  fee: "5",
  openTime: 1678888000000,
  closeTime: 1678888888000
};

const historyOrderFixture = {
  orderId: "HORD001",
  clientId: "c001",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  status: "FILLED",
  origQty: "0.1",
  executedQty: "0.1",
  avgPrice: "30000",
  fee: "0.003",
  time: 1678888888000,
  updateTime: 1678888889000
};

const tradeFixture = {
  tradeId: "TRD001",
  orderId: "ORD001",
  symbol: "BTCUSDT",
  side: "BUY",
  qty: "0.1",
  price: "30000",
  fee: "0.003",
  ctime: 1678888888000
};

const leverageFixture = {
  symbol: "BTCUSDT",
  longLeverage: 20,
  marginMode: "ISOLATED",
  positionMode: "ONE_WAY"
};

const balanceFixture = {
  available: "5000",
  balance: "5500"
};

const assetFixture = [
  { coin: "USDT", available: "1000", locked: "200", total: "1200" }
];

const fundingRateFixture = {
  symbol: "BTCUSDT",
  fundingRate: "0.0001",
  nextFundingTime: 1678896000000,
  markPrice: "30100"
};

const tickerFixture = [
  { symbol: "BTCUSDT", lastPrice: "30000", vol24h: "15000", changePercent24h: "2.5" }
];

const klineFixture = [
  [1678800000000, "29800", "30200", "29700", "30000", "1500"],
  [1678803600000, "30000", "30500", "29900", "30300", "1200"]
];

const depthFixture = {
  asks: [["30001", "1.5"], ["30002", "2.0"]],
  bids: [["29999", "1.0"], ["29998", "0.8"]]
};

const tradingPairFixture = [{
  symbol: "BTCUSDT",
  baseCurrency: "BTC",
  quoteCurrency: "USDT",
  pricePrecision: 2,
  quantityPrecision: 4,
  minSize: 0.001,
  maxSize: 1000,
  maxLeverage: 125,
  status: "TRADING"
}];

const positionTierFixture = [{
  tier: 1,
  symbol: "BTCUSDT",
  minNotional: 0,
  maxNotional: 50000,
  maxLeverage: 125,
  maintenanceMarginRate: 0.004
}];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BitunixMarketApi", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  // -------------------------------------------------------------------------
  // getKline / GET /api/v1/futures/market/kline
  // -------------------------------------------------------------------------
  it("getKline sends correct request and parses candles", async () => {
    adapter.mockRequest.mockResolvedValue(klineFixture);

    const candles = await adapter.market.getKline({ symbol: "BTC-USDT", interval: "1m", limit: 2 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/market/kline",
      query: expect.objectContaining({ symbol: "BTCUSDT", granularity: "1", limit: 2 })
    }));

    expect(candles).toHaveLength(2);
    // Sorted chronologically
    expect(candles[0].timeUtcMs).toBe(1678800000000);
    expect(candles[0].open).toBe(29800);
    expect(candles[0].close).toBe(30000);
    expect(candles[1].close).toBe(30300);
  });

  it("getKline defaults limit to 200", async () => {
    adapter.mockRequest.mockResolvedValue([]);
    await adapter.market.getKline({ symbol: "BTC-USDT", interval: "1h" });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ granularity: "60", limit: 200 })
    }));
  });

  // -------------------------------------------------------------------------
  // getTicker / GET /api/v1/futures/market/tickers
  // -------------------------------------------------------------------------
  it("getTicker sends correct request and parses price", async () => {
    adapter.mockRequest.mockResolvedValue(tickerFixture);

    const ticker = await adapter.market.getTicker("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/market/tickers",
      query: { symbol: "BTCUSDT" }
    }));
    expect(ticker.price).toBe(30000);
    expect(ticker.volume24h).toBe(15000);
    expect(ticker.changePercent).toBe(2.5);
  });

  it("getTicker throws INTERNAL_ERROR on empty response", async () => {
    adapter.mockRequest.mockResolvedValue([]);
    await expect(adapter.market.getTicker("BTC-USDT")).rejects.toThrow(ExchangeError);
  });

  // -------------------------------------------------------------------------
  // getDepth / GET /api/v1/futures/market/depth
  // -------------------------------------------------------------------------
  it("getDepth sends correct request and parses bids/asks", async () => {
    adapter.mockRequest.mockResolvedValue(depthFixture);

    const depth = await adapter.getDepth("BTC-USDT", 20);

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/market/depth",
      query: { symbol: "BTCUSDT", limit: 20 }
    }));
    expect(depth.asks[0]).toEqual([30001, 1.5]);
    expect(depth.bids[0]).toEqual([29999, 1.0]);
    expect(typeof depth.timestampUtc).toBe("string");
  });

  it("getDepth rejects invalid limit values", async () => {
    await expect(adapter.getDepth("BTC-USDT", 15)).rejects.toThrow("Depth limit must be one of");
  });

  it("getDepth defaults limit to 20", async () => {
    adapter.mockRequest.mockResolvedValue(depthFixture);
    await adapter.market.getDepth({ symbol: "BTC-USDT" });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ limit: 20 })
    }));
  });

  // -------------------------------------------------------------------------
  // getFundingRate / GET /api/v1/futures/market/funding_rate
  // -------------------------------------------------------------------------
  it("getFundingRate sends correct request and parses rate", async () => {
    adapter.mockRequest.mockResolvedValue(fundingRateFixture);

    const rate = await adapter.market.getFundingRate("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/market/funding_rate",
      query: { symbol: "BTCUSDT" }
    }));
    expect(rate.fundingRate).toBe(0.0001);
    expect(rate.markPrice).toBe(30100);
    expect(typeof rate.nextFundingTimeUtc).toBe("string");
  });

  // -------------------------------------------------------------------------
  // getFundingRateBatch / GET /api/v1/futures/market/funding_rate/batch
  // -------------------------------------------------------------------------
  it("getFundingRateBatch sends comma-separated symbols", async () => {
    adapter.mockRequest.mockResolvedValue([fundingRateFixture]);

    const rates = await adapter.market.getFundingRateBatch(["BTC-USDT"]);

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/market/funding_rate/batch",
      query: { symbols: "BTCUSDT" }
    }));
    expect(rates).toHaveLength(1);
    expect(rates[0].fundingRate).toBe(0.0001);
  });

  it("getFundingRateBatch returns empty array for empty input", async () => {
    const rates = await adapter.market.getFundingRateBatch([]);
    expect(rates).toHaveLength(0);
    expect(adapter.mockRequest).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // getTradingPairs / GET /api/v1/futures/market/trading_pairs
  // -------------------------------------------------------------------------
  it("getTradingPairs sends correct request and parses pairs", async () => {
    adapter.mockRequest.mockResolvedValue(tradingPairFixture);

    const pairs = await adapter.market.getTradingPairs();

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/market/trading_pairs"
    }));
    expect(pairs).toHaveLength(1);
    expect(pairs[0].symbol).toBe("BTCUSDT");
    expect(pairs[0].baseCurrency).toBe("BTC");
    expect(pairs[0].maxLeverage).toBe(125);
    expect(pairs[0].isActive).toBe(true);
  });
});

// ===========================================================================
describe("BitunixAccountApi", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  // -------------------------------------------------------------------------
  // getSingleAccount / GET /api/v1/futures/account
  // -------------------------------------------------------------------------
  it("getSingleAccount sends private request and parses balance", async () => {
    adapter.mockRequest.mockResolvedValue(balanceFixture);

    const balance = await adapter.account.getSingleAccount("USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/account",
      isPrivate: true
    }));
    expect(balance.currency).toBe("USDT");
    expect(balance.available).toBe(5000);
    expect(balance.total).toBe(5500);
  });

  // -------------------------------------------------------------------------
  // getLeverageAndMarginMode / GET /api/v1/futures/account/get_leverage_margin_mode
  // -------------------------------------------------------------------------
  it("getLeverageAndMarginMode sends correct query and parses leverage info", async () => {
    adapter.mockRequest.mockResolvedValue(leverageFixture);

    const info = await adapter.account.getLeverageAndMarginMode("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/account/get_leverage_margin_mode",
      query: { symbol: "BTCUSDT" },
      isPrivate: true
    }));
    expect(info.leverage).toBe(20);
    expect(info.marginMode).toBe("isolated");
    expect(info.positionMode).toBe("one_way");
  });

  // -------------------------------------------------------------------------
  // changeLeverage / POST /api/v1/futures/account/change_leverage
  // -------------------------------------------------------------------------
  it("changeLeverage sends correct body", async () => {
    adapter.mockRequest.mockResolvedValue(leverageFixture);

    await adapter.account.changeLeverage({ symbol: "BTC-USDT", leverage: 20 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/account/change_leverage",
      body: { symbol: "BTCUSDT", leverage: 20 },
      isPrivate: true
    }));
  });

  it("changeLeverage rejects invalid leverage", async () => {
    await expect(adapter.account.changeLeverage({ symbol: "BTC-USDT", leverage: -1 }))
      .rejects.toThrow("Leverage must be a positive number");
  });

  it("changeLeverage rejects zero leverage", async () => {
    await expect(adapter.account.changeLeverage({ symbol: "BTC-USDT", leverage: 0 }))
      .rejects.toThrow("Leverage must be a positive number");
  });

  // -------------------------------------------------------------------------
  // changeMarginMode / POST /api/v1/futures/account/change_margin_mode
  // -------------------------------------------------------------------------
  it("changeMarginMode sends ISOLATED for isolated mode", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    await adapter.account.changeMarginMode({ symbol: "BTC-USDT", mode: "isolated" });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/account/change_margin_mode",
      body: { symbol: "BTCUSDT", marginMode: "ISOLATED" },
      isPrivate: true
    }));
  });

  it("changeMarginMode sends CROSSED for cross mode", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);
    await adapter.account.changeMarginMode({ symbol: "BTC-USDT", mode: "cross" });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: { symbol: "BTCUSDT", marginMode: "CROSSED" }
    }));
  });

  // -------------------------------------------------------------------------
  // changePositionMode / POST /api/v1/futures/account/change_position_mode
  // -------------------------------------------------------------------------
  it("changePositionMode sends HEDGE mode correctly", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);
    await adapter.account.changePositionMode("hedge");
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/account/change_position_mode",
      body: { positionMode: "HEDGE" },
      isPrivate: true
    }));
  });

  it("changePositionMode sends ONE_WAY mode correctly", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);
    await adapter.account.changePositionMode("one_way");
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: { positionMode: "ONE_WAY" }
    }));
  });

  // -------------------------------------------------------------------------
  // adjustPositionMargin / POST /api/v1/futures/account/adjust_position_margin
  // -------------------------------------------------------------------------
  it("adjustPositionMargin sends ADD type for positive amount", async () => {
    adapter.mockRequest.mockResolvedValue({ margin: "5200" });

    const result = await adapter.account.adjustPositionMargin({ symbol: "BTC-USDT", amount: 200 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/account/adjust_position_margin",
      body: expect.objectContaining({ symbol: "BTCUSDT", amount: 200, type: "ADD" }),
      isPrivate: true
    }));
    expect(result.newMargin).toBe(5200);
  });

  it("adjustPositionMargin sends REDUCE type for negative amount", async () => {
    adapter.mockRequest.mockResolvedValue({ margin: "4800" });
    await adapter.account.adjustPositionMargin({ symbol: "BTC-USDT", amount: -200 });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ amount: 200, type: "REDUCE" })
    }));
  });

  it("adjustPositionMargin rejects zero amount", async () => {
    await expect(adapter.account.adjustPositionMargin({ symbol: "BTC-USDT", amount: 0 }))
      .rejects.toThrow("non-zero finite number");
  });

  it("adjustPositionMargin includes positionId when provided", async () => {
    adapter.mockRequest.mockResolvedValue({});
    await adapter.account.adjustPositionMargin({ symbol: "BTC-USDT", amount: 100, positionId: "POS001" });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ positionId: "POS001" })
    }));
  });
});

// ===========================================================================
describe("BitunixPositionApi", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  // -------------------------------------------------------------------------
  // getPendingPosition / GET /api/v1/futures/position/get_pending_positions
  // -------------------------------------------------------------------------
  it("getPendingPosition returns position when one exists", async () => {
    // First call: pending positions; second call: ticker for currentPrice
    adapter.mockRequest
      .mockResolvedValueOnce([positionFixture])
      .mockResolvedValueOnce([{ symbol: "BTCUSDT", lastPrice: "30500" }]);

    const position = await adapter.position.getPendingPosition("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/position/get_pending_positions",
      query: { symbol: "BTCUSDT" },
      isPrivate: true
    }));
    expect(position).not.toBeNull();
    expect(position!.id).toBe("POS001");
    expect(position!.side).toBe("long");
    expect(position!.entryPrice).toBe(30000);
    expect(position!.currentPrice).toBe(30500);
    // Unrealized PnL = (30500 - 30000) * 0.5 = 250
    expect(position!.unrealizedPnl).toBeCloseTo(250);
  });

  it("getPendingPosition returns null for empty list", async () => {
    adapter.mockRequest.mockResolvedValue([]);
    const position = await adapter.position.getPendingPosition("BTC-USDT");
    expect(position).toBeNull();
  });

  // -------------------------------------------------------------------------
  // getHistoryPositions / GET /api/v1/futures/position/get_history_positions
  // -------------------------------------------------------------------------
  it("getHistoryPositions sends pagination and parses history", async () => {
    adapter.mockRequest.mockResolvedValue([historyPositionFixture]);

    const positions = await adapter.position.getHistoryPositions({ symbol: "BTC-USDT", pageNum: 1, pageSize: 20 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/position/get_history_positions",
      query: expect.objectContaining({ symbol: "BTCUSDT", pageNum: 1, pageSize: 20 }),
      isPrivate: true
    }));
    expect(positions).toHaveLength(1);
    expect(positions[0].id).toBe("HPOS001");
    expect(positions[0].side).toBe("long");
    expect(positions[0].entryPrice).toBe(28000);
    expect(positions[0].closePrice).toBe(32000);
    expect(positions[0].realizedPnl).toBe(2000);
  });

  it("getHistoryPositions uses default pagination", async () => {
    adapter.mockRequest.mockResolvedValue([]);
    await adapter.position.getHistoryPositions({});
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ pageNum: 1, pageSize: 50 })
    }));
  });

  // -------------------------------------------------------------------------
  // getPositionTiers / GET /api/v1/futures/position/get_position_tiers
  // -------------------------------------------------------------------------
  it("getPositionTiers sends correct query and parses tiers", async () => {
    adapter.mockRequest.mockResolvedValue(positionTierFixture);

    const tiers = await adapter.position.getPositionTiers("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/position/get_position_tiers",
      query: { symbol: "BTCUSDT" }
    }));
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tier).toBe(1);
    expect(tiers[0].maxLeverage).toBe(125);
    expect(tiers[0].maintenanceMarginRate).toBe(0.004);
  });
});

// ===========================================================================
describe("BitunixTradeApi", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  // -------------------------------------------------------------------------
  // placeOrder / POST /api/v1/futures/trade/place_order
  // -------------------------------------------------------------------------
  it("placeOrder sends correct body for market order", async () => {
    // placeOrder calls place_order, then polls get_order_detail → return final order
    adapter.mockRequest
      .mockResolvedValueOnce({ orderId: "ORD001", clientId: "c001" })
      .mockResolvedValueOnce({ ...orderFixture, status: "FILLED", executedQty: "0.1", avgPrice: "30000" });

    const order = await adapter.trade.placeOrder({ symbol: "BTC-USDT", side: "buy", type: "MARKET", quantity: 0.1 });

    expect(adapter.mockRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/trade/place_order",
      body: expect.objectContaining({
        symbol: "BTCUSDT",
        side: "BUY",
        orderType: "MARKET",
        qty: "0.1",
        tradeSide: "OPEN"
      }),
      isPrivate: true
    }));
    expect(order.status).toBe("filled");
    expect(order.side).toBe("buy");
    expect(order.quantity).toBe(0.1);
  });

  it("placeOrder sends CLOSE tradeSide for isClose=true", async () => {
    adapter.mockRequest
      .mockResolvedValueOnce({ orderId: "ORD002", clientId: "c002" })
      .mockResolvedValueOnce({ ...orderFixture, orderId: "ORD002", status: "FILLED", executedQty: "0.1", avgPrice: "30000" });

    await adapter.trade.placeOrder({ symbol: "BTC-USDT", side: "sell", type: "MARKET", quantity: 0.1, isClose: true });

    expect(adapter.mockRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: expect.objectContaining({ tradeSide: "CLOSE" })
    }));
  });

  it("placeOrder includes price for LIMIT orders", async () => {
    const limitOrder = { ...orderFixture, orderId: "ORD003", clientId: "c003", type: "LIMIT", status: "FILLED", executedQty: "0.1", avgPrice: "29000" };
    adapter.mockRequest
      .mockResolvedValueOnce({ orderId: "ORD003", clientId: "c003" })  // place_order
      .mockResolvedValueOnce(limitOrder);                               // get_order_detail (filled first poll)

    await adapter.trade.placeOrder({ symbol: "BTC-USDT", side: "buy", type: "LIMIT", quantity: 0.1, price: 29000 });

    expect(adapter.mockRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: expect.objectContaining({ price: "29000", orderType: "LIMIT" })
    }));
  });

  // -------------------------------------------------------------------------
  // cancelOrder / POST /api/v1/futures/trade/cancel_orders
  // -------------------------------------------------------------------------
  it("cancelOrder sends correct body and returns parsed order", async () => {
    adapter.mockRequest.mockResolvedValue({ ...orderFixture, status: "CANCELED" });

    const result = await adapter.trade.cancelOrder({ symbol: "BTC-USDT", orderId: "ORD001" });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/trade/cancel_orders",
      body: { symbol: "BTCUSDT", orderId: "ORD001" },
      isPrivate: true
    }));
    expect(result.status).toBe("cancelled");
    expect(result.id).toBe("ORD001");
  });

  // -------------------------------------------------------------------------
  // cancelAllOrders / POST /api/v1/futures/trade/cancel_all_orders
  // -------------------------------------------------------------------------
  it("cancelAllOrders sends correct body and returns count", async () => {
    adapter.mockRequest.mockResolvedValue({ cancelledCount: 3 });

    const result = await adapter.trade.cancelAllOrders("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/trade/cancel_all_orders",
      body: { symbol: "BTCUSDT" },
      isPrivate: true
    }));
    expect(result.cancelledCount).toBe(3);
  });

  it("cancelAllOrders returns 0 count on non-record response", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);
    const result = await adapter.trade.cancelAllOrders("BTC-USDT");
    expect(result.cancelledCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // modifyOrder / POST /api/v1/futures/trade/modify_order
  // -------------------------------------------------------------------------
  it("modifyOrder sends price update", async () => {
    adapter.mockRequest.mockResolvedValue({ ...orderFixture, price: "31000" });

    const result = await adapter.trade.modifyOrder({ symbol: "BTC-USDT", orderId: "ORD001", price: 31000 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/trade/modify_order",
      body: expect.objectContaining({ symbol: "BTCUSDT", orderId: "ORD001", price: "31000" }),
      isPrivate: true
    }));
    expect(result.price).toBe(31000);
  });

  it("modifyOrder sends qty update", async () => {
    adapter.mockRequest.mockResolvedValue({ ...orderFixture, origQty: "0.2" });
    await adapter.trade.modifyOrder({ symbol: "BTC-USDT", orderId: "ORD001", quantity: 0.2 });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ qty: "0.2" })
    }));
  });

  it("modifyOrder rejects when no changes specified", async () => {
    await expect(adapter.trade.modifyOrder({ symbol: "BTC-USDT", orderId: "ORD001" }))
      .rejects.toThrow("requires at least one of");
  });

  // -------------------------------------------------------------------------
  // getOrderDetail / GET /api/v1/futures/trade/get_order_detail
  // -------------------------------------------------------------------------
  it("getOrderDetail sends orderId param and parses order", async () => {
    adapter.mockRequest.mockResolvedValue(orderFixture);

    const result = await adapter.trade.getOrderDetail({ orderId: "ORD001" });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/trade/get_order_detail",
      query: { orderId: "ORD001" },
      isPrivate: true
    }));
    expect(result.id).toBe("ORD001");
    expect(result.type).toBe("limit");
  });

  it("getOrderDetail throws when neither orderId nor clientId provided", async () => {
    await expect(adapter.trade.getOrderDetail({})).rejects.toThrow("orderId or clientId must be provided");
  });

  // -------------------------------------------------------------------------
  // getPendingOrders / GET /api/v1/futures/trade/get_pending_orders
  // -------------------------------------------------------------------------
  it("getPendingOrders sends symbol query and parses list", async () => {
    adapter.mockRequest.mockResolvedValue([orderFixture]);

    const orders = await adapter.trade.getPendingOrders("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/trade/get_pending_orders",
      query: { symbol: "BTCUSDT" },
      isPrivate: true
    }));
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("ORD001");
    expect(orders[0].side).toBe("buy");
  });

  // -------------------------------------------------------------------------
  // getHistoryOrders / GET /api/v1/futures/trade/get_history_orders
  // -------------------------------------------------------------------------
  it("getHistoryOrders sends pagination and parses history", async () => {
    adapter.mockRequest.mockResolvedValue([historyOrderFixture]);

    const orders = await adapter.trade.getHistoryOrders({ symbol: "BTC-USDT", pageNum: 2, pageSize: 10 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/trade/get_history_orders",
      query: expect.objectContaining({ symbol: "BTCUSDT", pageNum: 2, pageSize: 10 }),
      isPrivate: true
    }));
    expect(orders).toHaveLength(1);
    expect(orders[0].orderId).toBe("HORD001");
    expect(orders[0].filledQuantity).toBe(0.1);
    expect(orders[0].fee).toBe(0.003);
  });

  // -------------------------------------------------------------------------
  // getHistoryTrades / GET /api/v1/futures/trade/get_history_trades
  // -------------------------------------------------------------------------
  it("getHistoryTrades sends correct query and parses trades", async () => {
    adapter.mockRequest.mockResolvedValue([tradeFixture]);

    const trades = await adapter.getHistoryTrades({ symbol: "BTC-USDT", limit: 5 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/trade/get_history_trades",
      query: expect.objectContaining({ symbol: "BTCUSDT", limit: 5 }),
      isPrivate: true
    }));
    expect(trades).toHaveLength(1);
    expect(trades[0].id).toBe("TRD001");
    expect(trades[0].side).toBe("buy");
    expect(trades[0].price).toBe(30000);
    expect(trades[0].fee).toBe(0.003);
  });

  // -------------------------------------------------------------------------
  // placeBatchOrders / POST /api/v1/futures/trade/batch_order
  // -------------------------------------------------------------------------
  it("placeBatchOrders groups by symbol and sends two requests", async () => {
    adapter.mockRequest.mockResolvedValue({ successList: [{ orderId: "O1", clientId: "C1" }], failureList: [] });

    const orders: BatchOrderParams[] = [
      { symbol: "BTC-USDT", side: "buy", type: "LIMIT", quantity: 0.1, price: 29000 },
      { symbol: "BTC-USDT", side: "sell", type: "MARKET", quantity: 0.05 },
      { symbol: "ETH-USDT", side: "buy", type: "MARKET", quantity: 1.0 }
    ];

    const results = await adapter.placeBatchOrders(orders);

    expect(adapter.mockRequest).toHaveBeenCalledTimes(2);

    const calls = adapter.mockRequest.mock.calls as Array<[{ body?: { symbol?: string; orderList?: unknown[] } }]>;
    const btcCall = calls.find(([c]) => c.body?.symbol === "BTCUSDT");
    const ethCall = calls.find(([c]) => c.body?.symbol === "ETHUSDT");

    expect(btcCall).toBeDefined();
    expect(btcCall![0].body?.orderList).toHaveLength(2);
    expect(ethCall).toBeDefined();
    expect(ethCall![0].body?.orderList).toHaveLength(1);

    expect(results).toHaveLength(2);
    expect(results[0].successList[0].orderId).toBe("O1");
  });

  it("placeBatchOrders rejects LIMIT orders without price", async () => {
    const orders: BatchOrderParams[] = [
      { symbol: "BTC-USDT", side: "buy", type: "LIMIT", quantity: 0.1 }
    ];
    await expect(adapter.placeBatchOrders(orders)).rejects.toThrow("requires a positive price");
  });

  it("placeBatchOrders rejects orders with non-positive quantity", async () => {
    const orders: BatchOrderParams[] = [
      { symbol: "BTC-USDT", side: "buy", type: "MARKET", quantity: 0 }
    ];
    await expect(adapter.placeBatchOrders(orders)).rejects.toThrow("quantity must be positive");
  });

  it("placeBatchOrders returns empty array for empty input", async () => {
    const results = await adapter.placeBatchOrders([]);
    expect(results).toHaveLength(0);
    expect(adapter.mockRequest).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // flashClosePosition / POST /api/v1/futures/trade/flash_close_position
  // -------------------------------------------------------------------------
  it("flashClosePosition sends positionId and synthetic filled order", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.trade.flashClosePosition({
      symbol: "BTC-USDT",
      positionId: "POS001",
      quantity: 0.5,
      side: "long"  // long position → closing with a sell
    });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/trade/flash_close_position",
      body: { positionId: "POS001" },
      isPrivate: true
    }));
    expect(result.status).toBe("filled");
    expect(result.quantity).toBe(0.5);
    // Closing a long position → the resulting order is a sell
    expect(result.side).toBe("sell");
  });

  // -------------------------------------------------------------------------
  // closeAllPositions / POST /api/v1/futures/trade/close_all_position
  // -------------------------------------------------------------------------
  it("closeAllPositions sends symbol and returns closedCount", async () => {
    adapter.mockRequest.mockResolvedValue({ closedCount: 2 });

    const result = await adapter.trade.closeAllPositions("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/trade/close_all_position",
      body: { symbol: "BTCUSDT" },
      isPrivate: true
    }));
    expect(result.closedCount).toBe(2);
  });
});

// ===========================================================================
describe("BitunixTpSlApi", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  // -------------------------------------------------------------------------
  // placeTpSlOrder / POST /api/v1/futures/tpsl/place_order
  // -------------------------------------------------------------------------
  it("placeTpSlOrder sends correct body for take profit", async () => {
    adapter.mockRequest.mockResolvedValue(tpslFixture);

    const result = await adapter.tpsl.placeTpSlOrder({
      symbol: "BTC-USDT",
      side: "sell",
      triggerSide: "take_profit",
      triggerPrice: 35000,
      quantity: 0.1,
      positionId: "POS001"
    });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/tpsl/place_order",
      body: expect.objectContaining({
        symbol: "BTCUSDT",
        side: "SELL",
        tpslType: "TAKE_PROFIT",
        triggerPrice: "35000",
        qty: "0.1",
        positionId: "POS001"
      }),
      isPrivate: true
    }));
    expect(result.tpslId).toBe("TPSL001");
    expect(result.triggerSide).toBe("take_profit");
    expect(result.triggerPrice).toBe(35000);
  });

  it("placeTpSlOrder sends STOP_LOSS for stop_loss side", async () => {
    adapter.mockRequest.mockResolvedValue({ ...tpslFixture, tpslType: "STOP_LOSS" });
    await adapter.tpsl.placeTpSlOrder({
      symbol: "BTC-USDT", side: "sell", triggerSide: "stop_loss", triggerPrice: 25000, quantity: 0.1
    });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ tpslType: "STOP_LOSS" })
    }));
  });

  it("placeTpSlOrder rejects non-positive triggerPrice", async () => {
    await expect(adapter.tpsl.placeTpSlOrder({
      symbol: "BTC-USDT", side: "sell", triggerSide: "take_profit", triggerPrice: 0, quantity: 0.1
    })).rejects.toThrow("triggerPrice must be a positive number");
  });

  it("placeTpSlOrder rejects non-positive quantity", async () => {
    await expect(adapter.tpsl.placeTpSlOrder({
      symbol: "BTC-USDT", side: "sell", triggerSide: "take_profit", triggerPrice: 35000, quantity: -1
    })).rejects.toThrow("quantity must be a positive number");
  });

  // -------------------------------------------------------------------------
  // placePositionTpSlOrder / POST /api/v1/futures/tpsl/position/place_order
  // -------------------------------------------------------------------------
  it("placePositionTpSlOrder sends tpPrice and slPrice", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.tpsl.placePositionTpSlOrder({
      symbol: "BTC-USDT",
      positionId: "POS001",
      takeProfitPrice: 35000,
      stopLossPrice: 28000
    });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/tpsl/position/place_order",
      body: expect.objectContaining({
        symbol: "BTCUSDT",
        positionId: "POS001",
        tpPrice: "35000",
        slPrice: "28000"
      }),
      isPrivate: true
    }));
    expect(result.success).toBe(true);
  });

  it("placePositionTpSlOrder rejects when both prices are undefined", async () => {
    await expect(adapter.tpsl.placePositionTpSlOrder({ symbol: "BTC-USDT", positionId: "POS001" }))
      .rejects.toThrow("requires at least one of");
  });

  // -------------------------------------------------------------------------
  // getPendingTpSlOrders / GET /api/v1/futures/tpsl/get_pending_orders
  // -------------------------------------------------------------------------
  it("getPendingTpSlOrders sends symbol query and parses list", async () => {
    adapter.mockRequest.mockResolvedValue([tpslFixture]);

    const orders = await adapter.tpsl.getPendingTpSlOrders("BTC-USDT");

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/tpsl/get_pending_orders",
      query: { symbol: "BTCUSDT" },
      isPrivate: true
    }));
    expect(orders).toHaveLength(1);
    expect(orders[0].tpslId).toBe("TPSL001");
    expect(orders[0].triggerSide).toBe("take_profit");
    expect(orders[0].status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // getHistoryTpSlOrders / GET /api/v1/futures/tpsl/get_history_orders
  // -------------------------------------------------------------------------
  it("getHistoryTpSlOrders sends pagination params", async () => {
    adapter.mockRequest.mockResolvedValue([{ ...tpslFixture, status: "TRIGGERED" }]);

    const orders = await adapter.tpsl.getHistoryTpSlOrders({ symbol: "BTC-USDT", pageNum: 1, pageSize: 10 });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/futures/tpsl/get_history_orders",
      query: expect.objectContaining({ symbol: "BTCUSDT", pageNum: 1, pageSize: 10 }),
      isPrivate: true
    }));
    expect(orders[0].status).toBe("triggered");
  });

  // -------------------------------------------------------------------------
  // cancelTpSlOrder / POST /api/v1/futures/tpsl/cancel_order
  // -------------------------------------------------------------------------
  it("cancelTpSlOrder sends correct body", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.tpsl.cancelTpSlOrder({ symbol: "BTC-USDT", tpslId: "TPSL001" });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/tpsl/cancel_order",
      body: { symbol: "BTCUSDT", tpslId: "TPSL001" },
      isPrivate: true
    }));
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // modifyTpSlOrder / POST /api/v1/futures/tpsl/modify_order
  // -------------------------------------------------------------------------
  it("modifyTpSlOrder sends new trigger price", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.tpsl.modifyTpSlOrder({
      tpslId: "TPSL001",
      symbol: "BTC-USDT",
      triggerPrice: 36000,
      quantity: 0.2
    });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/tpsl/modify_order",
      body: expect.objectContaining({
        symbol: "BTCUSDT",
        tpslId: "TPSL001",
        triggerPrice: "36000",
        qty: "0.2"
      }),
      isPrivate: true
    }));
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // modifyPositionTpSlOrder / POST /api/v1/futures/tpsl/position/modify_order
  // -------------------------------------------------------------------------
  it("modifyPositionTpSlOrder sends updated tp and sl prices", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.tpsl.modifyPositionTpSlOrder({
      positionId: "POS001",
      symbol: "BTC-USDT",
      takeProfitPrice: 36000,
      stopLossPrice: 27000
    });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/futures/tpsl/position/modify_order",
      body: expect.objectContaining({
        symbol: "BTCUSDT",
        positionId: "POS001",
        tpPrice: "36000",
        slPrice: "27000"
      }),
      isPrivate: true
    }));
    expect(result.success).toBe(true);
  });

  it("modifyPositionTpSlOrder rejects when both prices undefined", async () => {
    await expect(adapter.tpsl.modifyPositionTpSlOrder({ positionId: "POS001", symbol: "BTC-USDT" }))
      .rejects.toThrow("requires at least one of");
  });
});

// ===========================================================================
describe("BitunixAssetApi", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  // -------------------------------------------------------------------------
  // queryAssets / GET /api/v1/cp/asset/query
  // -------------------------------------------------------------------------
  it("queryAssets sends private GET and parses balances", async () => {
    adapter.mockRequest.mockResolvedValue(assetFixture);

    const assets = await adapter.asset.queryAssets();

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/api/v1/cp/asset/query",
      isPrivate: true
    }));
    expect(assets).toHaveLength(1);
    expect(assets[0].coin).toBe("USDT");
    expect(assets[0].available).toBe(1000);
    expect(assets[0].locked).toBe(200);
    expect(assets[0].total).toBe(1200);
  });

  // -------------------------------------------------------------------------
  // transferToSubAccount / POST /api/v1/cp/asset/transfer-to-sub-account
  // -------------------------------------------------------------------------
  it("transferToSubAccount sends correct body", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.asset.transferToSubAccount({ amount: "100", coin: "USDT" });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/cp/asset/transfer-to-sub-account",
      body: expect.objectContaining({ amount: "100", coin: "USDT" }),
      isPrivate: true
    }));
    expect(result.success).toBe(true);
  });

  it("transferToSubAccount uppercases coin", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);
    await adapter.asset.transferToSubAccount({ amount: "100", coin: "usdt" });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ coin: "USDT" })
    }));
  });

  it("transferToSubAccount rejects non-positive amount", async () => {
    await expect(adapter.asset.transferToSubAccount({ amount: "-50", coin: "USDT" }))
      .rejects.toThrow("amount must be a positive number");
  });

  it("transferToSubAccount rejects empty coin", async () => {
    await expect(adapter.asset.transferToSubAccount({ amount: "100", coin: "" }))
      .rejects.toThrow("coin must be a non-empty string");
  });

  it("transferToSubAccount includes subAccountId when provided", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);
    await adapter.asset.transferToSubAccount({ amount: "100", coin: "USDT", subAccountId: "SUB001" });
    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ subAccountId: "SUB001" })
    }));
  });

  // -------------------------------------------------------------------------
  // transferToMainAccount / POST /api/v1/cp/asset/transfer-to-main-account
  // -------------------------------------------------------------------------
  it("transferToMainAccount sends correct path and body", async () => {
    adapter.mockRequest.mockResolvedValue(undefined);

    const result = await adapter.asset.transferToMainAccount({ amount: "50", coin: "USDT" });

    expect(adapter.mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/cp/asset/transfer-to-main-account",
      body: expect.objectContaining({ amount: "50", coin: "USDT" }),
      isPrivate: true
    }));
    expect(result.success).toBe(true);
  });

  it("transferToMainAccount rejects non-positive amount", async () => {
    await expect(adapter.asset.transferToMainAccount({ amount: "0", coin: "USDT" }))
      .rejects.toThrow("amount must be a positive number");
  });
});

// ===========================================================================
// BitunixAdapter orchestrator — lifecycle and delegation guards
// ===========================================================================
describe("BitunixAdapter orchestrator", () => {
  let adapter: TestableBitunixAdapter;
  beforeEach(() => {
    adapter = makeAdapter();
  });

  it("rejects placeMarketOrder when not connected", async () => {
    adapter.setConnected(false);
    await expect(adapter.placeMarketOrder({ side: "buy", quantity: 0.1 }))
      .rejects.toThrow("not connected");
  });

  it("rejects placeMarketOrder with non-positive quantity", async () => {
    await expect(adapter.placeMarketOrder({ side: "buy", quantity: 0 }))
      .rejects.toThrow("quantity must be a positive finite number");
  });

  it("rejects placeLimitOrder with non-positive price", async () => {
    await expect(adapter.placeLimitOrder({ side: "buy", quantity: 0.1, price: -1 }))
      .rejects.toThrow("price must be a positive finite number");
  });

  it("cancelOrder rejects empty orderId", async () => {
    await expect(adapter.cancelOrder("")).rejects.toThrow("orderId must be non-empty");
  });

  it("getOrder returns null when ORDER_NOT_FOUND", async () => {
    adapter.mockRequest.mockRejectedValue(new ExchangeError({ code: "ORDER_NOT_FOUND", message: "not found" }));
    const result = await adapter.getOrder("ORD999");
    expect(result).toBeNull();
  });

  it("getOrder rethrows non-ORDER_NOT_FOUND errors", async () => {
    adapter.mockRequest.mockRejectedValue(new ExchangeError({ code: "NETWORK_ERROR", message: "network fail" }));
    await expect(adapter.getOrder("ORD999")).rejects.toThrow("network fail");
  });

  it("getBalance delegates to account.getSingleAccount", async () => {
    adapter.mockRequest.mockResolvedValue(balanceFixture);
    const balance = await adapter.getBalance();
    expect(balance.currency).toBe("USDT");
  });

  it("closePosition throws UNSUPPORTED_OPERATION for spot", async () => {
    const spotAdapter = new TestableBitunixAdapter({
      symbol: "BTC-USDT", interval: "1m", apiKey: "k", secretKey: "s", marketType: "spot"
    });
    spotAdapter.setConnected(true);
    await expect(spotAdapter.closePosition()).rejects.toThrow("futures");
  });

  it("closePosition throws NO_POSITION when no open position", async () => {
    // position returns empty -> null
    adapter.mockRequest.mockResolvedValueOnce([]);
    await expect(adapter.closePosition()).rejects.toThrow(ExchangeError);
  });
});
