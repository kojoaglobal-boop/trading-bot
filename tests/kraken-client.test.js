import test from "node:test";
import assert from "node:assert/strict";
import {
  KrakenClient,
  formatKrakenBars,
  normalizeKrakenOhlc
} from "../src/integrations/kraken-client.js";

test("KrakenClient fetches public OHLC bars", async () => {
  let capturedUrl = "";
  const client = new KrakenClient({
    baseUrl: "https://kraken.example.test/0",
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({
        error: [],
        result: {
          XXBTZUSD: [[1767225600, "100", "110", "99", "109", "105", "42", 10]],
          last: 1767225600
        }
      });
    }
  });

  const payload = await client.getOhlc({
    pair: "BTC/USD",
    interval: 60,
    since: 1767222000
  });

  assert.equal(payload.result.XXBTZUSD.length, 1);
  assert.match(capturedUrl, /public\/OHLC/);
  assert.match(capturedUrl, /interval=60/);
});

test("normalizeKrakenOhlc maps Kraken rows to internal bars", () => {
  const bars = normalizeKrakenOhlc({
    error: [],
    result: {
      XXBTZUSD: [[1767225600, "100", "110", "99", "109", "105", "42", 10]],
      last: 1767225600
    }
  }, {
    requestedPair: "BTC/USD",
    interval: 60
  });

  assert.equal(bars.length, 1);
  assert.equal(bars[0].symbol, "BTC/USD");
  assert.equal(bars[0].source.provider, "kraken");
  assert.match(formatKrakenBars(bars), /BTC\/USD/);
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
