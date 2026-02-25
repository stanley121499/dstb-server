/**
 * API Contract Tests for Bitunix Adapter
 *
 * Two layers of protection:
 *
 * 1. SCHEMA LAYER — validates that fixture files still match the expected
 *    raw API response shape (throws SchemaError when a required field is
 *    missing or has the wrong type).  When Bitunix changes a field name or
 *    type, these tests will fail **before** the bug reaches production.
 *
 * 2. PARSER LAYER — passes each fixture through the domain parser (parseOrder,
 *    parseBalance, parseTpSlOrder, etc.) and asserts that the resulting domain
 *    object has the correct TypeScript types and values.  This catches
 *    mis-mapped field names in the parser even when the schema is still valid.
 *
 * Update **both** the fixture AND the schema/parser when a legitimate API
 * change occurs.
 */
import { describe, it, expect } from "vitest";
import {
  validateDepthResponse,
  validateTradeRecord,
  validateBatchOrderResponse,
  validateBalanceRecord,
  validatePositionRecord,
  validateOrderRecord,
  validateKlineRow,
  validateTickerRecord,
  validateFundingRateRecord,
  validateLeverageModeRecord,
  validateTpSlOrderRecord,
  validateHistoryOrderRecord,
  validateHistoryPositionRecord,
  SchemaError
} from "../bitunixSchemas.js";
import {
  parseOrder,
  parseBalance,
  parseTrade,
  parseTpSlOrder,
  parseHistoryOrder,
  parseHistoryPosition,
  parseCandles
} from "../BitunixParsers.js";

// Load fixtures
import depthFixture from "./fixtures/depth_response.json" assert { type: "json" };
import tradesFixture from "./fixtures/history_trades_response.json" assert { type: "json" };
import batchOrderFixture from "./fixtures/batch_order_response.json" assert { type: "json" };
import balanceFixture from "./fixtures/balance_response.json" assert { type: "json" };
import positionFixture from "./fixtures/position_response.json" assert { type: "json" };
import orderFixture from "./fixtures/order_response.json" assert { type: "json" };
import klineRowFixture from "./fixtures/kline_row.json" assert { type: "json" };
import tickerFixture from "./fixtures/ticker_response.json" assert { type: "json" };
import fundingRateFixture from "./fixtures/funding_rate_response.json" assert { type: "json" };
import leverageModeFixture from "./fixtures/leverage_mode_response.json" assert { type: "json" };
import tpslOrderFixture from "./fixtures/tpsl_order_response.json" assert { type: "json" };
import historyOrderFixture from "./fixtures/history_order_response.json" assert { type: "json" };
import historyPositionFixture from "./fixtures/history_position_response.json" assert { type: "json" };

