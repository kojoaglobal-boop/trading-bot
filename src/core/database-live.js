import { createDatabasePool, withDatabaseClient } from "./database-client.js";

export async function writeAlpacaPaperRunToDatabase(run, options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      await client.query("BEGIN");
      try {
        await upsertLiveRun(client, run);
        await deleteLiveRunChildren(client, run.runId);
        await insertAccountSnapshot(client, run);
        await insertSignals(client, run);
        await insertRiskDecisions(client, run);
        await insertBrokerOrders(client, run);
        await client.query("COMMIT");

        return {
          runId: run.runId,
          signals: run.signals.length,
          riskDecisions: run.riskDecisions.length,
          orders: run.orders.length
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

async function upsertLiveRun(client, run) {
  const metadata = {
    symbols: run.symbols,
    timeframe: run.timeframe,
    feed: run.feed,
    lookbackDays: run.lookbackDays,
    bars: run.barsProcessed,
    submitted: run.submitted,
    orderSubmissionEnabled: run.orderSubmissionEnabled,
    marketClock: run.marketClock,
    summary: run.summary,
    account: run.account,
    sources: [{
      provider: "alpaca",
      mode: "paper-market-data",
      feed: run.feed,
      timeframe: run.timeframe
    }]
  };

  await client.query(
    `INSERT INTO bot_runs (
      run_id,
      mode,
      strategy,
      started_at,
      ended_at,
      starting_cash,
      ending_equity,
      metadata
    ) VALUES ($1, 'alpaca-paper', 'momentum-breakout', $2, $2, $3, $4, $5)
    ON CONFLICT (run_id) DO UPDATE SET
      ended_at = EXCLUDED.ended_at,
      starting_cash = EXCLUDED.starting_cash,
      ending_equity = EXCLUDED.ending_equity,
      metadata = EXCLUDED.metadata`,
    [
      run.runId,
      run.createdAt,
      numberOrNull(run.account.cash),
      numberOrNull(run.account.portfolioValue),
      JSON.stringify(metadata)
    ]
  );
}

async function deleteLiveRunChildren(client, runId) {
  await client.query("DELETE FROM broker_orders WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM risk_decisions WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM strategy_signals WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM account_snapshots WHERE run_id = $1", [runId]);
}

async function insertAccountSnapshot(client, run) {
  await client.query(
    `INSERT INTO account_snapshots (
      run_id,
      source,
      snapshot_time,
      cash,
      buying_power,
      equity,
      raw
    ) VALUES ($1, 'alpaca-paper', $2, $3, $4, $5, $6)`,
    [
      run.runId,
      run.createdAt,
      numberOrNull(run.account.cash),
      numberOrNull(run.account.buyingPower),
      numberOrNull(run.account.portfolioValue),
      JSON.stringify(run.rawAccount || run.account)
    ]
  );
}

async function insertSignals(client, run) {
  for (const signal of run.signals) {
    await client.query(
      `INSERT INTO strategy_signals (
        run_id,
        signal_time,
        symbol,
        asset_class,
        action,
        confidence,
        reason,
        features
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        run.runId,
        signal.time,
        signal.symbol,
        signal.assetClass,
        signal.action,
        numberOrNull(signal.confidence),
        signal.reason || null,
        JSON.stringify(signal.features || {})
      ]
    );
  }
}

async function insertRiskDecisions(client, run) {
  for (const decision of run.riskDecisions) {
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
      ) VALUES ($1, $2, $3, $4, $5, 'risk-engine', $6, $7)`,
      [
        run.runId,
        decision.time,
        decision.symbol,
        decision.action,
        Boolean(decision.approved),
        decision.reason || null,
        JSON.stringify(decision)
      ]
    );
  }
}

async function insertBrokerOrders(client, run) {
  for (const order of run.orders) {
    const submitted = order.submitted || {};
    const request = order.request || {};

    await client.query(
      `INSERT INTO broker_orders (
        run_id,
        broker,
        broker_order_id,
        client_order_id,
        symbol,
        asset_class,
        side,
        order_type,
        time_in_force,
        qty,
        notional,
        limit_price,
        status,
        submitted_at,
        updated_at,
        raw
      ) VALUES ($1, 'alpaca-paper', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)`,
      [
        run.runId,
        submitted.id || null,
        submitted.client_order_id || request.client_order_id || null,
        submitted.symbol || request.symbol,
        order.assetClass || "stock",
        submitted.side || request.side,
        submitted.type || request.type,
        submitted.time_in_force || request.time_in_force || null,
        numberOrNull(submitted.qty || request.qty),
        numberOrNull(submitted.notional || request.notional),
        numberOrNull(submitted.limit_price || request.limit_price),
        submitted.status || order.status || "planned",
        submitted.submitted_at || run.createdAt,
        JSON.stringify(order)
      ]
    );
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return Number(value);
}
