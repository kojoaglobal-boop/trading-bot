import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDatabasePool, withDatabaseClient } from "./database-client.js";

const EXPORTS = [
  {
    name: "paper_runs",
    headers: [
      "run_id",
      "mode",
      "strategy",
      "started_at",
      "ending_equity",
      "signals",
      "actionable_signals",
      "risk_approved",
      "risk_rejected",
      "orders",
      "submitted_orders"
    ],
    query: `SELECT
      run_id,
      mode,
      strategy,
      started_at,
      ending_equity,
      metadata #>> '{summary,signals}' AS signals,
      metadata #>> '{summary,actionableSignals}' AS actionable_signals,
      metadata #>> '{summary,approvedRiskDecisions}' AS risk_approved,
      metadata #>> '{summary,rejectedRiskDecisions}' AS risk_rejected,
      metadata #>> '{summary,orders}' AS orders,
      metadata #>> '{summary,submittedOrders}' AS submitted_orders
    FROM bot_runs
    WHERE mode IN ('alpaca-paper', 'alpaca-sync', 'paper')
    ORDER BY started_at DESC
    LIMIT $1`
  },
  {
    name: "paper_signals",
    headers: ["run_id", "signal_time", "symbol", "asset_class", "action", "confidence", "reason"],
    query: `SELECT
      run_id,
      signal_time,
      symbol,
      asset_class,
      action,
      confidence,
      reason
    FROM strategy_signals
    ORDER BY signal_time DESC
    LIMIT $1`
  },
  {
    name: "paper_risk_decisions",
    headers: [
      "run_id",
      "decision_time",
      "symbol",
      "requested_action",
      "approved",
      "reason",
      "notional",
      "estimated_risk",
      "target_profit"
    ],
    query: `SELECT
      run_id,
      decision_time,
      symbol,
      requested_action,
      approved,
      reason,
      risk_snapshot #>> '{order,notional}' AS notional,
      risk_snapshot #>> '{order,estimatedRiskDollars}' AS estimated_risk,
      risk_snapshot #>> '{order,targetProfitDollars}' AS target_profit
    FROM risk_decisions
    ORDER BY decision_time DESC
    LIMIT $1`
  },
  {
    name: "paper_orders",
    headers: [
      "run_id",
      "broker",
      "broker_order_id",
      "symbol",
      "asset_class",
      "side",
      "order_type",
      "qty",
      "notional",
      "filled_qty",
      "filled_avg_price",
      "status",
      "submitted_at",
      "updated_at"
    ],
    query: `SELECT
      run_id,
      broker,
      broker_order_id,
      symbol,
      asset_class,
      side,
      order_type,
      qty,
      notional,
      filled_qty,
      filled_avg_price,
      status,
      submitted_at,
      updated_at
    FROM broker_orders
    ORDER BY COALESCE(updated_at, submitted_at, created_at) DESC
    LIMIT $1`
  },
  {
    name: "paper_fills",
    headers: ["broker_fill_id", "fill_time", "symbol", "side", "qty", "price", "commission"],
    query: `SELECT
      broker_fill_id,
      fill_time,
      symbol,
      side,
      qty,
      price,
      commission
    FROM fills
    ORDER BY fill_time DESC
    LIMIT $1`
  },
  {
    name: "paper_account_snapshots",
    headers: ["run_id", "source", "snapshot_time", "cash", "buying_power", "equity", "daily_pnl"],
    query: `SELECT
      run_id,
      source,
      snapshot_time,
      cash,
      buying_power,
      equity,
      daily_pnl
    FROM account_snapshots
    ORDER BY snapshot_time DESC
    LIMIT $1`
  }
];

export async function exportPaperLedger(options = {}) {
  const {
    outDir = "reports/paper-ledger",
    limit = 500,
    pool = createDatabasePool()
  } = options;
  const shouldClosePool = !options.pool;

  try {
    await mkdir(outDir, { recursive: true });

    return await withDatabaseClient(async (client) => {
      const files = [];

      for (const exportSpec of EXPORTS) {
        const result = await client.query(exportSpec.query, [Number(limit)]);
        const filePath = path.join(outDir, `${exportSpec.name}.csv`);
        await writeFile(filePath, toCsv(exportSpec.headers, result.rows), "utf8");
        files.push({
          name: exportSpec.name,
          filePath,
          rows: result.rows.length
        });
      }

      return {
        outDir,
        files
      };
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export function formatPaperLedgerExport(exportResult) {
  const lines = [];
  lines.push("Excel Paper Ledger Export");
  lines.push("=========================");
  lines.push(`Folder: ${exportResult.outDir}`);

  for (const file of exportResult.files) {
    lines.push(`${file.name.padEnd(24)} ${String(file.rows).padStart(4)} rows  ${file.filePath}`);
  }

  return lines.join("\n");
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvValue).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvValue(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const normalized = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replaceAll("\"", "\"\"")}"`;
  }
  return normalized;
}