describe("Bitunix API Contract Tests", () => {
  // -------------------------------------------------------------------------
  // GET /api/v1/futures/market/depth
  // -------------------------------------------------------------------------
  describe("depth response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateDepthResponse(depthFixture)).not.toThrow();
    });

    it("extracts correct ask/bid count", () => {
      const result = validateDepthResponse(depthFixture);
      expect(result.asks).toHaveLength(3);
      expect(result.bids).toHaveLength(3);
    });

    it("throws SchemaError when 'asks' field is missing", () => {
      const broken = { bids: depthFixture.bids };
      expect(() => validateDepthResponse(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when 'bids' field is missing", () => {
      const broken = { asks: depthFixture.asks };
      expect(() => validateDepthResponse(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when price entry is a number instead of string", () => {
      const broken = {
        asks: [[30000, "1.5"]], // number instead of string
        bids: depthFixture.bids
      };
      expect(() => validateDepthResponse(broken)).toThrow(SchemaError);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/trade/get_history_trades
  // -------------------------------------------------------------------------
  describe("history trades response shape", () => {
    it("validates all fixture records successfully", () => {
      expect(Array.isArray(tradesFixture)).toBe(true);
      for (const record of tradesFixture) {
        expect(() => validateTradeRecord(record)).not.toThrow();
      }
    });

    it("extracts correct field values from first trade", () => {
      const trade = validateTradeRecord(tradesFixture[0]);
      expect(trade.tradeId).toBe("t001");
      expect(trade.side).toBe("BUY");
      expect(trade.ctime).toBe(1678888888000);
    });

    it("throws SchemaError when tradeId is missing", () => {
      const { tradeId: _removed, ...broken } = tradesFixture[0];
      expect(() => validateTradeRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when ctime is not a number", () => {
      const broken = { ...tradesFixture[0], ctime: "not-a-timestamp" };
      expect(() => validateTradeRecord(broken)).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseTrade maps fixture to correct Trade domain object", () => {
      const trade = parseTrade(tradesFixture[0]);
      expect(trade.id).toBe("t001");
      expect(trade.side).toBe("buy"); // lowercase
      expect(trade.price).toBe(30000);
      expect(trade.quantity).toBe(0.1);
      expect(trade.fee).toBeTypeOf("number");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/futures/trade/batch_order
  // -------------------------------------------------------------------------
  describe("batch order response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateBatchOrderResponse(batchOrderFixture)).not.toThrow();
    });

    it("extracts correct success/failure counts", () => {
      const result = validateBatchOrderResponse(batchOrderFixture);
      expect(result.successList).toHaveLength(2);
      expect(result.failureList).toHaveLength(1);
    });

    it("extracts errorCode from failure entry", () => {
      const result = validateBatchOrderResponse(batchOrderFixture);
      expect(result.failureList[0].errorCode).toBe(20003);
    });

    it("throws SchemaError when successList is missing", () => {
      const { successList: _removed, ...broken } = batchOrderFixture;
      expect(() => validateBatchOrderResponse(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when errorCode is a string", () => {
      const broken = {
        ...batchOrderFixture,
        failureList: [
          { clientId: "x", errorMsg: "err", errorCode: "20003" } // string, not number
        ]
      };
      expect(() => validateBatchOrderResponse(broken)).toThrow(SchemaError);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/account
  // -------------------------------------------------------------------------
  describe("balance response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateBalanceRecord(balanceFixture)).not.toThrow();
    });

    it("throws SchemaError when available field is missing", () => {
      const { available: _removed, ...broken } = balanceFixture;
      expect(() => validateBalanceRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when all balance fields are missing", () => {
      const broken = { available: "100" }; // no balance/total/equity
      expect(() => validateBalanceRecord(broken)).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseBalance maps fixture to correct Balance domain object", () => {
      const balance = parseBalance(balanceFixture, "USDT");
      expect(balance.currency).toBe("USDT");
      expect(balance.available).toBeTypeOf("number");
      expect(balance.available).toBeGreaterThanOrEqual(0);
      expect(balance.total).toBeTypeOf("number");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/position/get_pending_positions
  // -------------------------------------------------------------------------
  describe("position response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validatePositionRecord(positionFixture)).not.toThrow();
    });

    it("throws SchemaError when symbol is missing", () => {
      const { symbol: _removed, ...broken } = positionFixture;
      expect(() => validatePositionRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when positionId and id are both missing", () => {
      const { positionId: _removed, ...broken } = positionFixture;
      expect(() => validatePositionRecord(broken)).toThrow(SchemaError);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/trade/get_order_detail
  // -------------------------------------------------------------------------
  describe("order detail response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateOrderRecord(orderFixture)).not.toThrow();
    });

    it("throws SchemaError when status is missing", () => {
      const { status: _removed, ...broken } = orderFixture;
      expect(() => validateOrderRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when orderId and id are both missing", () => {
      const { orderId: _removed, ...broken } = orderFixture;
      // order_id is also absent in this fixture
      expect(() => validateOrderRecord(broken)).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseOrder maps fixture to correct Order domain object", () => {
      const order = parseOrder(orderFixture);
      expect(order.id).toBe("ord001");
      expect(order.side).toBe("buy"); // BUY → buy
      expect(order.type).toBe("limit"); // LIMIT → limit
      expect(order.status).toBe("open"); // NEW → open
      expect(order.quantity).toBe(0.1);
      expect(order.price).toBe(29000);
      expect(order.createdAtUtc).toBeTypeOf("string");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/market/kline
  // -------------------------------------------------------------------------
  describe("kline row shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateKlineRow(klineRowFixture)).not.toThrow();
    });

    it("extracts correct timestamp from fixture", () => {
      const row = validateKlineRow(klineRowFixture);
      expect(row[0]).toBe(1678800000000);
    });

    it("throws SchemaError when array has fewer than 6 elements", () => {
      expect(() => validateKlineRow([1678800000000, "29800", "30200", "29700", "30000"])).toThrow(SchemaError);
    });

    it("throws SchemaError when timestamp is a string", () => {
      expect(() => validateKlineRow(["1678800000000", "29800", "30200", "29700", "30000", "1500"])).toThrow(SchemaError);
    });

    it("throws SchemaError when not an array", () => {
      expect(() => validateKlineRow({ t: 1678800000000 })).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseCandles maps kline array to ExchangeCandle[]", () => {
      const candles = parseCandles([klineRowFixture]);
      expect(candles).toHaveLength(1);
      expect(candles[0].timeUtcMs).toBe(1678800000000);
      expect(candles[0].open).toBe(29800);
      expect(candles[0].high).toBe(30200);
      expect(candles[0].low).toBe(29700);
      expect(candles[0].close).toBe(30000);
      expect(candles[0].volume).toBe(1500);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/market/tickers
  // -------------------------------------------------------------------------
  describe("ticker response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateTickerRecord(tickerFixture)).not.toThrow();
    });

    it("throws SchemaError when symbol is missing", () => {
      const { symbol: _removed, ...broken } = tickerFixture;
      expect(() => validateTickerRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when no price field is present", () => {
      const broken = { symbol: "BTCUSDT", vol24h: "15000" }; // no lastPrice
      expect(() => validateTickerRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when lastPrice is non-numeric string", () => {
      const broken = { ...tickerFixture, lastPrice: "not-a-number" };
      expect(() => validateTickerRecord(broken)).toThrow(SchemaError);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/market/funding_rate
  // -------------------------------------------------------------------------
  describe("funding rate response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateFundingRateRecord(fundingRateFixture)).not.toThrow();
    });

    it("throws SchemaError when symbol is missing", () => {
      const { symbol: _removed, ...broken } = fundingRateFixture;
      expect(() => validateFundingRateRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when fundingRate is missing", () => {
      const { fundingRate: _removed, ...broken } = fundingRateFixture;
      expect(() => validateFundingRateRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when nextFundingTime is a string", () => {
      const broken = { ...fundingRateFixture, nextFundingTime: "1678896000000" };
      expect(() => validateFundingRateRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when markPrice is non-numeric", () => {
      const broken = { ...fundingRateFixture, markPrice: "NaN" };
      expect(() => validateFundingRateRecord(broken)).toThrow(SchemaError);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/account/get_leverage_margin_mode
  // -------------------------------------------------------------------------
  describe("leverage/margin mode response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateLeverageModeRecord(leverageModeFixture)).not.toThrow();
    });

    it("throws SchemaError when no leverage field is present", () => {
      const broken = { symbol: "BTCUSDT", marginMode: "ISOLATED" }; // no leverage
      expect(() => validateLeverageModeRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when marginMode is missing", () => {
      const { marginMode: _removed, ...broken } = leverageModeFixture;
      expect(() => validateLeverageModeRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when leverage is a string instead of number", () => {
      const broken = { ...leverageModeFixture, longLeverage: "20" };
      expect(() => validateLeverageModeRecord(broken)).toThrow(SchemaError);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/tpsl/get_pending_orders
  // -------------------------------------------------------------------------
  describe("TP/SL order response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateTpSlOrderRecord(tpslOrderFixture)).not.toThrow();
    });

    it("throws SchemaError when tpslId is missing", () => {
      const { tpslId: _removed, ...broken } = tpslOrderFixture;
      expect(() => validateTpSlOrderRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when tpslType is an invalid value", () => {
      const broken = { ...tpslOrderFixture, tpslType: "LIMIT_ORDER" };
      expect(() => validateTpSlOrderRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when triggerPrice is non-numeric", () => {
      const broken = { ...tpslOrderFixture, triggerPrice: "bad-price" };
      expect(() => validateTpSlOrderRecord(broken)).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseTpSlOrder maps fixture to correct TpSlOrder domain object", () => {
      const order = parseTpSlOrder(tpslOrderFixture);
      expect(order.tpslId).toBe("tpsl001");
      expect(order.triggerSide).toBe("take_profit"); // TAKE_PROFIT → take_profit
      expect(order.triggerPrice).toBe(35000);
      expect(order.quantity).toBe(0.1);
      expect(order.status).toBe("pending"); // INIT → pending
      expect(order.orderSide).toBe("sell"); // SELL → sell (field is orderSide, not side)
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/trade/get_history_orders
  // -------------------------------------------------------------------------
  describe("history order response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateHistoryOrderRecord(historyOrderFixture)).not.toThrow();
    });

    it("throws SchemaError when orderId is missing", () => {
      const { orderId: _removed, ...broken } = historyOrderFixture;
      expect(() => validateHistoryOrderRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when symbol is missing", () => {
      const { symbol: _removed, ...broken } = historyOrderFixture;
      expect(() => validateHistoryOrderRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when all quantity fields are missing", () => {
      const { origQty: _removed, ...broken } = historyOrderFixture;
      // executedQty is also still there — remove it too to fully break
      const { executedQty: _removed2, ...broken2 } = broken;
      expect(() => validateHistoryOrderRecord(broken2)).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseHistoryOrder maps fixture to correct HistoryOrder domain object", () => {
      const order = parseHistoryOrder(historyOrderFixture);
      expect(order.orderId).toBe("hord001");
      expect(order.side).toBe("buy"); // BUY → buy
      expect(order.filledQuantity).toBe(0.1);
      expect(order.averageFillPrice).toBe(30000);
      expect(order.fee).toBe(0.003);
      // HistoryOrder.status is a raw string (not mapped to OrderStatus)
      expect(order.status).toBe("FILLED");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/futures/position/get_history_positions
  // -------------------------------------------------------------------------
  describe("history position response shape", () => {
    it("validates the fixture successfully", () => {
      expect(() => validateHistoryPositionRecord(historyPositionFixture)).not.toThrow();
    });

    it("throws SchemaError when positionId is missing", () => {
      const { positionId: _removed, ...broken } = historyPositionFixture;
      expect(() => validateHistoryPositionRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when symbol is missing", () => {
      const { symbol: _removed, ...broken } = historyPositionFixture;
      expect(() => validateHistoryPositionRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when no entry price field present", () => {
      const { entryPrice: _removed, ...broken } = historyPositionFixture;
      expect(() => validateHistoryPositionRecord(broken)).toThrow(SchemaError);
    });

    it("throws SchemaError when closePrice is non-numeric", () => {
      const broken = { ...historyPositionFixture, closePrice: "bad" };
      expect(() => validateHistoryPositionRecord(broken)).toThrow(SchemaError);
    });

    // PARSER LAYER
    it("parseHistoryPosition maps fixture to correct HistoryPosition domain object", () => {
      const position = parseHistoryPosition(historyPositionFixture);
      expect(position.id).toBe("hpos001");
      expect(position.side).toBe("long"); // BUY → long
      expect(position.entryPrice).toBe(28000);
      expect(position.closePrice).toBe(32000);
      expect(position.realizedPnl).toBe(2000);
      // fee is stored as totalFeesPaid in the HistoryPosition domain type
      expect(position.totalFeesPaid).toBe(5);
    });
  });
});
