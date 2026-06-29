import test from "node:test";
import assert from "node:assert/strict";
import {
  AlpacaClient,
  createPaperMarketOrderFromRiskOrder,
  createLimitCancelSmokeOrder,
  createTinyMarketOrder,
  formatAlpacaAccount,
  formatActivities,
  formatAlpacaClock,
  formatLatestBars,
  formatOrder,
  formatOrders,
  formatPositions,
  formatSmokeOrderResult
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

test("AlpacaClient fetches paper market clock", async () => {
  let capturedUrl = "";
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret",
      ALPACA_BASE_URL: "https://paper.example.test"
    },
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({
        is_open: true,
        timestamp: "2026-01-01T14:30:00Z"
      });
    }
  });

  const clock = await client.getClock();

  assert.equal(clock.is_open, true);
  assert.equal(capturedUrl, "https://paper.example.test/v2/clock");
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

test("AlpacaClient fetches historical stock bars and positions", async () => {
  const calls = [];
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret",
      ALPACA_BASE_URL: "https://paper.example.test",
      ALPACA_DATA_BASE_URL: "https://data.example.test"
    },
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/positions")) {
        return jsonResponse([{ symbol: "TSLA", qty: "1" }]);
      }
      return jsonResponse({
        bars: {
          TSLA: [{
            o: 249,
            h: 252,
            l: 248,
            c: 250,
            v: 1000,
            t: "2026-01-01T00:00:00Z"
          }]
        }
      });
    }
  });

  const bars = await client.getStockBars({
    symbols: ["TSLA"],
    timeframe: "1Hour",
    limit: 80,
    feed: "iex"
  });
  const positions = await client.getPositions();

  assert.equal(bars.bars.TSLA.length, 1);
  assert.equal(positions[0].symbol, "TSLA");
  assert.match(calls[0], /timeframe=1Hour/);
  assert.match(calls[0], /limit=80/);
  assert.match(calls[0], /sort=desc/);
});

test("AlpacaClient fetches orders with filters and fill activities", async () => {
  const calls = [];
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret",
      ALPACA_BASE_URL: "https://paper.example.test"
    },
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/activities/FILL")) {
        return jsonResponse([{
          id: "fill-1",
          symbol: "AAPL",
          qty: "1",
          price: "100",
          side: "buy"
        }]);
      }
      return jsonResponse([{
        id: "order-1",
        symbol: "AAPL",
        status: "filled"
      }]);
    }
  });

  const orders = await client.listOrders({
    status: "all",
    limit: 50,
    after: "2026-01-01T00:00:00Z",
    until: "2026-01-02T00:00:00Z",
    direction: "desc",
    symbols: ["AAPL"],
    nested: true
  });
  const fills = await client.getAccountActivities({
    activityType: "FILL",
    after: "2026-01-01T00:00:00Z",
    until: "2026-01-02T00:00:00Z",
    pageSize: 50
  });

  assert.equal(orders[0].id, "order-1");
  assert.equal(fills[0].id, "fill-1");
  assert.match(calls[0], /status=all/);
  assert.match(calls[0], /symbols=AAPL/);
  assert.match(calls[0], /nested=true/);
  assert.match(calls[1], /activities\/FILL/);
  assert.match(calls[1], /page_size=50/);
});

test("AlpacaClient submits and cancels paper orders", async () => {
  const calls = [];
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret",
      ALPACA_BASE_URL: "https://paper.example.test"
    },
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      if (options.method === "POST") {
        return jsonResponse({
          id: "order-1",
          symbol: "AAPL",
          side: "buy",
          type: "limit",
          status: "accepted"
        });
      }
      if (options.method === "DELETE") {
        return jsonResponse({}, 204);
      }
      return jsonResponse({
        id: "order-1",
        symbol: "AAPL",
        side: "buy",
        type: "limit",
        status: "canceled"
      });
    }
  });

  const submitted = await client.submitOrder(createLimitCancelSmokeOrder());
  await client.cancelOrder(submitted.id);
  const afterCancel = await client.getOrder(submitted.id);

  assert.equal(submitted.id, "order-1");
  assert.equal(afterCancel.status, "canceled");
  assert.equal(calls[0].url, "https://paper.example.test/v2/orders");
  assert.equal(JSON.parse(calls[0].options.body).limit_price, "1.00");
  assert.equal(calls[1].options.method, "DELETE");
});

