import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config/default.js";
import { Portfolio } from "../src/core/portfolio.js";
import { RiskEngine } from "../src/core/risk-engine.js";

test("risk engine rejects bars with excessive spread", () => {
  const risk = new RiskEngine(defaultConfig.risk);
  const portfolio = new Portfolio({ startingCash: 100000 });

  const result = risk.createOrder({
    bar: {
      time: new Date().toISOString(),
      symbol: "PEPE-USD",
      assetClass: "meme",
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1000000,
      bid: 0.9,
      ask: 1.1
    },
    markPrices: new Map([["PEPE-USD", 1]]),
    portfolio,
    signal: {
      action: "BUY",
      reason: "test",
      stopLossPct: 0.03
    }
  });

  assert.equal(result.approved, false);
  assert.match(result.reason, /spread too wide/);
});

test("risk engine sizes approved buy orders within max notional", () => {
  const risk = new RiskEngine(defaultConfig.risk);
  const portfolio = new Portfolio({ startingCash: 100000 });

  const result = risk.createOrder({
    bar: {
      time: new Date().toISOString(),
      symbol: "TSLA",
      assetClass: "stock",
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 500000,
      bid: 101.99,
      ask: 102.01
    },
    markPrices: new Map([["TSLA", 102]]),
    portfolio,
    signal: {
      action: "BUY",
      reason: "test",
      stopLossPct: 0.03
    }
  });

  assert.equal(result.approved, true);
  assert.equal(result.order.symbol, "TSLA");
  assert.equal(result.order.quantity * result.order.expectedPrice <= 12000.01, true);
});

test("risk engine allows exits even when spread is too wide for entries", () => {
  const risk = new RiskEngine(defaultConfig.risk);
  const portfolio = new Portfolio({ startingCash: 100000 });
  portfolio.applyFill({
    time: new Date().toISOString(),
    symbol: "PEPE-USD",
    assetClass: "meme",
    side: "BUY",
    quantity: 1000,
    price: 1,
    notional: 1000,
    commission: 1,
    reason: "seed position"
  });

  const result = risk.createOrder({
    bar: {
      time: new Date().toISOString(),
      symbol: "PEPE-USD",
      assetClass: "meme",
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      bid: 0.9,
      ask: 1.1
    },
    markPrices: new Map([["PEPE-USD", 1]]),
    portfolio,
    signal: {
      action: "SELL",
      reason: "exit risk"
    }
  });

  assert.equal(result.approved, true);
  assert.equal(result.order.side, "SELL");
});
