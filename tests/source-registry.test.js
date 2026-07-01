import test from "node:test";
import assert from "node:assert/strict";
import { sourceCatalog } from "../src/config/sources.js";
import { getSourceStatuses, summarizeBarSources } from "../src/core/source-registry.js";

test("source statuses report missing required environment variables", () => {
  const statuses = getSourceStatuses({}, [
    {
      id: "demo",
      label: "Demo",
      kind: "market-data",
      mode: "paper",
      covers: ["stock"],
      requiredEnv: ["DEMO_KEY"],
      cost: "free",
      purpose: "test"
    }
  ]);

  assert.equal(statuses[0].configured, false);
  assert.deepEqual(statuses[0].missingEnv, ["DEMO_KEY"]);
});

test("bar source summary groups bars by provider and mode", () => {
  const summary = summarizeBarSources([
    {
      time: "2025-01-01T00:00:00.000Z",
      symbol: "BTC/USD",
      assetClass: "meme",
      venue: "crypto-paper",
      close: 1,
      source: {
        provider: "sample-generator",
        mode: "simulation"
      }
    },
    {
      time: "2025-01-01T01:00:00.000Z",
      symbol: "ETH/USD",
      assetClass: "meme",
      venue: "crypto-paper",
      close: 2,
      source: {
        provider: "sample-generator",
        mode: "simulation"
      }
    }
  ]);

  assert.equal(summary.length, 1);
  assert.equal(summary[0].bars, 2);
  assert.deepEqual(summary[0].symbols, ["BTC/USD", "ETH/USD"]);
});

test("source catalog includes Finnhub as a stock catalyst source", () => {
  const finnhub = sourceCatalog.find((source) => source.id === "finnhub");

  assert.equal(finnhub.kind, "market-data");
  assert.equal(finnhub.mode, "news-and-catalysts");
  assert.deepEqual(finnhub.requiredEnv, ["FINNHUB_API_KEY"]);
  assert.deepEqual(finnhub.covers, ["stock", "gold", "oil", "forex", "meme"]);
});

test("source catalog includes EIA as an oil catalyst source", () => {
  const eia = sourceCatalog.find((source) => source.id === "eia");

  assert.equal(eia.kind, "market-data");
  assert.equal(eia.mode, "official-energy-news-and-data");
  assert.deepEqual(eia.requiredEnv, ["EIA_API_KEY"]);
  assert.deepEqual(eia.covers, ["oil"]);
});

test("source catalog includes FRED as a macro catalyst source", () => {
  const fred = sourceCatalog.find((source) => source.id === "fred");

  assert.equal(fred.kind, "market-data");
  assert.equal(fred.mode, "official-macro-data");
  assert.deepEqual(fred.requiredEnv, ["FRED_API_KEY"]);
  assert.deepEqual(fred.covers, ["stock", "gold", "oil", "forex", "future"]);
});

test("source catalog includes Capital.com as a gold, oil, and forex source", () => {
  const capital = sourceCatalog.find((source) => source.id === "capital");

  assert.equal(capital.kind, "broker-and-data");
  assert.equal(capital.mode, "demo-or-live");
  assert.deepEqual(capital.requiredEnv, ["CAPITAL_IDENTIFIER", "CAPITAL_API_KEY", "CAPITAL_PASSWORD"]);
  assert.deepEqual(capital.covers, ["gold", "oil", "forex"]);
});
