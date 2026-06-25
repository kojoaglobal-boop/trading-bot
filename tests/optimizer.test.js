import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config/default.js";
import { createSampleBars } from "../src/core/market-data.js";
import {
  buildParameterSets,
  runParameterSweep,
  runWalkForwardValidation
} from "../src/core/optimizer.js";
import { runBacktest } from "../src/core/backtester.js";
import { PaperBroker } from "../src/core/paper-broker.js";
import { Portfolio } from "../src/core/portfolio.js";
import { RiskEngine } from "../src/core/risk-engine.js";
import { MomentumBreakoutStrategy } from "../src/strategies/momentum-breakout.js";

test("buildParameterSets filters invalid fast/slow combinations", () => {
  const sets = buildParameterSets({
    fastPeriod: [5, 20],
    slowPeriod: [10],
    breakoutLookback: [12],
    minVolumeExpansion: [1],
    stopLossPct: [0.03]
  });

  assert.deepEqual(sets.map((set) => set.fastPeriod), [5]);
});

test("parameter sweep and walk-forward validation return ranked candidates", () => {
  const bars = createSampleBars({
    symbols: defaultConfig.universe.slice(0, 2),
    barsPerSymbol: 80,
    seed: 11
  });
  const grid = {
    fastPeriod: [5, 8],
    slowPeriod: [18],
    breakoutLookback: [12],
    minVolumeExpansion: [1],
    stopLossPct: [0.03]
  };
  const createReport = (candidateBars, params) => runBacktest({
    bars: candidateBars,
    broker: new PaperBroker(defaultConfig.execution.paper),
    config: defaultConfig,
    mode: "test",
    portfolio: new Portfolio({ startingCash: defaultConfig.account.startingCash }),
    riskEngine: new RiskEngine(defaultConfig.risk),
    strategy: new MomentumBreakoutStrategy({
      ...defaultConfig.strategy.momentumBreakout,
      ...params
    })
  });

  const sweep = runParameterSweep({ bars, createReport, grid, limit: 2 });
  const walkForward = runWalkForwardValidation({ bars, createReport, grid, limit: 2 });

  assert.equal(sweep.tested, 2);
  assert.equal(sweep.top.length, 2);
  assert.equal(walkForward.tested, 2);
  assert.equal(walkForward.top.length, 2);
});
