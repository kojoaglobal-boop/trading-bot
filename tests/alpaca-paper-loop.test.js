import test from "node:test";
import assert from "node:assert/strict";
import {
  createPortfolioFromAlpaca,
  formatAlpacaPaperLoop,
  normalizeAlpacaBars,
  runAlpacaPaperLoop
} from "../src/core/alpaca-paper-loop.js";

test("normalizeAlpacaBars maps Alpaca bar payloads to internal stock bars", () => {
  const bars = normalizeAlpacaBars({
    bars: {
      TSLA: [{
        t: "2026-01-01T10:00:00Z",
        o: 100,
        h: 105,
        l: 99,
        c: 104,
        v: 1000
      }]
    }
  }, { feed: "iex", timeframe: "1Hour" });

  assert.equal(bars.length, 1);
  assert.equal(bars[0].symbol, "TSLA");
  assert.equal(bars[0].assetClass, "stock");
  assert.equal(bars[0].source.provider, "alpaca");
});

test("createPortfolioFromAlpaca includes cash and open paper positions", () => {
  const portfolio = createPortfolioFromAlpaca(
    {
      cash: "400",
      portfolio_value: "500"
    },
    [{
      symbol: "TSLA",
      asset_class: "us_equity",
      qty: "1",
      avg_entry_price: "100"
    }]
  );

  const snapshot = portfolio.snapshot(new Map([["TSLA", 105]]));

  assert.equal(snapshot.cash, 400);
  assert.equal(snapshot.equity, 505);
  assert.equal(snapshot.positions[0].assetClass, "stock");
});

