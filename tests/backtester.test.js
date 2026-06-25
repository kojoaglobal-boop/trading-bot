import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config/default.js";
import { runBacktest } from "../src/core/backtester.js";
import { createSampleBars } from "../src/core/market-data.js";
import { PaperBroker } from "../src/core/paper-broker.js";
import { Portfolio } from "../src/core/portfolio.js";
import { RiskEngine } from "../src/core/risk-engine.js";
import { MomentumBreakoutStrategy } from "../src/strategies/momentum-breakout.js";

test("backtester processes sample bars and returns account metrics", () => {
  const bars = createSampleBars({
    symbols: defaultConfig.universe,
    barsPerSymbol: 100,
    seed: 7
  });

  const report = runBacktest({
    bars,
    broker: new PaperBroker(defaultConfig.execution.paper),
    config: defaultConfig,
    mode: "test",
    portfolio: new Portfolio({ startingCash: defaultConfig.account.startingCash }),
    riskEngine: new RiskEngine(defaultConfig.risk),
    strategy: new MomentumBreakoutStrategy(defaultConfig.strategy.momentumBreakout)
  });

  assert.equal(report.metrics.bars, 500);
  assert.equal(Number.isFinite(report.account.finalEquity), true);
  assert.equal(report.account.finalEquity > 0, true);
  assert.equal(Array.isArray(report.equityCurve), true);
});
