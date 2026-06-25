import test from "node:test";
import assert from "node:assert/strict";
import {
  AlpacaClient,
  formatAlpacaAccount,
  formatLatestBars
} from "../src/integrations/alpaca-client.js";

test("AlpacaClient reports missing keys before making requests", async () => {
  const client = new AlpacaClient({
    env: {},
    fetchFn: async () => {
      throw new Error("should not fetch");
    }
  });

  await assert.rejects(() => client.getAccount(), /Missing Alpaca keys/);
});

test("AlpacaClient fetches paper account with Alpaca auth headers", async () => {
  let captured = null;
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret",
      ALPACA_BASE_URL: "https://paper.example.test"
    },
    fetchFn: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({
        id: "acct-1",
        status: "ACTIVE",
        buying_power: "500"
      });
    }
  });

  const account = await client.getAccount();

  assert.equal(account.id, "acct-1");
  assert.equal(captured.url, "https://paper.example.test/v2/account");
  assert.equal(captured.options.headers["APCA-API-KEY-ID"], "key");
  assert.equal(captured.options.headers["APCA-API-SECRET-KEY"], "secret");
});

test("AlpacaClient fetches latest bars from data API", async () => {
  let capturedUrl = "";
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret",
      ALPACA_DATA_BASE_URL: "https://data.example.test"
    },
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({
        bars: {
          TSLA: {
            c: 250,
            h: 252,
            l: 248,
            v: 1000,
            t: "2026-01-01T00:00:00Z"
          }
        }
      });
    }
  });

  const bars = await client.getLatestStockBars({
    symbols: ["TSLA"],
    feed: "iex"
  });

  assert.equal(bars.bars.TSLA.c, 250);
  assert.match(capturedUrl, /symbols=TSLA/);
  assert.match(capturedUrl, /feed=iex/);
});

test("Alpaca formatters do not reveal credentials", () => {
  assert.match(
    formatAlpacaAccount({
      id: "acct-1",
      status: "ACTIVE",
      buying_power: "500",
      portfolio_value: "500",
      cash: "500"
    }),
    /Buying Power/
  );
  assert.match(
    formatLatestBars({
      bars: {
        TSLA: {
          c: 250,
          h: 252,
          l: 248,
          v: 1000,
          t: "2026-01-01T00:00:00Z"
        }
      }
    }),
    /TSLA/
  );
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return JSON.stringify(payload);
    }
  };
}
