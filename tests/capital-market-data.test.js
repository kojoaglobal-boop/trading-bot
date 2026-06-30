import test from "node:test";
import assert from "node:assert/strict";
import { fetchCapitalPrices, formatCapitalMarketData } from "../src/core/capital-market-data.js";

test("fetchCapitalPrices pulls GOLD through the Capital.com client", async () => {
  const result = await fetchCapitalPrices({
    epic: "GOLD",
    resolution: "M5",
    count: 1,
    client: {
      environment: "demo",
      async getPrices(params) {
        assert.equal(params.epic, "GOLD");
        assert.equal(params.resolution, "MINUTE_5");
        assert.equal(params.max, 1);
        return {
          prices: [{
            snapshotTimeUTC: "2026-01-01T10:00:00",
            openPrice: { bid: 2400, ask: 2402 },
            highPrice: { bid: 2410, ask: 2412 },
            lowPrice: { bid: 2395, ask: 2397 },
            closePrice: { bid: 2405, ask: 2407 },
            lastTradedVolume: 10
          }]
        };
      }
    }
  });

  assert.equal(result.provider, "capital");
  assert.equal(result.resolution, "MINUTE_5");
  assert.equal(result.bars[0].symbol, "XAU/USD");
  assert.equal(result.bars[0].assetClass, "gold");
  assert.match(formatCapitalMarketData(result), /Capital.com Price Bars/);
});
