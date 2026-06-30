import test from "node:test";
import assert from "node:assert/strict";
import { GoldPullbackStrategy } from "../src/strategies/gold-pullback.js";

test("GoldPullbackStrategy stores entry index for reliable time exits", () => {
  const strategy = new GoldPullbackStrategy({
    maxHoldBars: 1,
    stopAtrMultiple: 2,
    takeProfitRR: 2
  });
  const bars = [
    makeGoldBar("2026-01-01T10:00:00Z", 4000),
    makeGoldBar("2026-01-01T10:05:00Z", 4002),
    makeGoldBar("2026-01-01T10:10:00Z", 4004)
  ];

  strategy.history.set("XAU/USD", bars.slice(0, 2));
  const signal = strategy.entrySignal({
    action: "BUY",
    bar: bars[1],
    atr: 5,
    reason: "test pullback"
  });

  assert.equal(signal.action, "BUY");
  assert.equal(strategy.entries.get("XAU/USD").entryIndex, 1);

  const exit = strategy.managePosition({
    bar: bars[2],
    history: bars,
    position: {
      symbol: "XAU/USD",
      assetClass: "gold",
      side: "long",
      quantity: 0.1,
      avgPrice: 4002
    },
    atr: 5
  });

  assert.equal(exit.action, "SELL");
  assert.match(exit.reason, /time exit/);
  assert.doesNotMatch(exit.reason, /NaN/);
});

function makeGoldBar(time, close) {
  return {
    time,
    symbol: "XAU/USD",
    assetClass: "gold",
    venue: "gold-test",
    open: close - 1,
    high: close + 4,
    low: close - 4,
    close,
    volume: 100,
    bid: close - 0.2,
    ask: close + 0.2
  };
}
