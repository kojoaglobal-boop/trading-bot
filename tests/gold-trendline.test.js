import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateBars,
  findBestTrendline,
  GoldTrendlineStrategy
} from "../src/strategies/gold-trendline.js";
import { Portfolio } from "../src/core/portfolio.js";

test("aggregateBars builds 15m bars from 5m Gold bars", () => {
  const bars = Array.from({ length: 6 }, (_value, index) => makeGoldBar({
    index,
    close: 4000 + index,
    high: 4001 + index,
    low: 3999 + index,
    volume: 10
  }));

  const aggregated = aggregateBars(bars, 15);

  assert.equal(aggregated.length, 2);
  assert.equal(aggregated[0].open, 4000);
  assert.equal(aggregated[0].close, 4002);
  assert.equal(aggregated[0].volume, 30);
  assert.equal(aggregated[1].close, 4005);
});

test("findBestTrendline scores rising support from swing lows", () => {
  const bars = [
    100, 104, 101, 106, 103, 108, 105, 110, 107, 112, 109, 114
  ].map((close, index) => ({
    ...makeGoldBar({ index, close, high: close + 2, low: close - (index % 2 === 0 ? 2 : 0.5) }),
    time: new Date(Date.UTC(2026, 0, 1, 10, index * 15)).toISOString()
  }));

  const line = findBestTrendline({
    bars,
    pivotType: "low",
    expectedSlope: "up",
    pivotDepth: 1,
    touchTolerance: 1.5,
    maxViolations: 1
  });

  assert.ok(line);
  assert.equal(line.pivotType, "low");
  assert.equal(line.slope > 0, true);
  assert.equal(line.touches >= 2, true);
});

test("GoldTrendlineStrategy manages short exits with COVER signals", () => {
  const strategy = new GoldTrendlineStrategy();
  const portfolio = new Portfolio({
    startingCash: 500,
    cash: 900,
    positions: [{
      symbol: "XAU/USD",
      assetClass: "gold",
      side: "short",
      quantity: 0.1,
      avgPrice: 4000
    }]
  });

  for (let index = 0; index < 130; index += 1) {
    strategy.onBar({
      bar: makeGoldBar({ index, close: 4000 - index * 0.1, high: 4001, low: 3998 }),
      portfolio
    });
  }

  const signal = strategy.onBar({
    bar: makeGoldBar({ index: 131, close: 3980, high: 3985, low: 3970 }),
    portfolio
  });

  assert.equal(signal.action, "COVER");
  assert.match(signal.reason, /target/);
});

function makeGoldBar({ index, close, high = close + 1, low = close - 1, volume = 100 }) {
  return {
    time: new Date(Date.UTC(2026, 0, 1, 9, index * 5)).toISOString(),
    symbol: "XAU/USD",
    assetClass: "gold",
    venue: "capital-demo",
    open: close,
    high,
    low,
    close,
    volume,
    bid: close - 0.1,
    ask: close + 0.1,
    source: {
      provider: "test",
      mode: "gold-trendline"
    }
  };
}
