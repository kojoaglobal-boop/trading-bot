import { createDatabasePool, withDatabaseClient } from "./database-client.js";
import { loadRecentMarketBars } from "./database-market-data.js";

export function compareLatestBars({
  symbol,
  primaryBars,
  secondaryBars,
  primarySource = "coinbase",
  secondarySource = "kraken",
  maxCloseDiffBps = 35,
  warnCloseDiffBps = 15,
  maxTimeDiffSeconds = 3900,
  maxStaleSeconds = 7200,
  now = new Date()
}) {
  const primary = latestBar(primaryBars);
  const secondary = latestBar(secondaryBars);
  const reasons = [];

  if (!primary) {
    reasons.push(`missing primary source ${primarySource}`);
  }
  if (!secondary) {
    reasons.push(`missing secondary source ${secondarySource}`);
  }

  let closeDiffBps = null;
  let timeDiffSeconds = null;

  if (primary && secondary) {
    closeDiffBps = calculateCloseDiffBps(primary.close, secondary.close);
    timeDiffSeconds = Math.abs((Date.parse(primary.time) - Date.parse(secondary.time)) / 1000);

    if (timeDiffSeconds > maxTimeDiffSeconds) {
      reasons.push(`source timestamps differ by ${Math.round(timeDiffSeconds)}s`);
    }

    const primaryStaleSeconds = (now.getTime() - Date.parse(primary.time)) / 1000;
    const secondaryStaleSeconds = (now.getTime() - Date.parse(secondary.time)) / 1000;
    if (primaryStaleSeconds > maxStaleSeconds) {
      reasons.push(`${primarySource} stale by ${Math.round(primaryStaleSeconds)}s`);
    }
    if (secondaryStaleSeconds > maxStaleSeconds) {
      reasons.push(`${secondarySource} stale by ${Math.round(secondaryStaleSeconds)}s`);
    }

    if (closeDiffBps > maxCloseDiffBps) {
      reasons.push(`close difference ${closeDiffBps.toFixed(2)} bps > ${maxCloseDiffBps} bps`);
    } else if (closeDiffBps > warnCloseDiffBps) {
      reasons.push(`close difference ${closeDiffBps.toFixed(2)} bps > warning ${warnCloseDiffBps} bps`);
    }
  }

  const hardFailure = reasons.some((reason) => (
    reason.startsWith("missing") ||
    reason.includes("stale") ||
    reason.includes(`> ${maxCloseDiffBps} bps`) ||
    reason.includes("timestamps differ")
  ));
  const status = hardFailure ? "fail" : reasons.length ? "warn" : "pass";

  return {
    symbol,
    primarySource,
    secondarySource,
    primary,
    secondary,
    closeDiffBps,
    timeDiffSeconds,
    status,
    reasons,
    checkedAt: now.toISOString()
  };
}

