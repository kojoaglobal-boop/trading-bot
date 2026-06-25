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
