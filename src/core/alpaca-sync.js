import { createDatabasePool, withDatabaseClient } from "./database-client.js";

export async function syncAlpacaPaperState({
  client,
  status = "all",
  limit = 100,
  activityDays = 7,
  now = new Date()
}) {
  const createdAt = now.toISOString();
  const after = new Date(now.getTime() - Number(activityDays) * 24 * 60 * 60 * 1000).toISOString();

  const [account, positions, orders, fills] = await Promise.all([
    client.getAccount(),
    client.getPositions(),
    client.listOrders({
      status,
      limit,
      after,
      until: createdAt,
      direction: "desc"
    }),
    client.getAccountActivities({
      activityType: "FILL",
      after,
      until: createdAt,
      direction: "desc",
      pageSize: limit
    })
  ]);

  return {
    runId: `${createdAt.replace(/[:.]/g, "-")}-alpaca-sync`,
    createdAt,
    mode: "alpaca-sync",
    status,
    limit,
    activityDays,
    account: normalizeAccount(account),
    rawAccount: account,
    positions: positions.map(normalizePosition),
    orders: orders.map(normalizeOrder),
    fills: fills.map(normalizeFillActivity),
    summary: {
      positions: positions.length,
      orders: orders.length,
      fills: fills.length,
      openOrders: orders.filter((order) => order.status === "open" || order.status === "new" || order.status === "accepted").length,
      filledOrders: orders.filter((order) => order.status === "filled").length
    }
  };
}

