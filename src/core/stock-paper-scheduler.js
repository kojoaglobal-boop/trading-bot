import { defaultConfig } from "../config/default.js";
import { AlpacaClient } from "../integrations/alpaca-client.js";
import { FinnhubClient } from "../integrations/finnhub-client.js";
import { runAlpacaPaperLoop } from "./alpaca-paper-loop.js";
import { syncAlpacaPaperState, writeAlpacaSyncToDatabase } from "./alpaca-sync.js";
import { createDatabasePool, withDatabaseClient } from "./database-client.js";
import { writeAlpacaPaperRunToDatabase } from "./database-live.js";
import { exportPaperLedger } from "./excel-export.js";
import { getPaperTrainingProfile } from "./paper-training-profile.js";

export async function runStockPaperCycle(options = {}) {
  const profileSettings = getPaperTrainingProfile(
    defaultConfig,
    options.profile || defaultConfig.paperTraining.defaultProfile || "standard"
  );
  const client = options.client || new AlpacaClient();
  const symbols = options.symbols ?? defaultConfig.stockPaper.symbols;
  const timeframe = String(options.timeframe ?? profileSettings.config.timeframe ?? "1Hour");
  const bars = Number(options.bars ?? profileSettings.config.bars ?? 80);
  const feed = String(options.feed ?? "iex");
  const lookbackDays = Number(options.lookbackDays ?? profileSettings.config.lookbackDays ?? 30);
  const submitOrders = Boolean(options.submitOrders);
  const maxBuyNotional = Number(
    options.maxBuyNotional ?? profileSettings.config.maxBuyNotional ?? defaultConfig.paperTraining.maxBuyNotional
  );
  const targetRewardRiskRatio = Number(
    options.targetRewardRiskRatio ??
    profileSettings.config.targetRewardRiskRatio ??
    defaultConfig.paperTraining.targetRewardRiskRatio
  );
  const writeDatabase = options.writeDatabase ?? true;
  const exportLedger = options.exportLedger ?? true;
  const exportOutDir = options.exportOutDir || "reports/paper-ledger";
  const exportLimit = Number(options.exportLimit ?? 500);
  const syncStatus = options.syncStatus || "all";
  const syncLimit = Number(options.syncLimit ?? 100);
  const syncActivityDays = Number(options.syncActivityDays ?? 7);
  const now = options.now || new Date();
  const preflightDatabase = options.preflightDatabase ?? assertSchedulerDatabaseReady;
  const runPaperLoop = options.runPaperLoop || runAlpacaPaperLoop;
  const writePaperRun = options.writePaperRun || writeAlpacaPaperRunToDatabase;
  const syncPaperState = options.syncPaperState || syncAlpacaPaperState;
  const writeSync = options.writeSync || writeAlpacaSyncToDatabase;
  const exportPaperLedgerFn = options.exportPaperLedgerFn || exportPaperLedger;
  const loadDailyStartEquity = options.loadDailyStartEquity || loadAlpacaDailyStartEquity;
  const selection = {
    ...(defaultConfig.stockPaper.selection || {}),
    ...(profileSettings.config.selection || {}),
    ...(options.selection || {})
  };
  const newsClient = options.newsClient ?? createNewsClient(selection);

  const startedAt = now.toISOString();
  const normalizedSymbols = normalizeSymbols(symbols);
  const cycle = {
    cycleId: `${startedAt.replace(/[:.]/g, "-")}-stock-paper-cycle`,
    startedAt,
    mode: "stock-paper-cycle",
    profile: profileSettings.name,
    symbols: normalizedSymbols,
    timeframe,
    bars,
    lookbackDays,
    submitted: Boolean(submitOrders),
    writeDatabase: Boolean(writeDatabase),
    exportLedger: Boolean(exportLedger),
    steps: {},
    summary: {}
  };

  if (writeDatabase && preflightDatabase) {
    cycle.steps.database = await preflightDatabase();
  }
  const dailyStart = writeDatabase
    ? await loadDailyStartEquity({ now })
    : null;
  cycle.steps.dailyStart = dailyStart;

  const paperRun = await runPaperLoop({
    client,
    symbols: normalizedSymbols,
    profile: profileSettings.name,
    timeframe,
    bars,
    feed,
    lookbackDays,
    submitOrders,
    maxBuyNotional,
    targetRewardRiskRatio,
    dailyStartEquity: dailyStart?.equity,
    selection,
    newsClient,
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

export async function loadAlpacaDailyStartEquity(options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;
  const now = options.now || new Date();

  try {
    return await withDatabaseClient(async (client) => {
      const result = await client.query(
        `SELECT equity, snapshot_time
         FROM account_snapshots
         WHERE source = 'alpaca-paper'
           AND equity IS NOT NULL
           AND snapshot_time >= (
             date_trunc('day', $1::timestamptz AT TIME ZONE 'America/New_York')
             AT TIME ZONE 'America/New_York'
           )
           AND snapshot_time < (
             (date_trunc('day', $1::timestamptz AT TIME ZONE 'America/New_York') + interval '1 day')
             AT TIME ZONE 'America/New_York'
           )
         ORDER BY snapshot_time ASC, id ASC
         LIMIT 1`,
        [now.toISOString()]
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        equity: Number(row.equity),
        snapshotTime: row.snapshot_time instanceof Date
          ? row.snapshot_time.toISOString()
          : String(row.snapshot_time)
      };
    }, { pool });
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
  lines.push(`Profile:       ${cycle.profile || "standard"}`);
  if (paperRun.selection?.enabled) {
    lines.push(`Universe:      ${paperRun.selection.scannedSymbols.length} scanned`);
    lines.push(`Selected:      ${paperRun.selection.selectedSymbols.join(", ") || "none"}`);
  } else {
    lines.push(`Symbols:       ${cycle.symbols.join(", ")}`);
  }
  lines.push(`Timeframe:     ${cycle.timeframe || "n/a"}`);
  if (cycle.steps.dailyStart?.equity) {
    lines.push(`Day start:     ${money(cycle.steps.dailyStart.equity)}`);
  }
  if (paperRun.dailyGuard) {
    lines.push(`Daily P/L:     ${money(paperRun.dailyGuard.dailyPnl)} (${paperRun.dailyGuard.status})`);
  }
  lines.push(`Database:      ${cycle.writeDatabase ? "required + written" : "off"}`);
  lines.push(`Excel export:  ${cycle.exportLedger ? "written" : "off"}`);
  lines.push(`Paper run:     ${paperRun.runId || "n/a"}`);
  lines.push(`Broker sync:   ${sync.runId || "n/a"}`);
  lines.push(`Signals:       ${cycle.summary.signals}`);
  lines.push(`Actionable:    ${cycle.summary.actionableSignals}`);
  lines.push(`Risk approved: ${cycle.summary.approvedRiskDecisions}`);
  lines.push(`Orders:        ${cycle.summary.orders}`);
  lines.push(`Submitted:     ${cycle.summary.submittedOrders}`);
  if (cycle.summary.scannedSymbols) {
    lines.push(`Scanned:       ${cycle.summary.scannedSymbols}`);
    lines.push(`Selected:      ${cycle.summary.selectedSymbols}`);
  }
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

  if (paperRun.selection?.rankings?.length) {
    lines.push("");
    lines.push("Top Stock Candidates");
    for (const candidate of paperRun.selection.rankings.slice(0, 10)) {
      lines.push(
        `  ${candidate.symbol.padEnd(6)} score=${candidate.score.toFixed(1).padStart(6)} ${candidate.reasons.join(", ")}`
      );
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
    scannedSymbols: Number(paperSummary.scannedSymbols || 0),
    selectedSymbols: Number(paperSummary.selectedSymbols || 0),
    positions: Number(syncSummary.positions || 0),
    brokerOrders: Number(syncSummary.orders || 0),
    fills: Number(syncSummary.fills || 0),
    exportFiles: exportFiles.length,
    exportRows: exportFiles.reduce((sum, file) => sum + Number(file.rows || 0), 0)
  };
}

function createNewsClient(selection) {
  if (!selection?.useFinnhubCatalysts || !process.env.FINNHUB_API_KEY) {
    return null;
  }

  return new FinnhubClient();
}

function normalizeSymbols(symbols) {
  return String(Array.isArray(symbols) ? symbols.join(",") : symbols)
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}