export async function runStoredDataQualityCheck(options = {}) {
  const {
    symbol = "BTC/USD",
    primarySource = "coinbase",
    secondarySource = "kraken",
    mode = "public-market-data",
    limit = 5,
    pool = createDatabasePool(),
    ...thresholds
  } = options;
  const shouldClosePool = !options.pool;
  try {
    const [primaryBars, secondaryBars] = await Promise.all([
      loadRecentMarketBars({
        source: primarySource,
        mode,
        symbols: [symbol],
        limit,
        pool
      }),
      loadRecentMarketBars({
        source: secondarySource,
        mode,
        symbols: [symbol],
        limit,
        pool
      })
    ]);

    return compareLatestBars({
      symbol,
      primaryBars,
      secondaryBars,
      primarySource,
      secondarySource,
      ...thresholds
    });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export async function loadLatestDataQualityCheck(options = {}) {
  const {
    symbol = "BTC/USD",
    primarySource = "coinbase",
    secondarySource = "kraken",
    pool = createDatabasePool()
  } = options;
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      const result = await client.query(
        `SELECT
          check_time,
          symbol,
          primary_source,
          secondary_source,
          primary_bar_time,
          secondary_bar_time,
          primary_close,
          secondary_close,
          close_diff_bps,
          time_diff_seconds,
          status,
          reasons,
          raw
        FROM data_quality_checks
        WHERE symbol = $1
          AND primary_source = $2
          AND secondary_source = $3
        ORDER BY check_time DESC
        LIMIT 1`,
        [symbol, primarySource, secondarySource]
      );

      return result.rows[0] ? rowToDataQualityCheck(result.rows[0]) : null;
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export async function requireStoredDataQualityPass(options = {}) {
  const {
    symbol = "BTC/USD",
    primarySource = "coinbase",
    secondarySource = "kraken",
    maxAgeSeconds = 7200,
    now = new Date()
  } = options;
  const check = await loadLatestDataQualityCheck(options);

  if (!check) {
    throw new Error(`No stored data-quality check found for ${symbol} (${primarySource}/${secondarySource}). Run: node src/cli.js crypto quality --symbol ${symbol} --db`);
  }

  if (check.status !== "pass") {
    const reasons = check.reasons.length ? `: ${check.reasons.join("; ")}` : "";
    throw new Error(`Latest data-quality check for ${symbol} is ${check.status.toUpperCase()}${reasons}.`);
  }

  const ageSeconds = (now.getTime() - Date.parse(check.checkedAt)) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    throw new Error(`Latest data-quality check for ${symbol} is stale by ${Math.round(ageSeconds)}s. Run: node src/cli.js crypto quality --symbol ${symbol} --db`);
  }

  return check;
}

export async function writeDataQualityCheck(check, options = {}) {
  const pool = options.pool || createDatabasePool();
  const shouldClosePool = !options.pool;

  try {
    return await withDatabaseClient(async (client) => {
      await client.query(
        `INSERT INTO data_quality_checks (
          check_time,
          symbol,
          primary_source,
          secondary_source,
          primary_bar_time,
          secondary_bar_time,
          primary_close,
          secondary_close,
          close_diff_bps,
          time_diff_seconds,
          status,
          reasons,
          raw
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          check.checkedAt,
          check.symbol,
          check.primarySource,
          check.secondarySource,
          check.primary?.time || null,
          check.secondary?.time || null,
          numberOrNull(check.primary?.close),
          numberOrNull(check.secondary?.close),
          numberOrNull(check.closeDiffBps),
          check.timeDiffSeconds === null ? null : Math.round(check.timeDiffSeconds),
          check.status,
          JSON.stringify(check.reasons),
          JSON.stringify(check)
        ]
      );

      return {
        symbol: check.symbol,
        status: check.status,
        reasons: check.reasons.length
      };
    }, { pool });
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}

export function formatDataQualityCheck(check) {
  const lines = [];
  lines.push("Market Data Quality Check");
  lines.push("=========================");
  lines.push(`Symbol:       ${check.symbol}`);
  lines.push(`Status:       ${check.status.toUpperCase()}`);
  lines.push(`Primary:      ${check.primarySource} ${formatBar(check.primary)}`);
  lines.push(`Secondary:    ${check.secondarySource} ${formatBar(check.secondary)}`);
  lines.push(`Close diff:   ${check.closeDiffBps === null ? "n/a" : `${check.closeDiffBps.toFixed(2)} bps`}`);
  lines.push(`Time diff:    ${check.timeDiffSeconds === null ? "n/a" : `${Math.round(check.timeDiffSeconds)}s`}`);

  if (check.reasons.length) {
    lines.push("");
    lines.push("Reasons");
    for (const reason of check.reasons) {
      lines.push(`  ${reason}`);
    }
  }

  return lines.join("\n");
}

function latestBar(bars) {
  if (!bars?.length) {
    return null;
  }
  return [...bars].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
}

function calculateCloseDiffBps(primaryClose, secondaryClose) {
  const primary = Number(primaryClose);
  const secondary = Number(secondaryClose);
  const mid = (primary + secondary) / 2;
  if (!Number.isFinite(primary) || !Number.isFinite(secondary) || mid <= 0) {
    return Infinity;
  }
  return (Math.abs(primary - secondary) / mid) * 10000;
}

function formatBar(bar) {
  if (!bar) {
    return "missing";
  }
  return `time=${bar.time} close=$${Number(bar.close).toFixed(2)}`;
}

function rowToDataQualityCheck(row) {
  const raw = parseJson(row.raw, {});
  const reasons = parseJson(row.reasons, []);

  return {
    ...raw,
    symbol: row.symbol,
    primarySource: row.primary_source,
    secondarySource: row.secondary_source,
    primary: raw.primary || (row.primary_bar_time ? {
      time: toIso(row.primary_bar_time),
      close: row.primary_close === null ? undefined : Number(row.primary_close)
    } : null),
    secondary: raw.secondary || (row.secondary_bar_time ? {
      time: toIso(row.secondary_bar_time),
      close: row.secondary_close === null ? undefined : Number(row.secondary_close)
    } : null),
    closeDiffBps: row.close_diff_bps === null ? null : Number(row.close_diff_bps),
    timeDiffSeconds: row.time_diff_seconds === null ? null : Number(row.time_diff_seconds),
    status: row.status,
    reasons,
    checkedAt: toIso(row.check_time)
  };
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function toIso(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