export async function writeAlpacaSyncToDatabase(sync, options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      await client.query("BEGIN");
      try {
        await upsertSyncRun(client, sync);
        await deleteSyncChildren(client, sync.runId);
        await insertAccountSnapshot(client, sync);
        await insertPositions(client, sync);
        await upsertOrders(client, sync);
        await upsertFills(client, sync);
        await client.query("COMMIT");

        return {
          runId: sync.runId,
          positions: sync.positions.length,
          orders: sync.orders.length,
          fills: sync.fills.length
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

export function formatAlpacaSync(sync) {
  const lines = [];
  lines.push("Alpaca Paper Sync");
  lines.push("=================");
  lines.push(`Run ID:       ${sync.runId}`);
  lines.push(`Account:      ${sync.account.status || "unknown"}`);
  lines.push(`Buying Power: ${money(sync.account.buyingPower)}`);
  lines.push(`Equity:       ${money(sync.account.portfolioValue)}`);
  lines.push(`Positions:    ${sync.summary.positions}`);
  lines.push(`Orders:       ${sync.summary.orders}`);
  lines.push(`Fills:        ${sync.summary.fills}`);

  if (sync.positions.length) {
    lines.push("");
    lines.push("Positions");
    for (const position of sync.positions) {
      lines.push(
        `  ${position.symbol.padEnd(6)} qty=${position.qty} avg=${money(position.avgEntryPrice)} value=${money(position.marketValue)} upl=${money(position.unrealizedPl)}`
      );
    }
  }

  if (sync.orders.length) {
    lines.push("");
    lines.push("Recent Orders");
    for (const order of sync.orders.slice(0, 8)) {
      lines.push(
        `  ${String(order.submittedAt || order.updatedAt || "unknown").padEnd(28)} ${order.symbol.padEnd(6)} ${order.side.padEnd(4)} ${order.type.padEnd(6)} ${order.status}`
      );
    }
  }

  if (sync.fills.length) {
    lines.push("");
    lines.push("Recent Fills");
    for (const fill of sync.fills.slice(0, 8)) {
      lines.push(
        `  ${String(fill.transactionTime || "unknown").padEnd(28)} ${fill.symbol.padEnd(6)} ${fill.side.padEnd(4)} qty=${fill.qty} price=${money(fill.price)}`
      );
    }
  }

  return lines.join("\n");
}

async function upsertSyncRun(client, sync) {
  const metadata = {
    status: sync.status,
    limit: sync.limit,
    activityDays: sync.activityDays,
    account: sync.account,
    summary: sync.summary,
    sources: [{
      provider: "alpaca",
      mode: "paper-broker-sync"
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
    ) VALUES ($1, 'alpaca-sync', 'broker-sync', $2, $2, $3, $4, $5)
    ON CONFLICT (run_id) DO UPDATE SET
      ended_at = EXCLUDED.ended_at,
      starting_cash = EXCLUDED.starting_cash,
      ending_equity = EXCLUDED.ending_equity,
      metadata = EXCLUDED.metadata`,
    [
      sync.runId,
      sync.createdAt,
      numberOrNull(sync.account.cash),
      numberOrNull(sync.account.portfolioValue),
      JSON.stringify(metadata)
    ]
  );
}

async function deleteSyncChildren(client, runId) {
  await client.query("DELETE FROM account_snapshots WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM account_positions WHERE run_id = $1", [runId]);
}

async function insertAccountSnapshot(client, sync) {
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
      sync.runId,
      sync.createdAt,
      numberOrNull(sync.account.cash),
      numberOrNull(sync.account.buyingPower),
      numberOrNull(sync.account.portfolioValue),
      JSON.stringify(sync.rawAccount || sync.account)
    ]
  );
}

async function insertPositions(client, sync) {
  for (const position of sync.positions) {
    await client.query(
      `INSERT INTO account_positions (
        run_id,
        source,
        snapshot_time,
        symbol,
        asset_class,
        qty,
        avg_entry_price,
        market_value,
        unrealized_pl,
        raw
      ) VALUES ($1, 'alpaca-paper', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sync.runId,
        sync.createdAt,
        position.symbol,
        position.assetClass,
        numberOrNull(position.qty),
        numberOrNull(position.avgEntryPrice),
        numberOrNull(position.marketValue),
        numberOrNull(position.unrealizedPl),
        JSON.stringify(position.raw || position)
      ]
    );
  }
}

async function upsertOrders(client, sync) {
  for (const order of sync.orders) {
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
        filled_qty,
        filled_avg_price,
        status,
        submitted_at,
        updated_at,
        raw
      ) VALUES ($1, 'alpaca-paper', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (broker, broker_order_id) WHERE broker_order_id IS NOT NULL DO UPDATE SET
        run_id = COALESCE(broker_orders.run_id, EXCLUDED.run_id),
        status = EXCLUDED.status,
        filled_qty = EXCLUDED.filled_qty,
        filled_avg_price = EXCLUDED.filled_avg_price,
        updated_at = EXCLUDED.updated_at,
        raw = EXCLUDED.raw`,
      [
        sync.runId,
        order.id,
        order.clientOrderId,
        order.symbol,
        order.assetClass,
        order.side,
        order.type,
        order.timeInForce,
        numberOrNull(order.qty),
        numberOrNull(order.notional),
        numberOrNull(order.limitPrice),
        numberOrNull(order.filledQty),
        numberOrNull(order.filledAvgPrice),
        order.status,
        order.submittedAt,
        order.updatedAt || sync.createdAt,
        JSON.stringify(order.raw || order)
      ]
    );
  }
}

async function upsertFills(client, sync) {
  for (const fill of sync.fills) {
    const orderResult = fill.orderId
      ? await client.query(
          "SELECT id FROM broker_orders WHERE broker = 'alpaca-paper' AND broker_order_id = $1 LIMIT 1",
          [fill.orderId]
        )
      : { rows: [] };
    const localOrderId = orderResult.rows[0]?.id || null;

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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
      ON CONFLICT (broker_fill_id) WHERE broker_fill_id IS NOT NULL DO UPDATE SET
        order_id = EXCLUDED.order_id,
        qty = EXCLUDED.qty,
        price = EXCLUDED.price,
        raw = EXCLUDED.raw`,
      [
        localOrderId,
        fill.id,
        fill.transactionTime || sync.createdAt,
        fill.symbol,
        fill.side,
        numberOrNull(fill.qty),
        numberOrNull(fill.price),
        JSON.stringify(fill.raw || fill)
      ]
    );
  }
}

function normalizeAccount(account) {
  return {
    id: account.id,
    status: account.status,
    cash: Number(account.cash || 0),
    buyingPower: Number(account.buying_power || 0),
    portfolioValue: Number(account.portfolio_value || 0),
    patternDayTrader: Boolean(account.pattern_day_trader)
  };
}

function normalizePosition(position) {
  return {
    symbol: position.symbol,
    assetClass: mapAlpacaAssetClass(position.asset_class),
    qty: Number(position.qty || 0),
    avgEntryPrice: Number(position.avg_entry_price || 0),
    marketValue: Number(position.market_value || 0),
    unrealizedPl: Number(position.unrealized_pl || 0),
    raw: position
  };
}

function normalizeOrder(order) {
  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    assetClass: mapAlpacaAssetClass(order.asset_class),
    side: order.side,
    type: order.type,
    timeInForce: order.time_in_force,
    qty: numberOrNull(order.qty),
    notional: numberOrNull(order.notional),
    limitPrice: numberOrNull(order.limit_price),
    filledQty: numberOrNull(order.filled_qty),
    filledAvgPrice: numberOrNull(order.filled_avg_price),
    status: order.status || "unknown",
    submittedAt: order.submitted_at || order.created_at || null,
    updatedAt: order.updated_at || order.filled_at || order.canceled_at || order.expired_at || null,
    raw: order
  };
}

function normalizeFillActivity(fill) {
  return {
    id: fill.id || fill.activity_id || `${fill.order_id || "order"}-${fill.transaction_time || fill.date}`,
    orderId: fill.order_id,
    symbol: fill.symbol,
    side: fill.side,
    qty: Number(fill.qty || 0),
    price: Number(fill.price || 0),
    transactionTime: fill.transaction_time || fill.date || null,
    raw: fill
  };
}

function mapAlpacaAssetClass(assetClass) {
  if (assetClass === "us_equity") {
    return "stock";
  }
  return assetClass || "stock";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}
