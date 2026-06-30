import test from "node:test";
import assert from "node:assert/strict";
import { formatGoldPullbackSweep, runGoldPullbackSweep } from "../src/core/gold-pullback-sweep.js";
import { createSampleBars } from "../src/core/market-data.js";

test("runGoldPullbackSweep ranks pullback candidates on supplied bars", async () => {
  const bars = createSampleBars({
    symbols: [{
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "capital-demo"
    }],
    barsPerSymbol: 260,
    seed: 19
  });

  const sweep = await runGoldPullbackSweep({
    bars,
    maxResults: 3,
    grid: {
      targetRR: [1.2, 2],
      touchAtrMultiple: [0.75],
      stopAtrMultiple: [1, 2],
      maxHoldBars: [12],
      minAtrPct: [0.0002]
    }
  });

  assert.equal(sweep.bars, 260);
  assert.equal(sweep.tested, 4);
  assert.equal(sweep.ranked.length, 3);
  assert.match(formatGoldPullbackSweep(sweep), /Gold Pullback Sweep/);
});
