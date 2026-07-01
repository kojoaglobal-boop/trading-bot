import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCapitalIndexDemoLoop,
  getIndexMarketConfig,
  runCapitalIndexDemoLoop
} from "../src/core/capital-index-demo-loop.js";

test("getIndexMarketConfig resolves common index aliases", () => {
  assert.equal(getIndexMarketConfig("rty").key, "us2000");
  assert.equal(getIndexMarketConfig("dax").epic, "DE40");
  assert.equal(getIndexMarketConfig("nasdaq100").symbol, "NAS100");
  assert.equal(getIndexMarketConfig("dow").epic, "US30");
});

test("runCapitalIndexDemoLoop plans an index order independently", async () => {
  const bars = Array.from({ length: 90 }, (_value, index) => makeIndexBar(index));
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
            direction: "BUY",
            size: 1,
            level: 4010,
            upl: 25
          }
        }]
      };
    }
  };

  const loop = await runCapitalIndexDemoLoop({
    client,
    market: "us2000",
    bars,
    maxOpenPositions: 1,
    submitOrders: false,
    stateFile: false,
    strategyOptions: {
      minVolumeExpansion: 0.1
    },
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(loop.indexLabel, "US2000");
  assert.equal(loop.openIndexPositions.length, 0);
  assert.equal(loop.entryDecisions.length, 1);
  assert.equal(loop.entryDecisions[0].order.epic, "RTY");
  assert.equal(loop.entryDecisions[0].order.size, 0.1);
  assert.match(formatCapitalIndexDemoLoop(loop), /Capital\.com US2000 Index Demo Loop/);
});

function makeIndexBar(index) {
  const close = index === 89 ? 3050 : 3000 + index * 0.25;
  return {
    time: new Date(Date.UTC(2026, 0, 1, 10, index)).toISOString(),
    symbol: "US2000",
    assetClass: "future",
    venue: "capital-demo",
    open: close - 0.2,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: index === 89 ? 200 : 100,
    bid: close - 0.25,
    ask: close + 0.25
  };
}
