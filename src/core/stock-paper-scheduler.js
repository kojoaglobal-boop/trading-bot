import { defaultConfig } from "../config/default.js";
import { AlpacaClient } from "../integrations/alpaca-client.js";
import { runAlpacaPaperLoop } from "./alpaca-paper-loop.js";
import { syncAlpacaPaperState, writeAlpacaSyncToDatabase } from "./alpaca-sync.js";
import { createDatabasePool, withDatabaseClient } from "./database-client.js";
import { writeAlpacaPaperRunToDatabase } from "./database-live.js";
import { exportPaperLedger } from "./excel-export.js";

export async function runStockPaperCycle(options = {}) {
  const {
    client = new AlpacaClient(),
    symbols = ["TSLA", "AAPL"],
    timeframe = "1Hour",
    bars = 80,
    feed = "iex",
    lookbackDays = 30,
    submitOrders = false,
    maxBuyNotional = defaultConfig.paperTraining.maxBuyNotional,
    targetRewardRiskRatio = defaultConfig.paperTraining.targetRewardRiskRatio,
    writeDatabase = true,
    exportLedger = true,
    exportOutDir = "reports/paper-ledger",
    exportLimit = 500,
    syncStatus = "all",
    syncLimit = 100,
    syncActivityDays = 7,
    now = new Date(),
    preflightDatabase = assertSchedulerDatabaseReady,
    runPaperLoop = runAlpacaPaperLoop,
    writePaperRun = writeAlpacaPaperRunToDatabase,
    syncPaperState = syncAlpacaPaperState,
    writeSync = writeAlpacaSyncToDatabase,
    exportPaperLedgerFn = exportPaperLedger
  } = options;

  const startedAt = now.toISOString();
  const normalizedSymbols = normalizeSymbols(symbols);
  const cycle = {
    cycleId: `${startedAt.replace(/[:.]/g, "-")}-stock-paper-cycle`,
    startedAt,
    mode: "stock-paper-cycle",
    symbols: normalizedSymbols,
    submitted: Boolean(submitOrders),
    writeDatabase: Boolean(writeDatabase),
    exportLedger: Boolean(exportLedger),
    steps: {},
    summary: {}
  };

  if (writeDatabase && preflightDatabase) {
    cycle.steps.database = await preflightDatabase();
  }

  const paperRun = await runPaperLoop({
    client,
    symbols: normalizedSymbols,
    timeframe,
    bars,
    feed,
    lookbackDays,
    submitOrders,
    maxBuyNotional,
    targetRewardRiskRatio,
    now
  });
  cycle.steps.paperLoop = {
    ok: true,
    run: paperRun,
    database: writeDatabase ? await writePaperRun(paperRun) : null
  };

  const sync = await syncPaperState({
    client,
    status: syncStatus,
    limit: syncLimit,
    activityDays: syncActivityDays,
    now: new Date(now.getTime() + 1000)
  });
  cycle.steps.sync = {
    ok: true,
    sync,
    database: writeDatabase ? await writeSync(sync) : null
  };

  cycle.steps.export = exportLedger
    ? {
        ok: true,
        result: await exportPaperLedgerFn({
          outDir: exportOutDir,
          limit: exportLimit
        })
      }
    : {
        ok: true,
        result: null
      };

  cycle.endedAt = new Date(now.getTime() + 2000).toISOString();
  cycle.summary = createCycleSummary(cycle);
  return cycle;
}

export async function assertSchedulerDatabaseReady(options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    await withDatabaseClient((client) => client.query("SELECT 1"), { pool });
    return {
      ok: true,
      checkedAt: new Date().toISOString()
    };
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export function formatStockPaperCycle(cycle) {
  const paperRun = cycle.steps.paperLoop?.run || {};
  const paperDb = cycle.steps.paperLoop?.database;
  const sync = cycle.steps.sync?.sync || {};
  const syncDb = cycle.steps.sync?.database;
  const exportResult = cycle.steps.export?.result;
  const lines = [];

  lines.push("Stock Paper Scheduler Cycle");
  lines.push("===========================");
  lines.push(`Cycle ID:      ${cycle.cycleId}`);
  lines.push(`Mode:          ${cycle.submitted ? "submitted paper orders" : "decision/log only"}`);
  lines.push(`Symbols:       ${cycle.symbols.join(", ")}`);
  lines.push(`Database:      ${cycle.writeDatabase ? "required + written" : "off"}`);
  lines.push(`Excel export:  ${cycle.exportLedger ? "written" : "off"}`);
  lines.push(`Paper run:     ${paperRun.runId || "n/a"}`);
  lines.push(`Broker sync:   ${sync.runId || "n/a"}`);
  lines.push(`Signals:       ${cycle.summary.signals}`);
  lines.push(`Actionable:    ${cycle.summary.actionableSignals}`);
  lines.push(`Risk approved: ${cycle.summary.approvedRiskDecisions}`);
  lines.push(`Orders:        ${cycle.summary.orders}`);
  lines.push(`Submitted:     ${cycle.summary.submittedOrders}`);
  lines.push(`Positions:     ${cycle.summary.positions}`);
  lines.push(`Fills:         ${cycle.summary.fills}`);

  if (paperDb) {
    lines.push(`Paper DB:      ${paperDb.runId} (${paperDb.signals} signals, ${paperDb.orders} orders)`);
  }

  if (syncDb) {
    lines.push(`Sync DB:       ${syncDb.runId} (${syncDb.positions} positions, ${syncDb.orders} orders, ${syncDb.fills} fills)`);
  }

  if (exportResult?.files?.length) {
    lines.push("");
    lines.push("Excel Files");
    for (const file of exportResult.files) {
      lines.push(`  ${file.name.padEnd(24)} ${String(file.rows).padStart(4)} rows  ${file.filePath}`);
    }
  }

  return lines.join("\n");
}

function createCycleSummary(cycle) {
  const paperSummary = cycle.steps.paperLoop?.run?.summary || {};
  const syncSummary = cycle.steps.sync?.sync?.summary || {};
  const exportFiles = cycle.steps.export?.result?.files || [];

  return {
    signals: Number(paperSummary.signals || 0),
    actionableSignals: Number(paperSummary.actionableSignals || 0),
    approvedRiskDecisions: Number(paperSummary.approvedRiskDecisions || 0),
    rejectedRiskDecisions: Number(paperSummary.rejectedRiskDecisions || 0),
    orders: Number(paperSummary.orders || 0),
    submittedOrders: Number(paperSummary.submittedOrders || 0),
    positions: Number(syncSummary.positions || 0),
    brokerOrders: Number(syncSummary.orders || 0),
    fills: Number(syncSummary.fills || 0),
    exportFiles: exportFiles.length,
    exportRows: exportFiles.reduce((sum, file) => sum + Number(file.rows || 0), 0)
  };
}

function normalizeSymbols(symbols) {
  return String(Array.isArray(symbols) ? symbols.join(",") : symbols)
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}
