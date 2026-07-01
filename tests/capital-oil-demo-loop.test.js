import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCapitalOilDemoDecision,
  buildInventoryBlackoutGuard,
  buildOilMomentumSignal,
  buildOilProfitTargetAdjustments,
  formatCapitalOilDemoLoop,
  runCapitalOilDemoLoop
} from "../src/core/capital-oil-demo-loop.js";

test("buildOilMomentumSignal opens a crude oil breakout with trend and volume", () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeOilBar(index));
  const signal = buildOilMomentumSignal({
    bars,
    minVolumeExpansion: 0.1
  });

  assert.equal(signal.action, "OPEN");
  assert.equal(signal.direction, "BUY");
  assert.equal(signal.setupType, "oil-breakout");
});

test("buildCapitalOilDemoDecision converts an oil signal into a demo order", () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeOilBar(index));
  const signal = buildOilMomentumSignal({
    bars,
    minVolumeExpansion: 0.1
  });
  const decision = buildCapitalOilDemoDecision({
    bars,
    signal,
    epic: "OIL_CRUDE",
    openOilPositions: [],
    size: 10,
    strategyOptions: {
      stopAtrMultiple: 1.8,
      targetRR: 2.2
    }
  });

  assert.equal(decision.action, "OPEN");
  assert.equal(decision.order.epic, "OIL_CRUDE");
  assert.equal(decision.order.direction, "BUY");
  assert.equal(decision.order.size, 10);
  assert.equal(decision.order.profitDistance, Number((decision.order.stopDistance * 2.2).toFixed(2)));
});

test("buildCapitalOilDemoDecision blocks fresh entries when frequency guard is active", () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeOilBar(index));
  const signal = buildOilMomentumSignal({
    bars,
    minVolumeExpansion: 0.1
  });
  const decision = buildCapitalOilDemoDecision({
    bars,
    signal,
    epic: "OIL_CRUDE",
    openOilPositions: [],
    size: 10,
    frequencyGuard: {
      status: "ENTRY_COOLDOWN",
      blocksEntries: true,
      reason: "entry cooldown active"
    }
  });

  assert.equal(decision.action, "HOLD");
  assert.match(decision.reason, /ENTRY_COOLDOWN/);
});

test("runCapitalOilDemoLoop ignores open Gold positions and plans oil independently", async () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeOilBar(index));
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
      return {
        positions: [{
          market: { epic: "GOLD" },
          position: {
            dealId: "gold-deal",
            direction: "SELL",
            size: 0.3,
            level: 4013,
            upl: 12
          }
        }]
      };
    }
  };

  const loop = await runCapitalOilDemoLoop({
    client,
    bars,
    maxOpenPositions: 1,
    submitOrders: false,
    stateFile: false,
    strategyOptions: {
      minVolumeExpansion: 0.1
    },
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(loop.openOilPositions.length, 0);
  assert.equal(loop.entryDecisions.length, 1);
  assert.equal(loop.entryDecisions[0].order.epic, "OIL_CRUDE");
  assert.match(formatCapitalOilDemoLoop(loop), /Capital\.com Oil Demo Loop/);
});

test("runCapitalOilDemoLoop closes Oil positions when the daily max loss guard is hit", async () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeOilBar(index));
  const calls = [];
  const client = {
    environment: "demo",
    async getAccounts() {
      return {
        accounts: [{
          currency: "USD",
          balance: {
            balance: 940,
            available: 940
          }
        }]
      };
    },
    async getPositions() {
      return {
        positions: [{
          market: { epic: "OIL_CRUDE" },
          position: {
            dealId: "oil-loss",
            direction: "BUY",
            size: 10,
            level: 70,
            upl: 0
          }
        }]
      };
    },
    async closePosition(dealId) {
      calls.push(["closePosition", dealId]);
      return { dealReference: "oil-close-ref" };
    },
    async getConfirm(dealReference) {
      calls.push(["getConfirm", dealReference]);
      return {
        dealReference,
        dealStatus: "ACCEPTED"
      };
    }
  };

  const loop = await runCapitalOilDemoLoop({
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
    ["closePosition", "oil-loss"],
    ["getConfirm", "oil-close-ref"]
  ]);
});

test("buildInventoryBlackoutGuard blocks new Oil entries around Wednesday inventory time", () => {
  const guard = buildInventoryBlackoutGuard({
    now: new Date("2026-07-01T14:30:00Z")
  });

  assert.equal(guard.status, "INVENTORY_BLACKOUT");
  assert.equal(guard.blocksEntries, true);
});

test("buildOilProfitTargetAdjustments extends target and moves stop only into protection", () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeOilBar(index));
  const adjustments = buildOilProfitTargetAdjustments({
    bars,
    openOilPositions: [{
      epic: "OIL_CRUDE",
      dealId: "oil-buy",
      direction: "BUY",
      size: 10,
      level: 70,
      stopLevel: 69.1,
      profitLevel: 70.9,
      upl: 2
    }],
    minProfitToExtendDollars: 0.75,
    breakevenBufferDistance: 0.03
  });

  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].dealId, "oil-buy");
  assert.ok(adjustments[0].profitLevel > 70.95);
  assert.equal(adjustments[0].stopLevel, 70.03);
});

function makeOilBar(index) {
  const close = index === 89 ? 75 : 70 + index * 0.04;
  return {
    time: new Date(Date.UTC(2026, 0, 1, 10, index)).toISOString(),
    symbol: "WTI/USD",
    assetClass: "oil",
    venue: "capital-demo",
    open: close - 0.03,
    high: close + 0.06,
    low: close - 0.06,
    close,
    volume: index === 89 ? 200 : 100,
    bid: close - 0.02,
    ask: close + 0.02
  };
}
