import { createDatabasePool, withDatabaseClient } from "./database-client.js";

export async function upsertMarketBars(bars, options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      await client.query("BEGIN");
      try {
        let inserted = 0;
        for (const bar of bars) {
          await client.query(
            `INSERT INTO market_bars (
              source,
              mode,
              symbol,
              asset_class,
              venue,
              bar_time,
              open,
              high,
              low,
              close,
              volume,
              bid,
              ask
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (source, mode, symbol, bar_time) DO UPDATE SET
              open = EXCLUDED.open,
              high = EXCLUDED.high,
              low = EXCLUDED.low,
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              bid = EXCLUDED.bid,
              ask = EXCLUDED.ask`,
            [
              bar.source?.provider || "unknown",
              bar.source?.mode || "unknown",
              bar.symbol,
              bar.assetClass,
              bar.venue || null,
              bar.time,
              numberOrNull(bar.open),
              numberOrNull(bar.high),
              numberOrNull(bar.low),
              numberOrNull(bar.close),
              numberOrNull(bar.volume),
              numberOrNull(bar.bid),
              numberOrNull(bar.ask)
            ]
          );
          inserted += 1;
        }
        await client.query("COMMIT");
        return {
          bars: inserted,
          symbols: [...new Set(bars.map((bar) => bar.symbol))],
          sources: [...new Set(bars.map((bar) => `${bar.source?.provider || "unknown"}:${bar.source?.mode || "unknown"}`))]
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

export async function loadRecentMarketBars({ source, mode, symbols = [], limit = 20, pool = createDatabasePool() } = {}) {
  const shouldClosePool = !arguments[0]?.pool;
  try {
    return await withDatabaseClient(async (client) => {
      const params = [source, mode, limit];
      const symbolFilter = symbols.length
        ? `AND symbol = ANY($4)`
        : "";
      if (symbols.length) {
        params.push(symbols);
      }

      const result = await client.query(
        `SELECT
          source,
          mode,
          symbol,
          asset_class,
          venue,
          bar_time,
          open,
          high,
          low,
          close,
          volume,
          bid,
          ask
        FROM market_bars
        WHERE source = $1
          AND mode = $2
          ${symbolFilter}
        ORDER BY bar_time DESC
        LIMIT $3`,
        params
      );

      return result.rows.map(rowToBar);
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

function rowToBar(row) {
  return {
    time: row.bar_time instanceof Date ? row.bar_time.toISOString() : row.bar_time,
    symbol: row.symbol,
    assetClass: row.asset_class,
    venue: row.venue,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0),
    bid: row.bid === null ? undefined : Number(row.bid),
    ask: row.ask === null ? undefined : Number(row.ask),
    source: {
      provider: row.source,
      mode: row.mode
    }
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
