import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCapitalGoldDemoDecision,
  formatCapitalGoldDemoLoop,
  runCapitalGoldDemoLoop
} from "../src/core/capital-gold-demo-loop.js";
import { createSampleBars } from "../src/core/market-data.js";

test("buildCapitalGoldDemoDecision converts a fresh pullback entry into a demo order plan", () => {
  const bars = Array.from({ length: 16 }, (_value, index) => makeGoldBar(index));
  const latest = bars.at(-1);
  const decision = buildCapitalGoldDemoDecision({
    bars,
    epic: "GOLD",
    openGoldPositions: [],
    size: 0.01,
    strategyOptions: {
      targetRR: 2,
      stopAtrMultiple: 2
    },
    cycle: {
      report: {
        fills: [{
          time: latest.time,
          intent: "LONG_ENTRY",
          price: latest.close,
          reason: "fresh test entry"
        }]
      }
    }
  });

  assert.equal(decision.action, "OPEN");
  assert.equal(decision.order.direction, "BUY");
  assert.equal(decision.order.epic, "GOLD");
  assert.equal(decision.order.size, 0.01);
  assert.equal(decision.order.profitDistance, Number((decision.order.stopDistance * 2).toFixed(2)));
});

test("buildCapitalGoldDemoDecision accepts a recent pullback entry inside age and drift limits", () => {
  const bars = Array.from({ length: 20 }, (_value, index) => makeGoldBar(index));
  const recent = bars.at(-3);
  const decision = buildCapitalGoldDemoDecision({
    bars,
    epic: "GOLD",
    openGoldPositions: [],
    size: 0.01,
    maxSignalAgeBars: 6,
    maxEntryDriftBps: 40,
    cycle: {
      report: {
        fills: [{
          time: recent.time,
          intent: "LONG_ENTRY",
          price: recent.close,
          reason: "recent pullback test entry"
        }]
      }
    }
  });

  assert.equal(decision.action, "OPEN");
  assert.equal(decision.setupType, "recent-pullback");
  assert.equal(decision.order.direction, "BUY");
});

test("buildCapitalGoldDemoDecision opens an aggressive trend-probe when pullback has no fresh fill", () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeGoldBar(index));
  const decision = buildCapitalGoldDemoDecision({
    bars,
    epic: "GOLD",
    openGoldPositions: [],
    size: 0.01,
    allowTrendProbe: true,
    cycle: {
      report: {
        fills: []
      }
    }
  });

  assert.equal(decision.action, "OPEN");
  assert.equal(decision.setupType, "trend-probe");
  assert.equal(decision.order.direction, "BUY");
});

test("runCapitalGoldDemoLoop holds when Capital already has an open Gold demo position", async () => {
  const bars = createSampleBars({
    symbols: [{
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "capital-demo"
    }],
    barsPerSymbol: 220,
    seed: 33
  });
  const client = {
    environment: "demo",
    async getPositions() {
      return {
        positions: [{
          market: { epic: "GOLD" },
          position: {
            dealId: "deal-1",
            direction: "BUY",
            size: 0.3,
            level: 4030
          }
        }]
      };
    }
  };

  const loop = await runCapitalGoldDemoLoop({
    client,
    bars,
    maxOpenPositions: 1,
    submitOrders: false,
    stateFile: false,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(loop.decision.action, "HOLD");
  assert.match(loop.decision.reason, /already has 1\/1 open GOLD/);
  assert.match(formatCapitalGoldDemoLoop(loop), /Capital\.com Gold Demo Loop/);
});

test("buildCapitalGoldDemoDecision closes Gold demo positions below minimum lot size", () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeGoldBar(index));
  const decision = buildCapitalGoldDemoDecision({
    bars,
    epic: "GOLD",
    openGoldPositions: [{
      epic: "GOLD",
      dealId: "small-deal",
      direction: "SELL",
      size: 0.01,
      level: 4014
    }],
    size: 0.3,
    minPositionSize: 0.3,
    cycle: {
      report: {
        fills: []
      }
    }
  });

  assert.equal(decision.action, "CLOSE_UNDERSIZED");
  assert.equal(decision.closePositions.length, 1);
  assert.match(decision.reason, /below minimum size 0.3/);
});

