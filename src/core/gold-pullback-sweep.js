import { loadMarketBars } from "./database-market-data.js";
import { runGoldPaperCycle } from "./gold-paper-cycle.js";

const DEFAULT_GRID = {
  targetRR: [1.2, 1.5, 2],
  touchAtrMultiple: [0.25, 0.5, 0.75, 1],
  stopAtrMultiple: [1, 1.5, 2],
  maxHoldBars: [12, 24],
  minAtrPct: [0.00015, 0.0002]
};

export async function runGoldPullbackSweep({
  bars,
  source = "capital",
  mode = "demo-market-data",
  symbol = "XAU/USD",
  limit = 1000,
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
      strategy: "pullback",
      writeDatabase: false,
      ...candidate
    });
    const validation = await validateSplits({
      bars: inputBars,
      source,
      candidate
    });

    results.push({
      candidate,
      validation,
      score: scoreCycle(cycle, validation),
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

export function formatGoldPullbackSweep(sweep) {
  const lines = [];
  lines.push("Gold Pullback Sweep");
  lines.push("===================");
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
      `${String(index + 1).padStart(2)}. score=${result.score.toFixed(2)} pnl=${money(result.netPnl)} win=${pct(result.winRate)} pf=${formatRatio(result.profitFactor)} dd=${pct(result.maxDrawdownPct)} trades=${result.closedTrades} split=${formatSplitSummary(result.validation)} rr=${result.candidate.targetRR} touch=${result.candidate.touchAtrMultiple} stop=${result.candidate.stopAtrMultiple} hold=${result.candidate.maxHoldBars} minAtr=${result.candidate.minAtrPct}`
    );
  });

  return lines.join("\n");
}

async function validateSplits({ bars, source, candidate }) {
  if (bars.length < 240) {
    return {
      segments: [],
      positiveSegments: 0,
      reason: "not enough bars for split validation"
    };
  }

  const midpoint = Math.floor(bars.length / 2);
  const windows = [
    ["first-half", bars.slice(0, midpoint)],
    ["second-half", bars.slice(midpoint)],
    ["latest-300", bars.slice(-Math.min(300, bars.length))]
  ];
  const segments = [];

  for (const [label, segmentBars] of windows) {
    const cycle = await runGoldPaperCycle({
      bars: segmentBars,
      provider: source,
      strategy: "pullback",
      writeDatabase: false,
      ...candidate
    });
    segments.push({
      label,
      bars: segmentBars.length,
      netPnl: cycle.report.account.netPnl,
      closedTrades: cycle.report.metrics.closedTrades,
      winRate: cycle.report.metrics.winRate,
      profitFactor: cycle.report.metrics.profitFactor,
      maxDrawdownPct: cycle.report.metrics.maxDrawdownPct
    });
  }

  return {
    segments,
    positiveSegments: segments.filter((segment) => segment.netPnl > 0).length,
    reason: "validated on first half, second half, and latest window"
  };
}

function qualifyCandidate(candidate) {
  if (!candidate) {
    return {
      status: "NOT QUALIFIED",
      reason: "No candidates were tested."
    };
  }

  if (candidate.closedTrades < 10) {
    return {
      status: "NOT QUALIFIED",
      reason: `Too few closed trades (${candidate.closedTrades} < 10).`
    };
  }

  if (candidate.netPnl <= 0) {
    return {
      status: "NOT QUALIFIED",
      reason: `Best candidate is still losing (${money(candidate.netPnl)}).`
    };
  }

  if (candidate.winRate < 0.45) {
    return {
      status: "NOT QUALIFIED",
      reason: `Win rate too weak (${pct(candidate.winRate)} < 45.00%).`
    };
  }

  if (candidate.profitFactor < 1.25) {
    return {
      status: "NOT QUALIFIED",
      reason: `Profit factor too weak (${formatRatio(candidate.profitFactor)} < 1.25).`
    };
  }

  if (candidate.maxDrawdownPct > 0.04) {
    return {
      status: "NOT QUALIFIED",
      reason: `Drawdown too high (${pct(candidate.maxDrawdownPct)} > 4.00%).`
    };
  }

  if (candidate.validation.segments.length && candidate.validation.positiveSegments < 2) {
    return {
      status: "NOT QUALIFIED",
      reason: `Split validation too weak (${candidate.validation.positiveSegments}/${candidate.validation.segments.length} profitable windows).`
    };
  }

  return {
    status: "QUALIFIED FOR PAPER WATCHLIST",
    reason: "Best candidate passed trade count, P/L, win-rate, profit-factor, drawdown, and split-validation gates."
  };
}

function buildCandidates(grid) {
  const candidates = [];
  for (const targetRR of grid.targetRR) {
    for (const touchAtrMultiple of grid.touchAtrMultiple) {
      for (const stopAtrMultiple of grid.stopAtrMultiple) {
        for (const maxHoldBars of grid.maxHoldBars) {
          for (const minAtrPct of grid.minAtrPct) {
            candidates.push({
              targetRR,
              touchAtrMultiple,
              stopAtrMultiple,
              maxHoldBars,
              minAtrPct
            });
          }
        }
      }
    }
  }
  return candidates;
}

function scoreCycle(cycle, validation) {
  const metrics = cycle.report.metrics;
  const pnl = cycle.report.account.netPnl;
  const drawdownPenalty = metrics.maxDrawdownPct * 120;
  const noTradePenalty = metrics.closedTrades === 0 ? 12 : 0;
  const lowTradePenalty = metrics.closedTrades > 0 && metrics.closedTrades < 10 ? 4 : 0;
  const profitFactorScore = metrics.profitFactor === Infinity
    ? 8
    : Math.min(metrics.profitFactor, 5) * 1.5;
  const splitPenalty = validation.segments.length
    ? (validation.segments.length - validation.positiveSegments) * 5
    : 0;

  return pnl + profitFactorScore + metrics.winRate * 4 + metrics.expectancyPerTrade - drawdownPenalty - noTradePenalty - lowTradePenalty - splitPenalty;
}

function formatSplitSummary(validation) {
  if (!validation.segments.length) {
    return "n/a";
  }
  return validation.segments
    .map((segment) => `${segment.label}:${money(segment.netPnl)}`)
    .join("/");
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
