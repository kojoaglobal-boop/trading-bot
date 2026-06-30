import test from "node:test";
import assert from "node:assert/strict";
import { formatGoldTrendlineSweep, runGoldTrendlineSweep } from "../src/core/gold-trendline-sweep.js";
import { createSampleBars } from "../src/core/market-data.js";

test("runGoldTrendlineSweep ranks parameter candidates on supplied bars", async () => {
  const bars = createSampleBars({
    symbols: [{
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "capital-demo"
    }],
    barsPerSymbol: 180,
    seed: 11
  });

  const sweep = await runGoldTrendlineSweep({
    bars,
    maxResults: 3,
    grid: {
      targetRR: [1.2, 1.6],
      touchAtrMultiple: [0.35],
      entryAtrMultiple: [0.7],
      minAtrPct: [0.0002],
      maxTrendlineViolations: [1]
    }
  });

  assert.equal(sweep.bars, 180);
  assert.equal(sweep.tested, 2);
  assert.equal(sweep.ranked.length, 2);
  assert.match(formatGoldTrendlineSweep(sweep), /Gold Trendline Sweep/);
});
