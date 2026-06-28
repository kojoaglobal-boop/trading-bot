import test from "node:test";
import assert from "node:assert/strict";
import { fetchOandaCandles, formatOandaMarketData } from "../src/core/oanda-market-data.js";

test("fetchOandaCandles pulls XAU_USD through the OANDA client", async () => {
  const result = await fetchOandaCandles({
    instrument: "XAU_USD",
    granularity: "H1",
    count: 1,
    client: {
      environment: "practice",
      async getInstrumentCandles(params) {
        assert.equal(params.instrument, "XAU_USD");
        assert.equal(params.granularity, "H1");
        assert.equal(params.count, 1);
        return {
          instrument: "XAU_USD",
          granularity: "H1",
          candles: [{
            complete: true,
            time: "2026-01-01T10:00:00.000000000Z",
            volume: 50,
            mid: {
              o: "2400",
              h: "2410",
              l: "2395",
              c: "2405"
            }
          }]
        };
      }
    }
  });

  assert.equal(result.provider, "oanda");
  assert.equal(result.bars[0].symbol, "XAU/USD");
  assert.equal(result.bars[0].assetClass, "gold");
  assert.match(formatOandaMarketData(result), /OANDA Candle Bars/);
});