test("buildCapitalGoldDemoDecision blocks duplicate entries on the same latest candle", () => {
  const bars = Array.from({ length: 16 }, (_value, index) => makeGoldBar(index));
  const latest = bars.at(-1);
  const decision = buildCapitalGoldDemoDecision({
    bars,
    epic: "GOLD",
    openGoldPositions: [],
    size: 0.01,
    dailyState: {
      submittedEntryBarTimes: [latest.time]
    },
    cycle: {
      report: {
        fills: [{
          time: latest.time,
          intent: "SHORT_ENTRY",
          reason: "fresh test short"
        }]
      }
    }
  });

  assert.equal(decision.action, "HOLD");
  assert.match(decision.reason, /No tradable Gold setup/);
});

test("runCapitalGoldDemoLoop scans multiple timeframes and plans up to max open positions", async () => {
  const minuteBars = Array.from({ length: 90 }, (_value, index) => makeGoldBar(index));
  const fiveMinuteBars = Array.from({ length: 90 }, (_value, index) => makeGoldBar(index + 100));
  const fifteenMinuteBars = Array.from({ length: 90 }, (_value, index) => makeGoldBar(index + 200));
  const client = {
    environment: "demo",
    async getAccounts() {
      return {
        accounts: [{
          currency: "USD",
          balance: {
            balance: 1000,
            available: 1000
          }
        }]
      };
    },
    async getPositions() {
      return { positions: [] };
    }
  };

  const loop = await runCapitalGoldDemoLoop({
    client,
    barsByResolution: {
      MINUTE: minuteBars,
      MINUTE_5: fiveMinuteBars,
      MINUTE_15: fifteenMinuteBars
    },
    resolutions: ["MINUTE", "MINUTE_5", "MINUTE_15"],
    maxOpenPositions: 2,
    submitOrders: false,
    stateFile: false,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.deepEqual(loop.resolutions, ["MINUTE", "MINUTE_5", "MINUTE_15"]);
  assert.equal(loop.entryDecisions.length, 2);
  assert.equal(loop.timeframeResults.at(-1).decision.action, "HOLD");
  assert.match(loop.timeframeResults.at(-1).decision.reason, /already has 2\/2 open GOLD/);
  assert.match(formatCapitalGoldDemoLoop(loop), /OPEN_MULTIPLE/);
});

test("runCapitalGoldDemoLoop closes Gold positions when the daily max loss guard is hit", async () => {
  const bars = createSampleBars({
    symbols: [{
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "capital-demo"
    }],
    barsPerSymbol: 220,
    seed: 42
  });
  const calls = [];
  const client = {
    environment: "demo",
    async getAccounts() {
      return {
        accounts: [{
          currency: "USD",
          balance: {
            balance: 900,
            available: 900
          }
        }]
      };
    },
    async getPositions() {
      return {
        positions: [{
          market: { epic: "GOLD" },
          position: {
            dealId: "deal-loss",
            direction: "BUY",
            size: 0.01,
            level: 4030,
            upl: 0
          }
        }]
      };
    },
    async closePosition(dealId) {
      calls.push(["closePosition", dealId]);
      return { dealReference: "close-ref-loss" };
    },
    async getConfirm(dealReference) {
      calls.push(["getConfirm", dealReference]);
      return {
        dealReference,
        dealStatus: "ACCEPTED"
      };
    }
  };

  const loop = await runCapitalGoldDemoLoop({
    client,
    bars,
    submitOrders: true,
    stateFile: false,
    state: {
      date: "2026-01-01",
      dayStartEquity: 1000,
      submittedEntryBarTimes: []
    },
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(loop.dailyGuard.status, "MAX_LOSS_HIT");
  assert.equal(loop.decision.action, "CLOSE_ALL");
  assert.deepEqual(calls, [
    ["closePosition", "deal-loss"],
    ["getConfirm", "close-ref-loss"]
  ]);
});

function makeGoldBar(index) {
  const close = 4000 + index;
  return {
    time: new Date(Date.UTC(2026, 0, 1, 10, index * 5)).toISOString(),
    symbol: "XAU/USD",
    assetClass: "gold",
    venue: "capital-demo",
    open: close - 0.5,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100,
    bid: close - 0.2,
    ask: close + 0.2
  };
}
