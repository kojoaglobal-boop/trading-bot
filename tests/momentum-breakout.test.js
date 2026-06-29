import test from "node:test";
import assert from "node:assert/strict";
import { Portfolio } from "../src/core/portfolio.js";
import { MomentumBreakoutStrategy } from "../src/strategies/momentum-breakout.js";

test("MomentumBreakoutStrategy exits when intrabar low touches stop", () => {
  const signal = runPositionScenario({
    latest: {
      low: 96.49,
      high: 102,
      close: 101
    }
  });

  assert.equal(signal.action, "SELL");
  assert.match(signal.reason, /stop loss/);
});

test("MomentumBreakoutStrategy exits when intrabar high touches target", () => {
  const signal = runPositionScenario({
    latest: {
      low: 99,
      high: 108.75,
      close: 101
    }
  });

  assert.equal(signal.action, "SELL");
  assert.match(signal.reason, /take profit/);
});

test("MomentumBreakoutStrategy treats same-bar stop and target as stop first", () => {
  const signal = runPositionScenario({
    latest: {
      low: 96.49,
      high: 108.75,
      close: 101
    }
  });

  assert.equal(signal.action, "SELL");
  assert.match(signal.reason, /stop loss/);
});

function runPositionScenario({ latest }) {
  const portfolio = new Portfolio({
    startingCash: 500,
    cash: 400,
    positions: [{
      symbol: "TSLA",
      assetClass: "stock",
      quantity: 0.25,
      avgPrice: 100
    }]
  });
  const strategy = new MomentumBreakoutStrategy({
    fastPeriod: 2,
    slowPeriod: 3,
    breakoutLookback: 3,
    minVolumeExpansion: 1,
    stopLossPct: 0.035,
    takeProfitRR: 2.5
  });

  for (const stockBar of [
    makeStockBar({ close: 100, high: 101, low: 99 }),
    makeStockBar({ close: 101, high: 102, low: 100 }),
    makeStockBar({ close: 102, high: 103, low: 101 })
  ]) {
    strategy.onBar({ bar: stockBar, portfolio });
  }

  return strategy.onBar({
    bar: makeStockBar(latest),
    portfolio
  });
}

function makeStockBar({ close, high, low }) {
  return {
    time: "2026-01-01T00:00:00Z",
    symbol: "TSLA",
    assetClass: "stock",
    open: close,
    high,
    low,
    close,
    volume: 500000,
    bid: close,
    ask: close
  };
}
