import { createDatabasePool, withDatabaseClient } from "./database-client.js";

export async function writeAuditToDatabase(audit, options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      await client.query("BEGIN");
      try {
        await upsertRun(client, audit);
        await deleteExistingRunChildren(client, audit.runId);
        await insertFills(client, audit);
        await insertRejections(client, audit);
        await client.query("COMMIT");
        return {
          runId: audit.runId,
          fills: audit.fills?.length || 0,
          rejections: audit.rejections?.length || 0
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export async function loadDatabaseJournal(options = {}) {
  const limit = options.limit || 12;
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      const result = await client.query(
        `SELECT
          run_id,
          mode,
          started_at,
          starting_cash,
          ending_equity,
          max_drawdown_pct,
          win_rate_pct,
          profit_factor,
          metadata
        FROM bot_runs
        ORDER BY started_at DESC
        LIMIT $1`,
        [limit]
      );

      return result.rows.map(rowToAuditLog);
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

async function upsertRun(client, audit) {
  const account = audit.account || {};
  const metrics = audit.metrics || {};
  const metadata = {
    account,
    metrics,
    sources: audit.sources || [],
    positions: audit.positions || []
  };

  await client.query(
    `INSERT INTO bot_runs (
      run_id,
      mode,
      strategy,
      started_at,
      starting_cash,
      ending_equity,
      max_drawdown_pct,
      win_rate_pct,
      profit_factor,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (run_id) DO UPDATE SET
      mode = EXCLUDED.mode,
      starting_cash = EXCLUDED.starting_cash,
      ending_equity = EXCLUDED.ending_equity,
      max_drawdown_pct = EXCLUDED.max_drawdown_pct,
      win_rate_pct = EXCLUDED.win_rate_pct,
      profit_factor = EXCLUDED.profit_factor,
      metadata = EXCLUDED.metadata`,
    [
      audit.runId,
      audit.mode || "unknown",
      "momentum-breakout",
      audit.createdAt || new Date().toISOString(),
      numberOrNull(account.startingCash),
      numberOrNull(account.finalEquity),
      numberOrNull(metrics.maxDrawdownPct),
      numberOrNull(metrics.winRate),
      numberOrNull(metrics.profitFactor),
      JSON.stringify(metadata)
    ]
  );
}

async function deleteExistingRunChildren(client, runId) {
  await client.query("DELETE FROM broker_orders WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM risk_decisions WHERE run_id = $1", [runId]);
}

async function insertFills(client, audit) {
  for (const fill of audit.fills || []) {
    const orderResult = await client.query(
      `INSERT INTO broker_orders (
        run_id,
        broker,
        broker_order_id,
        client_order_id,
        symbol,
        asset_class,
        side,
        order_type,
        qty,
        notional,
        status,
        submitted_at,
        updated_at,
        raw
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'market', $8, $9, 'filled', $10, $10, $11)
      RETURNING id`,
      [
        audit.runId,
        "paper-sim",
        fill.id || null,
        fill.id || null,
        fill.symbol,
        fill.assetClass || "unknown",
        String(fill.side || "").toLowerCase(),
        numberOrNull(fill.quantity),
        numberOrNull(fill.notional),
        fill.time || audit.createdAt,
        JSON.stringify(fill)
      ]
    );

    await client.query(
      `INSERT INTO fills (
        order_id,
        broker_fill_id,
        fill_time,
        symbol,
        side,
        qty,
        price,
        commission,
        raw
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orderResult.rows[0].id,
        fill.id || null,
        fill.time || audit.createdAt,
        fill.symbol,
        String(fill.side || "").toLowerCase(),
        numberOrNull(fill.quantity),
        numberOrNull(fill.price),
        numberOrNull(fill.commission),
        JSON.stringify(fill)
      ]
    );
  }
}

async function insertRejections(client, audit) {
  for (const rejection of audit.rejections || []) {
    await client.query(
      `INSERT INTO risk_decisions (
        run_id,
        decision_time,
        symbol,
        requested_action,
        approved,
        rule,
        reason,
        risk_snapshot
      ) VALUES ($1, $2, $3, $4, false, 'risk-engine', $5, $6)`,
      [
        audit.runId,
        rejection.time || audit.createdAt,
        rejection.symbol || "unknown",
        rejection.action || "unknown",
        rejection.reason || null,
        JSON.stringify(rejection)
      ]
    );
  }
}

function rowToAuditLog(row) {
  const metadata = row.metadata || {};
  const account = metadata.account || {};
  const metrics = metadata.metrics || {};

  return {
    runId: row.run_id,
    createdAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
    mode: row.mode,
    account: {
      ...account,
      startingCash: numberValue(row.starting_cash, account.startingCash),
      finalEquity: numberValue(row.ending_equity, account.finalEquity)
    },
    metrics: {
      ...metrics,
      maxDrawdownPct: numberValue(row.max_drawdown_pct, metrics.maxDrawdownPct),
      winRate: numberValue(row.win_rate_pct, metrics.winRate),
      profitFactor: numberValue(row.profit_factor, metrics.profitFactor)
    },
    sources: metadata.sources || []
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return Number(value);
}

function numberValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  return Number(value);
}
