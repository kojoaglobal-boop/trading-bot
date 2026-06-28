import { createDatabasePool, withDatabaseClient } from "./database-client.js";
import { getSourceStatuses } from "./source-registry.js";

export async function loadDashboardSnapshot(options = {}) {
  const {
    limit = 8,
    env = process.env,
    pool = createDatabasePool(),
    now = new Date(),
    getSources = getSourceStatuses
  } = options;
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      const account = await queryLatestAccount(client);
      const runs = await queryRecentRuns(client, limit);
      const signals = await queryRecentSignals(client, limit);
      const riskDecisions = await queryRecentRiskDecisions(client, limit);
      const orders = await queryRecentOrders(client, limit);
      const fills = await queryRecentFills(client, limit);
      const positions = await queryLatestPositions(client, limit);
      const marketData = await queryMarketDataSummary(client, limit);
      const dataQuality = await queryDataQualityChecks(client, limit);
      const sources = getSources(env);

      return {
        generatedAt: now.toISOString(),
        account,
        runs,
        signals,
        riskDecisions,
        orders,
        fills,
        positions,
        marketData,
        dataQuality,
        sources,
        summary: {
          runs: runs.length,
          signals: signals.length,
          actionableSignals: signals.filter((signal) => signal.action !== "HOLD").length,
          approvedRiskDecisions: riskDecisions.filter((decision) => decision.approved).length,
          blockedRiskDecisions: riskDecisions.filter((decision) => !decision.approved).length,
          openOrders: orders.filter((order) => isOpenOrderStatus(order.status)).length,
          filledOrders: orders.filter((order) => order.status === "filled").length,
          fills: fills.length,
          positions: positions.length,
          configuredSources: sources.filter((source) => source.configured).length,
          missingSources: sources.filter((source) => !source.configured).length
        }
      };
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export function formatDashboardSnapshot(snapshot) {
  const lines = [];
  lines.push("Trading Bot Dashboard");
  lines.push("=====================");
  lines.push(`Generated: ${snapshot.generatedAt}`);

  lines.push("");
  lines.push("Account");
  if (snapshot.account) {
    lines.push(`  Source:       ${snapshot.account.source}`);
    lines.push(`  Snapshot:     ${snapshot.account.snapshotTime}`);
    lines.push(`  Equity:       ${money(snapshot.account.equity)}`);
    lines.push(`  Cash:         ${money(snapshot.account.cash)}`);
    lines.push(`  Buying Power: ${money(snapshot.account.buyingPower)}`);
  } else {
    lines.push("  No account snapshots yet.");
  }

  lines.push("");
  lines.push("Health");
  lines.push(`  Runs:          ${snapshot.summary.runs}`);
  lines.push(`  Signals:       ${snapshot.summary.signals} (${snapshot.summary.actionableSignals} actionable)`);
  lines.push(`  Risk approved: ${snapshot.summary.approvedRiskDecisions}`);
  lines.push(`  Risk blocked:  ${snapshot.summary.blockedRiskDecisions}`);
  lines.push(`  Open orders:   ${snapshot.summary.openOrders}`);
  lines.push(`  Fills shown:   ${snapshot.summary.fills}`);
  lines.push(`  Sources:       ${snapshot.summary.configuredSources} configured, ${snapshot.summary.missingSources} missing keys`);

  appendRows(lines, "Latest Runs", snapshot.runs, (run) => {
    const summary = run.summary;
    return `${run.startedAt} ${run.mode.padEnd(13)} equity=${money(run.endingEquity)} signals=${summary.signals ?? "-"} orders=${summary.orders ?? "-"} id=${run.runId}`;
  });

  appendRows(lines, "Recent Signals", snapshot.signals, (signal) => (
    `${signal.signalTime} ${signal.symbol.padEnd(8)} ${signal.action.padEnd(5)} ${signal.reason || ""}`
  ));

  appendRows(lines, "Risk Decisions", snapshot.riskDecisions, (decision) => (
    `${decision.decisionTime} ${decision.symbol.padEnd(8)} ${decision.requestedAction.padEnd(5)} ${decision.approved ? "APPROVED" : "BLOCKED"} ${decision.reason || ""}`
  ));

  appendRows(lines, "Recent Orders", snapshot.orders, (order) => (
    `${String(order.updatedAt || order.submittedAt || "unknown").padEnd(28)} ${order.symbol.padEnd(8)} ${order.side.padEnd(4)} ${order.status.padEnd(10)} notional=${money(order.notional)}`
  ));

  appendRows(lines, "Recent Fills", snapshot.fills, (fill) => (
    `${fill.fillTime} ${fill.symbol.padEnd(8)} ${fill.side.padEnd(4)} qty=${formatNumber(fill.qty)} price=${money(fill.price)}`
  ));

  appendRows(lines, "Open Positions", snapshot.positions, (position) => (
    `${position.snapshotTime} ${position.symbol.padEnd(8)} qty=${formatNumber(position.qty)} value=${money(position.marketValue)} upl=${money(position.unrealizedPl)}`
  ));

  appendRows(lines, "Market Data", snapshot.marketData, (data) => (
    `${data.symbol.padEnd(10)} ${data.assetClass.padEnd(6)} ${data.source}:${data.mode} bars=${data.bars} latest=${data.latestBarTime}`
  ));

  appendRows(lines, "Data Quality", snapshot.dataQuality, (check) => (
    `${check.checkTime} ${check.symbol.padEnd(10)} ${check.status.padEnd(6)} ${check.primarySource}/${check.secondarySource} diff=${formatNumber(check.closeDiffBps)}bps`
  ));

  appendRows(lines, "Sources Missing Keys", snapshot.sources.filter((source) => !source.configured), (source) => (
    `${source.id.padEnd(10)} missing=${source.missingEnv.join(", ")}`
  ));

  return lines.join("\n");
}

async function queryLatestAccount(client) {
  const result = await client.query(
    `SELECT
      source,
      snapshot_time,
      cash,
      buying_power,
      equity,
      daily_pnl
    FROM account_snapshots
    ORDER BY snapshot_time DESC
    LIMIT 1`
  );

  return result.rows[0] ? rowToAccount(result.rows[0]) : null;
}

async function queryRecentRuns(client, limit) {
  const result = await client.query(
    `SELECT
      run_id,
      mode,
      strategy,
      started_at,
      ending_equity,
      metadata
    FROM bot_runs
    ORDER BY started_at DESC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToRun);
}

async function queryRecentSignals(client, limit) {
  const result = await client.query(
    `SELECT
      run_id,
      signal_time,
      symbol,
      asset_class,
      action,
      confidence,
      reason
    FROM strategy_signals
    ORDER BY signal_time DESC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToSignal);
}

async function queryRecentRiskDecisions(client, limit) {
  const result = await client.query(
    `SELECT
      run_id,
      decision_time,
      symbol,
      requested_action,
      approved,
      reason
    FROM risk_decisions
    ORDER BY decision_time DESC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToRiskDecision);
}

async function queryRecentOrders(client, limit) {
  const result = await client.query(
    `SELECT
      run_id,
      broker,
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
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToOrder);
}

async function queryRecentFills(client, limit) {
  const result = await client.query(
    `SELECT
      broker_fill_id,
      fill_time,
      symbol,
      side,
      qty,
      price,
      commission
    FROM fills
    ORDER BY fill_time DESC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToFill);
}

async function queryLatestPositions(client, limit) {
  const result = await client.query(
    `SELECT
      source,
      snapshot_time,
      symbol,
      asset_class,
      qty,
      avg_entry_price,
      market_value,
      unrealized_pl
    FROM account_positions
    ORDER BY snapshot_time DESC, symbol ASC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToPosition);
}

async function queryMarketDataSummary(client, limit) {
  const result = await client.query(
    `SELECT
      source,
      mode,
      symbol,
      asset_class,
      COUNT(*) AS bars,
      MAX(bar_time) AS latest_bar_time
    FROM market_bars
    GROUP BY source, mode, symbol, asset_class
    ORDER BY latest_bar_time DESC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToMarketData);
}

async function queryDataQualityChecks(client, limit) {
  const result = await client.query(
    `SELECT
      check_time,
      symbol,
      primary_source,
      secondary_source,
      close_diff_bps,
      status,
      reasons
    FROM data_quality_checks
    ORDER BY check_time DESC
    LIMIT $1`,
    [Number(limit)]
  );

  return result.rows.map(rowToDataQuality);
}

function rowToAccount(row) {
  return {
    source: row.source,
    snapshotTime: toIso(row.snapshot_time),
    cash: numberOrNull(row.cash),
    buyingPower: numberOrNull(row.buying_power),
    equity: numberOrNull(row.equity),
    dailyPnl: numberOrNull(row.daily_pnl)
  };
}

function rowToRun(row) {
  const metadata = parseJson(row.metadata, {});
  return {
    runId: row.run_id,
    mode: row.mode,
    strategy: row.strategy,
    startedAt: toIso(row.started_at),
    endingEquity: numberOrNull(row.ending_equity),
    summary: metadata.summary || {}
  };
}

function rowToSignal(row) {
  return {
    runId: row.run_id,
    signalTime: toIso(row.signal_time),
    symbol: row.symbol,
    assetClass: row.asset_class,
    action: row.action,
    confidence: numberOrNull(row.confidence),
    reason: row.reason
  };
}

function rowToRiskDecision(row) {
  return {
    runId: row.run_id,
    decisionTime: toIso(row.decision_time),
    symbol: row.symbol,
    requestedAction: row.requested_action,
    approved: Boolean(row.approved),
    reason: row.reason
  };
}

function rowToOrder(row) {
  return {
    runId: row.run_id,
    broker: row.broker,
    symbol: row.symbol,
    assetClass: row.asset_class,
    side: row.side,
    orderType: row.order_type,
    qty: numberOrNull(row.qty),
    notional: numberOrNull(row.notional),
    filledQty: numberOrNull(row.filled_qty),
    filledAvgPrice: numberOrNull(row.filled_avg_price),
    status: row.status,
    submittedAt: toIso(row.submitted_at),
    updatedAt: toIso(row.updated_at)
  };
}

function rowToFill(row) {
  return {
    brokerFillId: row.broker_fill_id,
    fillTime: toIso(row.fill_time),
    symbol: row.symbol,
    side: row.side,
    qty: numberOrNull(row.qty),
    price: numberOrNull(row.price),
    commission: numberOrNull(row.commission)
  };
}

function rowToPosition(row) {
  return {
    source: row.source,
    snapshotTime: toIso(row.snapshot_time),
    symbol: row.symbol,
    assetClass: row.asset_class,
    qty: numberOrNull(row.qty),
    avgEntryPrice: numberOrNull(row.avg_entry_price),
    marketValue: numberOrNull(row.market_value),
    unrealizedPl: numberOrNull(row.unrealized_pl)
  };
}

function rowToMarketData(row) {
  return {
    source: row.source,
    mode: row.mode,
    symbol: row.symbol,
    assetClass: row.asset_class,
    bars: Number(row.bars || 0),
    latestBarTime: toIso(row.latest_bar_time)
  };
}

function rowToDataQuality(row) {
  return {
    checkTime: toIso(row.check_time),
    symbol: row.symbol,
    primarySource: row.primary_source,
    secondarySource: row.secondary_source,
    closeDiffBps: numberOrNull(row.close_diff_bps),
    status: row.status,
    reasons: parseJson(row.reasons, [])
  };
}

function appendRows(lines, title, rows, formatter) {
  lines.push("");
  lines.push(title);
  if (!rows.length) {
    lines.push("  None yet.");
    return;
  }

  for (const row of rows) {
    lines.push(`  ${formatter(row)}`);
  }
}

function isOpenOrderStatus(status) {
  return ["accepted", "new", "open", "pending_new", "partially_filled"].includes(String(status || "").toLowerCase());
}

function toIso(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function money(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }
  const number = Number(value || 0);
  if (Math.abs(number) >= 100) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}
