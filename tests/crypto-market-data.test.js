import test from "node:test";
import assert from "node:assert/strict";
import { fetchCryptoBars, formatCryptoBars } from "../src/core/crypto-market-data.js";

test("fetchCryptoBars uses Coinbase as primary provider", async () => {
  const result = await fetchCryptoBars({
    provider: "coinbase",
    product: "BTC-USD",
    limit: 1,
    lookbackDays: 1,
    now: new Date("2026-01-01T00:00:00Z"),
    coinbaseClient: {
      async getPublicProductCandles(params) {
        assert.equal(params.productId, "BTC-USD");
        return {
          candles: [{
            start: "1767225600",
            low: "100",
            high: "110",
            open: "101",
            close: "109",
            volume: "42"
          }]
        };
      }
    }
  });

  assert.equal(result.provider, "coinbase");
  assert.equal(result.bars[0].symbol, "BTC/USD");
  assert.match(formatCryptoBars(result), /Coinbase Public/);
});

test("fetchCryptoBars uses Kraken as fallback provider", async () => {
  const result = await fetchCryptoBars({
    provider: "kraken",
    pair: "BTC/USD",
    limit: 1,
    lookbackDays: 1,
    now: new Date("2026-01-01T00:00:00Z"),
    krakenClient: {
      async getOhlc(params) {
        assert.equal(params.pair, "BTC/USD");
        return {
          error: [],
          result: {
            XXBTZUSD: [[1767225600, "100", "110", "99", "109", "105", "42", 10]],
            last: 1767225600
          }
        };
      }
    }
  });

  assert.equal(result.provider, "kraken");
  assert.equal(result.bars.length, 1);
  assert.match(formatCryptoBars(result), /Kraken Public/);
});
