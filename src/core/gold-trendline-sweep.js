import { loadMarketBars } from "./database-market-data.js";
import { runGoldPaperCycle } from "./gold-paper-cycle.js";

const DEFAULT_GRID = {
  targetRR: [1.2, 1.3, 1.6],
  touchAtrMultiple: [0.45, 0.55, 0.7],
  entryAtrMultiple: [1.0, 1.2],
  minAtrPct: [0.0002, 0.0005],
  maxTrendlineViolations: [1, 2]
};

export async function runGoldTrendlineSweep({
  bars,
  source = "capital",
  mode = "demo-market-data",
  symbol = "XAU/USD",
  limit = 300,
  grid = DEFAULT_GRID,
  maxResults = 12
} = {}) {
  const inputBars = bars || await loadMarketBars({
    source,
    mode,
    symbols: [symbol],
    limit
  });

  if (!inputBars.length) {
    throw new Error(`No stored Gold bars found for source=${source} mode=${mode} symbol=${symbol}. Run capital prices first.`);
  }

  const candidates = buildCandidates(grid);
  const results = [];

  for (const candidate of candidates) {
    const cycle = await runGoldPaperCycle({
      bars: inputBars,
      provider: source,
      strategy: "trendline",
      writeDatabase: false,
      ...candidate
    });
    results.push({
      candidate,
      score: scoreCycle(cycle),
      netPnl: cycle.report.account.netPnl,
      returnPct: cycle.report.account.returnPct,
      decisions: cycle.report.metrics.decisions,
      fills: cycle.report.metrics.fills,
      closedTrades: cycle.report.metrics.closedTrades,
      winRate: cycle.report.metrics.winRate,
      profitFactor: cycle.report.metrics.profitFactor,
      maxDrawdownPct: cycle.report.metrics.maxDrawdownPct,
      expectancyPerTrade: cycle.report.metrics.expectancyPerTrade
    });
  }

  const ranked = results
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
  const best = ranked[0] || null;
  const qualification = qualifyCandidate(best);

  return {
    source,
    mode,
    symbol,
    bars: inputBars.length,
    tested: candidates.length,
    qualification,
    ranked
  };
}

export function formatGoldTrendlineSweep(sweep) {
  const lines = [];
  lines.push("Gold Trendline Sweep");
  lines.push("====================");
  lines.push(`Source:  ${sweep.source}:${sweep.mode}`);
  lines.push(`Symbol:  ${sweep.symbol}`);
  lines.push(`Bars:    ${sweep.bars}`);
  lines.push(`Tested:  ${sweep.tested}`);
  lines.push(`Status:  ${sweep.qualification.status}`);
  lines.push(`Reason:  ${sweep.qualification.reason}`);

  if (!sweep.ranked.length) {
    lines.push("No candidates produced results.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Top Candidates");
  sweep.ranked.forEach((result, index) => {
    lines.push(
      `${String(index + 1).padStart(2)}. score=${result.score.toFixed(2)} pnl=${money(result.netPnl)} win=${pct(result.winRate)} pf=${formatRatio(result.profitFactor)} dd=${pct(result.maxDrawdownPct)} trades=${result.closedTrades} rr=${result.candidate.targetRR} touch=${result.candidate.touchAtrMultiple} entry=${result.candidate.entryAtrMultiple} minAtr=${result.candidate.minAtrPct} viol=${result.candidate.maxTrendlineViolations}`
    );
  });

  return lines.join("\n");
}

function qualifyCandidate(candidate) {
  if (!candidate) {
    return {
      status: "NOT QUALIFIED",
      reason: "No candidates were tested."
    };
  }

  if (candidate.closedTrades < 5) {
    return {
      status: "NOT QUALIFIED",
      reason: `Too few closed trades (${candidate.closedTrades} < 5).`
    };
  }

  if (candidate.netPnl <= 0) {
    return {
      status: "NOT QUALIFIED",
      reason: `Best candidate is still losing (${money(candidate.netPnl)}).`
    };
  }

  if (candidate.profitFactor < 1.1) {
    return {
      status: "NOT QUALIFIED",
      reason: `Profit factor too weak (${formatRatio(candidate.profitFactor)} < 1.10).`
    };
  }

  if (candidate.maxDrawdownPct > 0.03) {
    return {
      status: "NOT QUALIFIED",
      reason: `Drawdown too high (${pct(candidate.maxDrawdownPct)} > 3.00%).`
    };
  }

  return {
    status: "QUALIFIED FOR PAPER WATCHLIST",
    reason: "Best candidate passed minimum trade count, P/L, profit factor, and drawdown gates."
  };
}

function buildCandidates(grid) {
  const candidates = [];
  for (const targetRR of grid.targetRR) {
    for (const touchAtrMultiple of grid.touchAtrMultiple) {
      for (const entryAtrMultiple of grid.entryAtrMultiple) {
        for (const minAtrPct of grid.minAtrPct) {
          for (const maxTrendlineViolations of grid.maxTrendlineViolations) {
            candidates.push({
              targetRR,
              touchAtrMultiple,
              entryAtrMultiple,
              minAtrPct,
              maxTrendlineViolations
            });
          }
        }
      }
    }
  }
  return candidates;
}

function scoreCycle(cycle) {
  const metrics = cycle.report.metrics;
  const pnl = cycle.report.account.netPnl;
  const drawdownPenalty = metrics.maxDrawdownPct * 100;
  const noTradePenalty = metrics.closedTrades === 0 ? 5 : 0;
  const lowTradePenalty = metrics.closedTrades > 0 && metrics.closedTrades < 2 ? 1.5 : 0;
  const profitFactorScore = metrics.profitFactor === Infinity
    ? 4
    : Math.min(metrics.profitFactor, 4);

  return pnl + profitFactorScore + metrics.winRate * 2 + metrics.expectancyPerTrade - drawdownPenalty - noTradePenalty - lowTradePenalty;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatRatio(value) {
  return value === Infinity ? "Infinity" : Number(value || 0).toFixed(2);
}
