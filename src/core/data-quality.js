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

export async function runStoredDataQualityCheck({
  symbol = "BTC/USD",
  primarySource = "coinbase",
  secondarySource = "kraken",
  mode = "public-market-data",
  limit = 5,
  pool = createDatabasePool(),
  ...thresholds
} = {}) {
  const shouldClosePool = !arguments[0]?.pool;
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

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
