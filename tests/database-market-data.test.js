import test from "node:test";
import assert from "node:assert/strict";
import { loadRecentMarketBars, upsertMarketBars } from "../src/core/database-market-data.js";

test("upsertMarketBars writes normalized bars transactionally", async () => {
  const queries = [];
  const pool = fakePool({
    query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  });

  const result = await upsertMarketBars([{
    time: "2026-01-01T00:00:00.000Z",
    symbol: "BTC/USD",
    assetClass: "meme",
    venue: "coinbase-spot",
    open: 100,
    high: 110,
    low: 99,
    close: 109,
    volume: 42,
    source: {
      provider: "coinbase",
      mode: "public-market-data"
    }
  }], { pool });

  assert.equal(result.bars, 1);
  assert.deepEqual(result.symbols, ["BTC/USD"]);
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO market_bars")), true);
});

test("loadRecentMarketBars maps rows back to bars", async () => {
  const pool = fakePool({
    query() {
      return {
        rows: [{
          source: "coinbase",
          mode: "public-market-data",
          symbol: "BTC/USD",
          asset_class: "meme",
          venue: "coinbase-spot",
          bar_time: new Date("2026-01-01T00:00:00.000Z"),
          open: "100",
          high: "110",
          low: "99",
          close: "109",
          volume: "42",
          bid: null,
          ask: null
        }]
      };
    }
  });

  const bars = await loadRecentMarketBars({
    source: "coinbase",
    mode: "public-market-data",
    symbols: ["BTC/USD"],
    pool
  });

  assert.equal(bars.length, 1);
  assert.equal(bars[0].close, 109);
  assert.equal(bars[0].source.provider, "coinbase");
});

function fakePool(client) {
  return {
    async connect() {
      return {
        query: client.query,
        release() {}
      };
    }
  };
}
