import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFills } from "../src/core/analytics.js";
import { Portfolio } from "../src/core/portfolio.js";
import { RiskEngine } from "../src/core/risk-engine.js";

test("portfolio tracks paper short entries and covers", () => {
  const portfolio = new Portfolio({ startingCash: 500 });
  portfolio.applyFill({
    time: "2026-01-01T10:00:00Z",
    symbol: "XAU/USD",
    assetClass: "gold",
    side: "SELL",
    intent: "SHORT_ENTRY",
    quantity: 0.1,
    price: 4000,
    notional: 400,
    commission: 0,
    reason: "short test"
  });

  let snapshot = portfolio.snapshot(new Map([["XAU/USD", 3990]]));
  assert.equal(snapshot.positions[0].side, "short");
  assert.equal(snapshot.positions[0].unrealizedPnl, 1);
  assert.equal(snapshot.equity, 501);

  portfolio.applyFill({
    time: "2026-01-01T10:05:00Z",
    symbol: "XAU/USD",
    assetClass: "gold",
    side: "BUY",
    intent: "SHORT_EXIT",
    quantity: 0.1,
    price: 3980,
    notional: 398,
    commission: 0,
    reason: "cover test"
  });

  snapshot = portfolio.snapshot(new Map([["XAU/USD", 3980]]));
  assert.equal(snapshot.positions.length, 0);
  assert.equal(snapshot.equity, 502);
  assert.equal(portfolio.realizedPnl, 2);
});

test("risk engine only allows short entries when enabled for the asset class", () => {
  const bar = makeGoldBar();
  const portfolio = new Portfolio({ startingCash: 500 });
  const baseConfig = {
    allowedAssetClasses: ["gold"],
    maxOpenPositions: 1,
    maxRiskPerTradePct: 0.02,
    maxNotionalPerTradePct: 0.5,
    maxAssetClassExposurePct: { gold: 0.8 },
    maxDrawdownPct: 0.12,
    maxSpreadBps: { gold: 10 },
    minVolume: { gold: 1 }
  };

  const blocked = new RiskEngine(baseConfig).createOrder({
    bar,
    markPrices: new Map([["XAU/USD", 4000]]),
    portfolio,
    signal: {
      action: "SHORT",
      reason: "test",
      stopLossPct: 0.004
    }
  });

  assert.equal(blocked.approved, false);
  assert.match(blocked.reason, /short entries are not allowed/);

  const allowed = new RiskEngine({
    ...baseConfig,
    allowShorts: { gold: true }
  }).createOrder({
    bar,
    markPrices: new Map([["XAU/USD", 4000]]),
    portfolio,
    signal: {
      action: "SHORT",
      reason: "test",
      stopLossPct: 0.004
    }
  });

  assert.equal(allowed.approved, true);
  assert.equal(allowed.order.side, "SELL");
  assert.equal(allowed.order.intent, "SHORT_ENTRY");
});

test("analytics scores short trades as profit when cover price is lower", () => {
  const result = analyzeFills([
    {
      time: "2026-01-01T10:00:00Z",
      symbol: "XAU/USD",
      assetClass: "gold",
      side: "SELL",
      intent: "SHORT_ENTRY",
      quantity: 0.1,
      price: 4000,
      commission: 0,
      reason: "short"
    },
    {
      time: "2026-01-01T10:05:00Z",
      symbol: "XAU/USD",
      assetClass: "gold",
      side: "BUY",
      intent: "SHORT_EXIT",
      quantity: 0.1,
      price: 3980,
      commission: 0,
      reason: "cover"
    }
  ]);

  assert.equal(result.closedTrades.length, 1);
  assert.equal(result.closedTrades[0].direction, "short");
  assert.equal(result.closedTrades[0].pnl, 2);
  assert.equal(result.summary.winRate, 1);
});

function makeGoldBar() {
  return {
    time: "2026-01-01T10:00:00Z",
    symbol: "XAU/USD",
    assetClass: "gold",
    open: 4000,
    high: 4010,
    low: 3990,
    close: 4000,
    volume: 100,
    bid: 3999.9,
    ask: 4000.1
  };
}
