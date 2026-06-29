import test from "node:test";
import assert from "node:assert/strict";
import { writeAlpacaPaperRunToDatabase } from "../src/core/database-live.js";

test("writeAlpacaPaperRunToDatabase stores run, account, signals, risk, and orders", async () => {
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

  const result = await writeAlpacaPaperRunToDatabase({
    runId: "run-1",
    createdAt: "2026-01-01T12:00:00Z",
    profile: "scalp",
    symbols: ["TSLA"],
    timeframe: "1Hour",
    feed: "iex",
    barsProcessed: 30,
    submitted: true,
    account: {
      cash: 500,
      buyingPower: 500,
      portfolioValue: 500
    },
    signals: [{
      time: "2026-01-01T12:00:00Z",
      symbol: "TSLA",
      assetClass: "stock",
      action: "BUY",
      confidence: 0.8,
      reason: "test",
      features: {}
    }],
    riskDecisions: [{
      time: "2026-01-01T12:00:00Z",
      symbol: "TSLA",
      action: "BUY",
      approved: true,
      reason: "approved"
    }],
    orders: [{
      status: "accepted",
      assetClass: "stock",
      request: {
        symbol: "TSLA",
        side: "buy",
        type: "market",
        time_in_force: "day",
        notional: "5.00"
      },
      submitted: {
        id: "order-1",
        symbol: "TSLA",
        side: "buy",
        type: "market",
        status: "accepted",
        notional: "5.00"
      }
    }],
    summary: {
      signals: 1
    }
  }, { pool });

  assert.deepEqual(result, {
    runId: "run-1",
    signals: 1,
    riskDecisions: 1,
    orders: 1
  });
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO account_snapshots")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO strategy_signals")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO broker_orders")), true);
  const runInsert = queries.find((query) => query.sql.includes("INSERT INTO bot_runs"));
  const metadata = JSON.parse(runInsert.params[4]);
  assert.equal(metadata.profile, "scalp");
});