test("tiny market order builder caps accidental large notional orders", async () => {
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret"
    },
    fetchFn: async () => jsonResponse({})
  });

  const order = createTinyMarketOrder({ symbol: "tsla", notional: "1" });

  assert.equal(order.symbol, "TSLA");
  assert.equal(order.notional, "1");
  assert.equal(order.side, "buy");
  assert.equal(order.type, "market");
  assert.equal(order.time_in_force, "day");
  assert.match(order.client_order_id, /^tb-market-/);
  await assert.rejects(
    () => client.submitOrder(createTinyMarketOrder({ notional: "6" })),
    /capped at \$5/
  );
});

test("risk orders convert to capped Alpaca paper market orders", () => {
  const buy = createPaperMarketOrderFromRiskOrder({
    order: {
      symbol: "tsla",
      side: "BUY",
      quantity: 10,
      expectedPrice: 250
    },
    maxBuyNotional: 5
  });

  assert.equal(buy.symbol, "TSLA");
  assert.equal(buy.side, "buy");
  assert.equal(buy.notional, "5.00");
  assert.match(buy.client_order_id, /^tb-loop-/);

  const trainingBuy = createPaperMarketOrderFromRiskOrder({
    order: {
      symbol: "tsla",
      side: "BUY",
      quantity: 10,
      expectedPrice: 250
    },
    maxBuyNotional: 100
  });

  assert.equal(trainingBuy.notional, "100.00");

  assert.deepEqual(createPaperMarketOrderFromRiskOrder({
    order: {
      symbol: "TSLA",
      side: "SELL",
      quantity: 0.252221028,
      expectedPrice: 250
    },
    maxBuyNotional: 5
  }).qty, "0.252221028");
});

test("loop paper orders allow training-size notional while manual tiny orders stay capped", async () => {
  const submitted = [];
  const client = new AlpacaClient({
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret"
    },
    fetchFn: async (_url, options) => {
      submitted.push(JSON.parse(options.body));
      return jsonResponse({ id: "order-1", status: "accepted" });
    }
  });
  const loopOrder = createPaperMarketOrderFromRiskOrder({
    order: {
      symbol: "TSLA",
      side: "BUY",
      quantity: 10,
      expectedPrice: 250
    },
    maxBuyNotional: 100
  });

  await client.submitOrder(loopOrder);

  assert.equal(submitted[0].notional, "100.00");
  await assert.rejects(
    () => client.submitOrder({
      ...loopOrder,
      notional: "101.00"
    }),
    /capped at \$100/
  );
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
    formatAlpacaClock({
      is_open: true,
      timestamp: "2026-01-01T14:30:00Z",
      next_open: "2026-01-02T14:30:00Z",
      next_close: "2026-01-01T21:00:00Z"
    }),
    /Market Open: yes/
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
  assert.match(
    formatOrder({
      id: "order-1",
      symbol: "AAPL",
      side: "buy",
      type: "market",
      status: "filled",
      notional: "1"
    }),
    /AAPL/
  );
  assert.match(
    formatOrders([
      {
        id: "order-1",
        symbol: "AAPL",
        side: "buy",
        type: "limit",
        status: "canceled"
      }
    ]),
    /canceled/
  );
  assert.match(
    formatPositions([
      {
        symbol: "AAPL",
        qty: "1",
        avg_entry_price: "100",
        market_value: "101",
        unrealized_pl: "1"
      }
    ]),
    /AAPL/
  );
  assert.match(
    formatActivities([
      {
        symbol: "AAPL",
        side: "buy",
        qty: "1",
        price: "100",
        order_id: "order-1",
        transaction_time: "2026-01-01T00:00:00Z"
      }
    ], { title: "Alpaca Fill Activities" }),
    /order-1/
  );
  assert.match(
    formatSmokeOrderResult({
      submitted: {
        id: "order-1",
        symbol: "AAPL",
        side: "buy",
        type: "limit",
        status: "accepted"
      },
      cancelStatus: "requested",
      afterCancel: {
        status: "canceled"
      }
    }),
    /Final status/
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
