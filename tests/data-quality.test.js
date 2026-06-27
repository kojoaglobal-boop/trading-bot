import test from "node:test";
import assert from "node:assert/strict";
import {
  compareLatestBars,
  formatDataQualityCheck,
  writeDataQualityCheck
} from "../src/core/data-quality.js";

test("compareLatestBars passes when sources agree", () => {
  const now = new Date("2026-01-01T01:00:00Z");
  const check = compareLatestBars({
    symbol: "BTC/USD",
    primaryBars: [bar({ close: 100, time: "2026-01-01T00:00:00Z" })],
    secondaryBars: [bar({ close: 100.1, time: "2026-01-01T00:00:00Z" })],
    now
  });

  assert.equal(check.status, "pass");
  assert.equal(check.reasons.length, 0);
  assert.match(formatDataQualityCheck(check), /PASS/);
});

test("compareLatestBars warns when close difference is elevated but not failed", () => {
  const check = compareLatestBars({
    symbol: "BTC/USD",
    primaryBars: [bar({ close: 100 })],
    secondaryBars: [bar({ close: 100.2 })],
    now: new Date("2026-01-01T01:00:00Z"),
    warnCloseDiffBps: 10,
    maxCloseDiffBps: 35
  });

  assert.equal(check.status, "warn");
  assert.match(check.reasons[0], /warning/);
});

test("compareLatestBars fails on missing, stale, or divergent data", () => {
  const missing = compareLatestBars({
    symbol: "BTC/USD",
    primaryBars: [],
    secondaryBars: [bar({ close: 100 })]
  });
  const stale = compareLatestBars({
    symbol: "BTC/USD",
    primaryBars: [bar({ close: 100, time: "2026-01-01T00:00:00Z" })],
    secondaryBars: [bar({ close: 100, time: "2026-01-01T00:00:00Z" })],
    now: new Date("2026-01-02T00:00:00Z"),
    maxStaleSeconds: 60
  });
  const divergent = compareLatestBars({
    symbol: "BTC/USD",
    primaryBars: [bar({ close: 100 })],
    secondaryBars: [bar({ close: 101 })],
    now: new Date("2026-01-01T01:00:00Z"),
    maxCloseDiffBps: 35
  });

  assert.equal(missing.status, "fail");
  assert.equal(stale.status, "fail");
  assert.equal(divergent.status, "fail");
});

test("writeDataQualityCheck stores check result", async () => {
  const queries = [];
  const pool = {
    async connect() {
      return {
        query(sql, params = []) {
          queries.push({ sql, params });
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  const check = compareLatestBars({
    symbol: "BTC/USD",
    primaryBars: [bar({ close: 100 })],
    secondaryBars: [bar({ close: 100.1 })],
    now: new Date("2026-01-01T01:00:00Z")
  });

  const result = await writeDataQualityCheck(check, { pool });

  assert.equal(result.symbol, "BTC/USD");
  assert.equal(result.status, "pass");
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO data_quality_checks")), true);
});

function bar({ close, time = "2026-01-01T00:00:00Z" }) {
  return {
    time,
    symbol: "BTC/USD",
    assetClass: "meme",
    close
  };
}
