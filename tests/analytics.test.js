import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFills } from "../src/core/analytics.js";

test("analyzeFills pairs buys and sells into closed trades", () => {
  const result = analyzeFills([
    {
      time: "2025-01-01T00:00:00.000Z",
      symbol: "TSLA",
      assetClass: "stock",
      side: "BUY",
      quantity: 10,
      price: 100,
      commission: 1,
      reason: "entry"
    },
    {
      time: "2025-01-02T00:00:00.000Z",
      symbol: "TSLA",
      assetClass: "stock",
      side: "SELL",
      quantity: 10,
      price: 110,
      commission: 1,
      reason: "exit"
    }
  ]);

  assert.equal(result.summary.closedTrades, 1);
  assert.equal(result.summary.winners, 1);
  assert.equal(result.summary.winRate, 1);
  assert.equal(result.closedTrades[0].pnl, 98);
});

test("analyzeFills reports expectancy and payoff quality", () => {
  const result = analyzeFills([
    {
      time: "2025-01-01T00:00:00.000Z",
      symbol: "TSLA",
      assetClass: "stock",
      side: "BUY",
      quantity: 10,
      price: 100,
      commission: 0,
      reason: "entry"
    },
    {
      time: "2025-01-02T00:00:00.000Z",
      symbol: "TSLA",
      assetClass: "stock",
      side: "SELL",
      quantity: 10,
      price: 110,
      commission: 0,
      reason: "exit"
    },
    {
      time: "2025-01-03T00:00:00.000Z",
      symbol: "AAPL",
      assetClass: "stock",
      side: "BUY",
      quantity: 10,
      price: 100,
      commission: 0,
      reason: "entry"
    },
    {
      time: "2025-01-04T00:00:00.000Z",
      symbol: "AAPL",
      assetClass: "stock",
      side: "SELL",
      quantity: 10,
      price: 95,
      commission: 0,
      reason: "exit"
    }
  ]);

  assert.equal(result.summary.closedTrades, 2);
  assert.equal(result.summary.winRate, 0.5);
  assert.equal(result.summary.lossRate, 0.5);
  assert.equal(result.summary.averageWin, 100);
  assert.equal(result.summary.averageLoss, -50);
  assert.equal(result.summary.payoffRatio, 2);
  assert.equal(result.summary.expectancyPerTrade, 25);
  assert.equal(result.summary.expectancyReturnPct, 0.025000000000000022);
});
