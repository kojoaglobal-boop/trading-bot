import test from "node:test";
import assert from "node:assert/strict";
import {
  CoinbaseClient,
  formatCoinbaseBars,
  normalizeCoinbaseCandles
} from "../src/integrations/coinbase-client.js";

test("CoinbaseClient fetches public product candles", async () => {
  let capturedUrl = "";
  const client = new CoinbaseClient({
    baseUrl: "https://coinbase.example.test",
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({
        candles: [{
          start: "1767225600",
          low: "100",
          high: "110",
          open: "101",
          close: "109",
          volume: "42"
        }]
      });
    }
  });

  const payload = await client.getPublicProductCandles({
    productId: "BTC-USD",
    start: 1767222000,
    end: 1767225600,
    granularity: "ONE_HOUR",
    limit: 1
  });

  assert.equal(payload.candles.length, 1);
  assert.match(capturedUrl, /market\/products\/BTC-USD\/candles/);
  assert.match(capturedUrl, /granularity=ONE_HOUR/);
});

test("normalizeCoinbaseCandles maps Coinbase candles to internal bars", () => {
  const bars = normalizeCoinbaseCandles({
    candles: [{
      start: "1767225600",
      low: "100",
      high: "110",
      open: "101",
      close: "109",
      volume: "42"
    }]
  }, {
    productId: "BTC-USD",
    granularity: "ONE_HOUR"
  });

  assert.equal(bars.length, 1);
  assert.equal(bars[0].symbol, "BTC/USD");
  assert.equal(bars[0].source.provider, "coinbase");
  assert.match(formatCoinbaseBars(bars), /BTC\/USD/);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async json() {
      return payload;
    }
  };
}
