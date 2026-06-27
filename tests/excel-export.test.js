import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { exportPaperLedger, formatPaperLedgerExport, toCsv } from "../src/core/excel-export.js";

test("toCsv escapes values Excel can open", () => {
  const csv = toCsv(["symbol", "reason"], [{
    symbol: "AAPL",
    reason: "breakout, volume \"confirmed\""
  }]);

  assert.equal(csv, "symbol,reason\nAAPL,\"breakout, volume \"\"confirmed\"\"\"\n");
});

test("exportPaperLedger writes one CSV per paper-tracking table", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "trading-bot-ledger-"));
  const queries = [];
  const pool = fakePool({
    query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM bot_runs")) {
        return {
          rows: [{
            run_id: "run-1",
            mode: "alpaca-paper",
            strategy: "momentum-breakout",
            started_at: new Date("2026-01-01T00:00:00Z"),
            ending_equity: "500",
            signals: "2",
            actionable_signals: "0",
            risk_approved: "0",
            risk_rejected: "0",
            orders: "0",
            submitted_orders: "0"
          }]
        };
      }
      return { rows: [] };
    }
  });

  try {
    const result = await exportPaperLedger({
      outDir: tempDir,
      limit: 100,
      pool
    });
    const runsCsv = await readFile(path.join(tempDir, "paper_runs.csv"), "utf8");

    assert.equal(result.files.length, 6);
    assert.equal(result.files[0].rows, 1);
    assert.equal(queries.every((query) => query.params[0] === 100), true);
    assert.match(runsCsv, /run-1/);
    assert.match(formatPaperLedgerExport(result), /paper_runs/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
