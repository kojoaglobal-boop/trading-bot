import test from "node:test";
import assert from "node:assert/strict";
import {
  rankStockCandidates,
  scoreNewsCatalysts,
  selectStockUniverse
} from "../src/core/stock-universe-selector.js";

test("rankStockCandidates prefers liquid momentum with catalyst support", () => {
  const barsBySymbol = new Map([
    ["SLOW", createBars("SLOW", { start: 100, step: 0.01, volume: 100000 })],
    ["FAST", createBars("FAST", { start: 100, step: 1.2, volume: 400000, lastVolume: 1200000 })]
  ]);
  const newsBySymbol = new Map([
    ["FAST", [{
      headline: "FAST jumps after earnings beat and raised guidance",
      summary: ""
    }]]
  ]);

  const ranked = rankStockCandidates({
    symbols: ["SLOW", "FAST"],
    barsBySymbol,
    newsBySymbol,
    selection: {
      minBars: 25
    }
  });

  assert.equal(ranked[0].symbol, "FAST");
  assert.equal(ranked[0].catalyst.positive, 1);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("selectStockUniverse scans broad symbols but returns a controlled shortlist", async () => {
  const barsBySymbol = new Map([
    ["AAA", createBars("AAA", { start: 100, step: 0.05, volume: 100000 })],
    ["BBB", createBars("BBB", { start: 100, step: 1.4, volume: 500000, lastVolume: 1300000 })],
    ["CCC", createBars("CCC", { start: 100, step: 0.8, volume: 300000, lastVolume: 900000 })]
  ]);
  const newsCalls = [];
  const newsClient = {
    async getCompanyNews({ symbol }) {
      newsCalls.push(symbol);
      return symbol === "BBB"
        ? [{ headline: "BBB surges after new contract", summary: "" }]
        : [];
    }
  };

  const selection = await selectStockUniverse({
    symbols: ["AAA", "BBB", "CCC"],
    barsBySymbol,
    openPositionSymbols: ["OPEN"],
    newsClient,
    selection: {
      maxSelectedSymbols: 2,
      maxCatalystSymbols: 2,
      minBars: 25
    },
    now: new Date("2026-01-31T12:00:00Z")
  });

  assert.equal(selection.scannedSymbols.length, 3);
  assert.equal(selection.selectedSymbols.length, 2);
  assert.equal(selection.selectedSymbols[0], "BBB");
  assert.deepEqual(selection.strategySymbols, ["OPEN", "BBB", "CCC"]);
  assert.deepEqual(newsCalls, ["BBB", "CCC"]);
});

test("scoreNewsCatalysts penalizes clearly negative headlines", () => {
  const score = scoreNewsCatalysts([
    { headline: "Company downgraded after investigation", summary: "" },
    { headline: "Company announces partnership", summary: "" }
  ]);

  assert.equal(score.positive, 1);
  assert.equal(score.negative, 1);
  assert.equal(score.score, 0);
});

function createBars(symbol, {
  start,
  step,
  volume,
  lastVolume = volume
}) {
  return Array.from({ length: 30 }, (_value, index) => {
    const close = start + step * index;
    return {
      time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      symbol,
      assetClass: "stock",
      open: close - 0.2,
      high: close + 0.4,
      low: close - 0.4,
      close,
      volume: index === 29 ? lastVolume : volume,
      bid: close,
      ask: close
    };
  });
}
