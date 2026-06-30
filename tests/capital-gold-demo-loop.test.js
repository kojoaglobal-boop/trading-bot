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
            size: 0.01,
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
  assert.match(decision.reason, /already submitted/);
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
