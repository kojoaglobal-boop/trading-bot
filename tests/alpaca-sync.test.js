import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAlpacaSync,
  syncAlpacaPaperState,
  writeAlpacaSyncToDatabase
} from "../src/core/alpaca-sync.js";

test("syncAlpacaPaperState gathers account, positions, orders, and fill activities", async () => {
  const client = {
    async getAccount() {
      return {
        id: "acct-1",
        status: "ACTIVE",
        cash: "500",
        buying_power: "500",
        portfolio_value: "505"
      };
    },
    async getPositions() {
      return [{
        symbol: "AAPL",
        asset_class: "us_equity",
        qty: "1",
        avg_entry_price: "100",
        market_value: "101",
        unrealized_pl: "1"
      }];
    },
    async listOrders(options) {
      assert.equal(options.status, "all");
      return [{
        id: "order-1",
        client_order_id: "client-1",
        symbol: "AAPL",
        asset_class: "us_equity",
        side: "buy",
        type: "market",
        status: "filled",
        qty: "1",
        filled_qty: "1",
        filled_avg_price: "100",
        submitted_at: "2026-01-01T00:00:00Z"
      }];
    },
    async getAccountActivities(options) {
      assert.equal(options.activityType, "FILL");
      return [{
        id: "fill-1",
        order_id: "order-1",
        symbol: "AAPL",
        side: "buy",
        qty: "1",
        price: "100",
        transaction_time: "2026-01-01T00:00:01Z"
      }];
    }
  };

  const sync = await syncAlpacaPaperState({
    client,
    now: new Date("2026-01-02T00:00:00Z")
  });

  assert.equal(sync.account.portfolioValue, 505);
  assert.equal(sync.positions.length, 1);
  assert.equal(sync.orders[0].assetClass, "stock");
  assert.equal(sync.fills[0].id, "fill-1");
  assert.match(formatAlpacaSync(sync), /Alpaca Paper Sync/);
});

test("writeAlpacaSyncToDatabase stores broker sync state transactionally", async () => {
  const queries = [];
  const pool = {
    async connect() {
      return {
        query(sql, params = []) {
          queries.push({ sql, params });
          if (sql.includes("SELECT id FROM broker_orders")) {
            return { rows: [{ id: 42 }] };
          }
          return { rows: [] };
        },
        release() {}
      };
    }
  };

  const result = await writeAlpacaSyncToDatabase({
    runId: "sync-1",
    createdAt: "2026-01-02T00:00:00Z",
    status: "all",
    limit: 100,
    activityDays: 7,
    account: {
      cash: 500,
      buyingPower: 500,
      portfolioValue: 505
    },
    positions: [{
      symbol: "AAPL",
      assetClass: "stock",
      qty: 1,
      avgEntryPrice: 100,
      marketValue: 101,
      unrealizedPl: 1
    }],
    orders: [{
      id: "order-1",
      clientOrderId: "client-1",
      symbol: "AAPL",
      assetClass: "stock",
      side: "buy",
      type: "market",
      status: "filled",
      filledQty: 1,
      filledAvgPrice: 100,
      submittedAt: "2026-01-01T00:00:00Z"
    }],
    fills: [{
      id: "fill-1",
      orderId: "order-1",
      symbol: "AAPL",
      side: "buy",
      qty: 1,
      price: 100,
      transactionTime: "2026-01-01T00:00:01Z"
    }],
    summary: {
      positions: 1,
      orders: 1,
      fills: 1
    }
  }, { pool });

  assert.deepEqual(result, {
    runId: "sync-1",
    positions: 1,
    orders: 1,
    fills: 1
  });
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO account_positions")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO broker_orders")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO fills")), true);
});
