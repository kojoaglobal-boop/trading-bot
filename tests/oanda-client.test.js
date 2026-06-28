import test from "node:test";
import assert from "node:assert/strict";
import {
  formatOandaCandles,
  instrumentToSymbol,
  normalizeInstrument,
  normalizeOandaCandles,
  OandaClient
} from "../src/integrations/oanda-client.js";

test("OandaClient reports missing account credentials before requests", async () => {
  const client = new OandaClient({
    env: {},
    fetchFn: async () => {
      throw new Error("should not request");
    }
  });

  assert.deepEqual(client.missingKeys(), ["OANDA_ACCOUNT_ID", "OANDA_API_TOKEN"]);
  await assert.rejects(
    () => client.getInstrumentCandles({ instrument: "XAU_USD" }),
    /Missing OANDA keys/
  );
});

test("OandaClient requests practice candles with bearer auth", async () => {
  const requests = [];
  const client = new OandaClient({
    env: {
      OANDA_ENV: "practice",
      OANDA_ACCOUNT_ID: "acct-1",
      OANDA_API_TOKEN: "token-1"
    },
    fetchFn: async (input, options) => {
      requests.push({ input, options });
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            instrument: "XAU_USD",
            granularity: "H1",
            candles: []
          });
        }
      };
    }
  });

  await client.getInstrumentCandles({
    instrument: "XAU/USD",
    granularity: "H1",
    count: 10
  });

  const url = new URL(String(requests[0].input));
  assert.equal(url.origin, "https://api-fxpractice.oanda.com");
  assert.equal(url.pathname, "/v3/instruments/XAU_USD/candles");
  assert.equal(url.searchParams.get("granularity"), "H1");
  assert.equal(url.searchParams.get("count"), "10");
  assert.equal(requests[0].options.headers.Authorization, "Bearer token-1");
});

test("normalizeOandaCandles maps XAU_USD candles to internal gold bars", () => {
  const bars = normalizeOandaCandles({
    instrument: "XAU_USD",
    granularity: "H1",
    candles: [{
      complete: true,
      time: "2026-01-01T10:00:00.000000000Z",
      volume: 123,
      mid: {
        o: "2390.1",
        h: "2395.2",
        l: "2388.4",
        c: "2393.7"
      }
    }]
  }, {
    environment: "practice"
  });

  assert.equal(bars.length, 1);
  assert.equal(bars[0].symbol, "XAU/USD");
  assert.equal(bars[0].assetClass, "gold");
  assert.equal(bars[0].venue, "oanda-practice");
  assert.equal(bars[0].close, 2393.7);
  assert.equal(bars[0].source.provider, "oanda");
  assert.match(formatOandaCandles(bars), /XAU\/USD/);
});

test("instrument helpers normalize OANDA symbols", () => {
  assert.equal(normalizeInstrument("xau/usd"), "XAU_USD");
  assert.equal(normalizeInstrument("eur-usd"), "EUR_USD");
  assert.equal(instrumentToSymbol("EUR_USD"), "EUR/USD");
});