test("runAlpacaPaperLoop logs signals and can submit capped paper orders", async () => {
  const submittedOrders = [];
  const client = {
    async getAccount() {
      return {
        id: "acct-1",
        status: "ACTIVE",
        cash: "500",
        buying_power: "500",
        portfolio_value: "500"
      };
    },
    async getPositions() {
      return [];
    },
    async getStockBars() {
      return {
        bars: {
          TSLA: createBreakoutBars("TSLA")
        }
      };
    },
    async submitOrder(order) {
      submittedOrders.push(order);
      return {
        id: "order-1",
        status: "accepted",
        ...order
      };
    }
  };

  const run = await runAlpacaPaperLoop({
    client,
    symbols: ["TSLA"],
    bars: 30,
    submitOrders: true,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(run.signals.length, 1);
  assert.equal(run.signals[0].action, "BUY");
  assert.equal(run.riskDecisions[0].approved, true);
  assert.equal(run.orders.length, 1);
  assert.equal(submittedOrders[0].notional, "100.00");
  assert.equal(run.orders[0].requestRisk.estimatedRiskDollars, 3.5000000000000004);
  assert.equal(Number(run.orders[0].requestRisk.targetProfitDollars.toFixed(2)), 8.75);
  assert.match(formatAlpacaPaperLoop(run), /Alpaca Live-Paper Strategy Loop/);
});

test("runAlpacaPaperLoop skips paper submission when Alpaca market clock is closed", async () => {
  let submitCalled = false;
  const client = {
    async getAccount() {
      return {
        id: "acct-1",
        status: "ACTIVE",
        cash: "500",
        buying_power: "500",
        portfolio_value: "500"
      };
    },
    async getPositions() {
      return [];
    },
    async getClock() {
      return {
        is_open: false,
        timestamp: "2026-01-01T12:00:00Z",
        next_open: "2026-01-02T14:30:00Z",
        next_close: "2026-01-02T21:00:00Z"
      };
    },
    async getStockBars() {
      return {
        bars: {
          TSLA: createBreakoutBars("TSLA")
        }
      };
    },
    async submitOrder() {
      submitCalled = true;
      throw new Error("submitOrder should not be called while market is closed");
    }
  };

  const run = await runAlpacaPaperLoop({
    client,
    symbols: ["TSLA"],
    bars: 30,
    submitOrders: true,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(submitCalled, false);
  assert.equal(run.orderSubmissionEnabled, false);
  assert.equal(run.marketClock.isOpen, false);
  assert.equal(run.orders[0].status, "skipped-market-closed");
  assert.equal(run.summary.submittedOrders, 0);
  assert.match(formatAlpacaPaperLoop(run), /market closed/);
});

test("runAlpacaPaperLoop fetches recent bars one stock at a time", async () => {
  const requested = [];
  const client = {
    async getAccount() {
      return {
        id: "acct-1",
        status: "ACTIVE",
        cash: "500",
        buying_power: "500",
        portfolio_value: "500"
      };
    },
    async getPositions() {
      return [];
    },
    async getStockBars(options) {
      requested.push(options);
      const symbol = options.symbols[0];
      return {
        bars: {
          [symbol]: createFlatBars(symbol)
        }
      };
    }
  };

  const run = await runAlpacaPaperLoop({
    client,
    symbols: ["AAPL", "TSLA", "NVDA"],
    bars: 30,
    submitOrders: false,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.deepEqual(requested.map((request) => request.symbols), [["AAPL"], ["TSLA"], ["NVDA"]]);
  assert.equal(requested.every((request) => request.sort === "desc"), true);
  assert.equal(run.signals.length, 3);
  assert.equal(run.signals.every((signal) => signal.reason !== "no Alpaca bars returned"), true);
});

test("runAlpacaPaperLoop applies scalp profile defaults", async () => {
  const requested = [];
  const client = {
    async getAccount() {
      return {
        id: "acct-1",
        status: "ACTIVE",
        cash: "500",
        buying_power: "500",
        portfolio_value: "500"
      };
    },
    async getPositions() {
      return [];
    },
    async getStockBars(options) {
      requested.push(options);
      return {
        bars: {
          TSLA: createFlatBars("TSLA")
        }
      };
    }
  };

  const run = await runAlpacaPaperLoop({
    client,
    profile: "scalp",
    symbols: ["TSLA"],
    submitOrders: false,
    now: new Date("2026-01-10T12:00:00Z")
  });

  assert.equal(run.profile, "scalp");
  assert.equal(run.timeframe, "5Min");
  assert.equal(run.lookbackDays, 5);
  assert.equal(run.maxBuyNotional, 100);
  assert.equal(run.targetRewardRiskRatio, 1.3);
  assert.equal(requested[0].timeframe, "5Min");
  assert.equal(requested[0].limit, 120);
  assert.equal(requested[0].start, "2026-01-05T12:00:00.000Z");
});

test("runAlpacaPaperLoop monitors open positions even outside requested basket", async () => {
  const requested = [];
  const client = {
    async getAccount() {
      return {
        id: "acct-1",
        status: "ACTIVE",
        cash: "400",
        buying_power: "400",
        portfolio_value: "500"
      };
    },
    async getPositions() {
      return [{
        symbol: "TSLA",
        asset_class: "us_equity",
        qty: "0.252221028",
        avg_entry_price: "396.44"
      }];
    },
    async getStockBars(options) {
      requested.push(options.symbols[0]);
      return {
        bars: {
          [options.symbols[0]]: createFlatBars(options.symbols[0])
        }
      };
    }
  };

  const run = await runAlpacaPaperLoop({
    client,
    symbols: ["AAPL", "NVDA"],
    bars: 30,
    submitOrders: false,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.deepEqual(requested, ["AAPL", "NVDA", "TSLA"]);
  assert.deepEqual(run.addedPositionSymbols, ["TSLA"]);
  assert.deepEqual(run.symbols, ["AAPL", "NVDA", "TSLA"]);
  assert.match(formatAlpacaPaperLoop(run), /Added exits:\s+TSLA/);
});

function createBreakoutBars(symbol) {
  const bars = [];
  let close = 100;

  for (let index = 0; index < 30; index += 1) {
    if (index === 29) {
      close = 130;
    } else {
      close += 0.2;
    }

    bars.push({
      t: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      o: close - 0.5,
      h: index === 29 ? 131 : close + 0.3,
      l: close - 1,
      c: close,
      v: index === 29 ? 300000 : 200000
    });
  }

  return bars;
}

function createFlatBars(symbol) {
  return Array.from({ length: 30 }, (_value, index) => ({
    t: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    v: 200000,
    symbol
  }));
}
