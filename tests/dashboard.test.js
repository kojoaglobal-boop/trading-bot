import test from "node:test";
import assert from "node:assert/strict";
import { formatDashboardSnapshot, loadDashboardSnapshot } from "../src/core/dashboard.js";

test("loadDashboardSnapshot maps trading database state into one dashboard view", async () => {
  const queries = [];
  const pool = fakePool({
    query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM account_snapshots")) {
        return {
          rows: [{
            source: "alpaca-paper",
            snapshot_time: new Date("2026-01-01T12:00:00Z"),
            cash: "500",
            buying_power: "500",
            equity: "505",
            daily_pnl: "5"
          }]
        };
      }

      if (sql.includes("FROM bot_runs")) {
        return {
          rows: [{
            run_id: "run-1",
            mode: "alpaca-paper",
            strategy: "momentum-breakout",
            started_at: "2026-01-01T12:00:00Z",
            ending_equity: "505",
            metadata: {
              summary: {
                signals: 2,
                orders: 1
              }
            }
          }]
        };
      }

      if (sql.includes("FROM strategy_signals")) {
        return {
          rows: [{
            run_id: "run-1",
            signal_time: "2026-01-01T12:00:00Z",
            symbol: "AAPL",
            asset_class: "stock",
            action: "BUY",
            confidence: "0.8",
            reason: "breakout"
          }]
        };
      }

      if (sql.includes("FROM risk_decisions")) {
        return {
          rows: [{
            run_id: "run-1",
            decision_time: "2026-01-01T12:00:00Z",
            symbol: "AAPL",
            requested_action: "BUY",
            approved: true,
            reason: "approved"
          }]
        };
      }

      if (sql.includes("FROM broker_orders")) {
        return {
          rows: [{
            run_id: "run-1",
            broker: "alpaca-paper",
            symbol: "AAPL",
            asset_class: "stock",
            side: "buy",
            order_type: "market",
            qty: null,
            notional: "100",
            filled_qty: null,
            filled_avg_price: null,
            status: "accepted",
            submitted_at: "2026-01-01T12:00:01Z",
            updated_at: "2026-01-01T12:00:02Z"
          }]
        };
      }

      if (sql.includes("FROM fills")) {
        return {
          rows: [{
            broker_fill_id: "fill-1",
            fill_time: "2026-01-01T12:00:03Z",
            symbol: "AAPL",
            side: "buy",
            qty: "1",
            price: "100",
            commission: "0"
          }]
        };
      }

      if (sql.includes("FROM account_positions")) {
        return {
          rows: [{
            source: "alpaca-paper",
            snapshot_time: "2026-01-01T12:00:00Z",
            symbol: "AAPL",
            asset_class: "stock",
            qty: "1",
            avg_entry_price: "100",
            market_value: "101",
            unrealized_pl: "1"
          }]
        };
      }

      if (sql.includes("FROM market_bars")) {
        return {
          rows: [{
            source: "oanda",
            mode: "practice-market-data",
            symbol: "XAU/USD",
            asset_class: "gold",
            bars: "120",
            latest_bar_time: "2026-01-01T11:00:00Z"
          }]
        };
      }

      if (sql.includes("FROM data_quality_checks")) {
        return {
          rows: [{
            check_time: "2026-01-01T12:00:00Z",
            symbol: "BTC/USD",
            primary_source: "coinbase",
            secondary_source: "kraken",
            close_diff_bps: "3.1",
            status: "PASS",
            reasons: []
          }]
        };
      }

      return { rows: [] };
    }
  });

  const snapshot = await loadDashboardSnapshot({
    pool,
    limit: 5,
    now: new Date("2026-01-01T12:05:00Z"),
    env: {
      ALPACA_API_KEY_ID: "key",
      ALPACA_API_SECRET_KEY: "secret"
    },
    getSources: (env) => [
      {
        id: "alpaca",
        configured: Boolean(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY),
        missingEnv: []
      },
      {
        id: "oanda",
        configured: false,
        missingEnv: ["OANDA_ACCOUNT_ID", "OANDA_API_TOKEN"]
      }
    ]
  });

  assert.equal(snapshot.account.equity, 505);
  assert.equal(snapshot.summary.actionableSignals, 1);
  assert.equal(snapshot.summary.approvedRiskDecisions, 1);
  assert.equal(snapshot.summary.openOrders, 1);
  assert.equal(snapshot.marketData[0].symbol, "XAU/USD");
  assert.equal(snapshot.sources.length, 2);
  assert.equal(queries.every((query) => query.params.length === 0 || query.params[0] === 5), true);
  assert.match(formatDashboardSnapshot(snapshot), /Trading Bot Dashboard/);
  assert.match(formatDashboardSnapshot(snapshot), /Sources Missing Keys/);
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
