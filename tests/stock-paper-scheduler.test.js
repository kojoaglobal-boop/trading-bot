import test from "node:test";
import assert from "node:assert/strict";
import { formatStockPaperCycle, runStockPaperCycle } from "../src/core/stock-paper-scheduler.js";

test("runStockPaperCycle runs paper loop, broker sync, database writes, and ledger export", async () => {
  const calls = [];
  const now = new Date("2026-01-01T12:00:00Z");

  const cycle = await runStockPaperCycle({
    client: { name: "fake-alpaca" },
    symbols: ["aapl", "tsla"],
    submitOrders: true,
    maxBuyNotional: 100,
    targetRewardRiskRatio: 2.5,
    now,
    preflightDatabase: async () => {
      calls.push("preflight");
      return { ok: true, checkedAt: now.toISOString() };
    },
    loadDailyStartEquity: async () => {
      calls.push("daily-start");
      return { equity: 500, snapshotTime: now.toISOString() };
    },
    runPaperLoop: async (options) => {
      calls.push("paper-loop");
      assert.deepEqual(options.symbols, ["AAPL", "TSLA"]);
      assert.equal(options.submitOrders, true);
      assert.equal(options.maxBuyNotional, 100);
      assert.equal(options.dailyStartEquity, 500);
      return {
        runId: "paper-1",
        summary: {
          signals: 2,
          actionableSignals: 1,
          approvedRiskDecisions: 1,
          rejectedRiskDecisions: 0,
          orders: 1,
          submittedOrders: 1
        }
      };
    },
    writePaperRun: async (run) => {
      calls.push("paper-db");
      assert.equal(run.runId, "paper-1");
      return {
        runId: "paper-1",
        signals: 2,
        riskDecisions: 1,
        orders: 1
      };
    },
    syncPaperState: async (options) => {
      calls.push("sync");
      assert.equal(options.status, "all");
      return {
        runId: "sync-1",
        summary: {
          positions: 1,
          orders: 3,
          fills: 1
        }
      };
    },
    writeSync: async (sync) => {
      calls.push("sync-db");
      assert.equal(sync.runId, "sync-1");
      return {
        runId: "sync-1",
        positions: 1,
        orders: 3,
        fills: 1
      };
    },
    exportPaperLedgerFn: async (options) => {
      calls.push("export");
      assert.equal(options.outDir, "reports/paper-ledger");
      return {
        outDir: options.outDir,
        files: [
          { name: "paper_runs", rows: 2, filePath: "reports/paper-ledger/paper_runs.csv" },
          { name: "paper_orders", rows: 3, filePath: "reports/paper-ledger/paper_orders.csv" }
        ]
      };
    }
  });

  assert.deepEqual(calls, ["preflight", "daily-start", "paper-loop", "paper-db", "sync", "sync-db", "export"]);
  assert.equal(cycle.submitted, true);
  assert.equal(cycle.summary.signals, 2);
  assert.equal(cycle.summary.submittedOrders, 1);
  assert.equal(cycle.summary.positions, 1);
  assert.equal(cycle.summary.fills, 1);
  assert.equal(cycle.summary.exportFiles, 2);
  assert.match(formatStockPaperCycle(cycle), /Stock Paper Scheduler Cycle/);
  assert.match(formatStockPaperCycle(cycle), /Paper DB:/);
  assert.match(formatStockPaperCycle(cycle), /Day start:\s+\$500.00/);
});

test("runStockPaperCycle can run in decision-only mode without database or export", async () => {
  const cycle = await runStockPaperCycle({
    symbols: "aapl",
    submitOrders: false,
    writeDatabase: false,
    exportLedger: false,
    now: new Date("2026-01-01T12:00:00Z"),
    runPaperLoop: async (options) => {
      assert.equal(options.submitOrders, false);
      return {
        runId: "paper-2",
        summary: {
          signals: 1,
          actionableSignals: 0,
          approvedRiskDecisions: 0,
          rejectedRiskDecisions: 0,
          orders: 0,
          submittedOrders: 0
        }
      };
    },
    syncPaperState: async () => ({
      runId: "sync-2",
      summary: {
        positions: 0,
        orders: 0,
        fills: 0
      }
    })
  });

  assert.equal(cycle.writeDatabase, false);
  assert.equal(cycle.exportLedger, false);
  assert.equal(cycle.steps.database, undefined);
  assert.equal(cycle.steps.paperLoop.database, null);
  assert.equal(cycle.steps.export.result, null);
});

test("runStockPaperCycle applies scalp profile defaults", async () => {
  const cycle = await runStockPaperCycle({
    profile: "scalp",
    symbols: "tsla",
    submitOrders: false,
    writeDatabase: false,
    exportLedger: false,
    now: new Date("2026-01-01T12:00:00Z"),
    runPaperLoop: async (options) => {
      assert.equal(options.profile, "scalp");
      assert.equal(options.timeframe, "5Min");
      assert.equal(options.bars, 120);
      assert.equal(options.lookbackDays, 5);
      assert.equal(options.maxBuyNotional, 100);
      assert.equal(options.targetRewardRiskRatio, 1.3);
      return {
        runId: "paper-scalp",
        summary: {
          signals: 1,
          actionableSignals: 0,
          approvedRiskDecisions: 0,
          rejectedRiskDecisions: 0,
          orders: 0,
          submittedOrders: 0
        }
      };
    },
    syncPaperState: async () => ({
      runId: "sync-scalp",
      summary: {
        positions: 0,
        orders: 0,
        fills: 0
      }
    })
  });

  assert.equal(cycle.profile, "scalp");
  assert.equal(cycle.timeframe, "5Min");
  assert.match(formatStockPaperCycle(cycle), /Profile:\s+scalp/);
});
