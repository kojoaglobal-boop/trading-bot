import test from "node:test";
import assert from "node:assert/strict";
import { loadDatabaseJournal, writeAuditToDatabase } from "../src/core/database-journal.js";

test("writeAuditToDatabase saves run, fills, and rejections inside a transaction", async () => {
  const queries = [];
  const pool = fakePool({
    query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("RETURNING id")) {
        return { rows: [{ id: 101 }] };
      }
      return { rows: [] };
    }
  });

  const result = await writeAuditToDatabase({
    runId: "run-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    mode: "paper",
    account: {
      startingCash: 500,
      finalEquity: 512
    },
    metrics: {
      maxDrawdownPct: 0.01,
      winRate: 0.6,
      profitFactor: 1.8
    },
    sources: [{ provider: "sample-generator", mode: "simulation" }],
    fills: [{
      id: "fill-1",
      time: "2026-01-01T00:01:00.000Z",
      symbol: "AAPL",
      assetClass: "stock",
      side: "BUY",
      quantity: 1,
      price: 100,
      notional: 100,
      commission: 0
    }],
    rejections: [{
      time: "2026-01-01T00:02:00.000Z",
      symbol: "TSLA",
      action: "BUY",
      reason: "spread too wide"
    }]
  }, { pool });

  assert.deepEqual(result, {
    runId: "run-1",
    fills: 1,
    rejections: 1
  });
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO bot_runs")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO broker_orders")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO fills")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO risk_decisions")), true);
});

test("loadDatabaseJournal maps run rows to journal log shape", async () => {
  const pool = fakePool({
    query() {
      return {
        rows: [{
          run_id: "run-1",
          mode: "paper",
          started_at: new Date("2026-01-01T00:00:00.000Z"),
          starting_cash: "500",
          ending_equity: "512",
          max_drawdown_pct: "0.01",
          win_rate_pct: "0.6",
          profit_factor: "1.8",
          metadata: {
            account: { netPnl: 12, returnPct: 0.024 },
            metrics: { closedTrades: 2 },
            sources: [{ provider: "sample-generator", mode: "simulation" }]
          }
        }]
      };
    }
  });

  const logs = await loadDatabaseJournal({ pool });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].runId, "run-1");
  assert.equal(logs[0].account.finalEquity, 512);
  assert.equal(logs[0].metrics.winRate, 0.6);
  assert.deepEqual(logs[0].sources, [{ provider: "sample-generator", mode: "simulation" }]);
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
