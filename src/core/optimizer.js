export const defaultMomentumGrid = {
  fastPeriod: [5, 8, 12],
  slowPeriod: [18, 21, 34],
  breakoutLookback: [12, 18, 24],
  minVolumeExpansion: [1, 1.05, 1.15],
  stopLossPct: [0.025, 0.035, 0.05]
};

export function buildParameterSets(grid = defaultMomentumGrid) {
  const entries = Object.entries(grid);
  const sets = [];

  function visit(index, current) {
    if (index === entries.length) {
      if (current.fastPeriod < current.slowPeriod) {
        sets.push({ ...current });
      }
      return;
    }

    const [key, values] = entries[index];
    for (const value of values) {
      current[key] = value;
      visit(index + 1, current);
    }
  }

  visit(0, {});
  return sets;
}

export function runParameterSweep({ bars, createReport, limit = 10, grid = defaultMomentumGrid }) {
  const results = buildParameterSets(grid).map((params) => {
    const report = createReport(bars, params);
    return summarizeResult(params, report);
  });

  results.sort((a, b) => b.score - a.score);

  return {
    tested: results.length,
    top: results.slice(0, limit),
    all: results
  };
}

export function runWalkForwardValidation({
  bars,
  createReport,
  grid = defaultMomentumGrid,
  limit = 10,
  trainPct = 0.65
}) {
  const { trainBars, testBars, splitTime } = splitBarsByTime(bars, trainPct);
  const sweep = runParameterSweep({
    bars: trainBars,
    createReport,
    grid,
    limit
  });

  const tested = sweep.top.map((candidate) => {
    const testReport = createReport(testBars, candidate.params);
    return {
      params: candidate.params,
      train: candidate,
      test: summarizeResult(candidate.params, testReport)
    };
  });

  tested.sort((a, b) => b.test.score - a.test.score);

  return {
    splitTime,
    trainBars: trainBars.length,
    testBars: testBars.length,
    tested: sweep.tested,
    selected: tested[0] || null,
    top: tested
  };
}

export function formatSweepResult(sweep) {
  const lines = [];
  lines.push("Strategy Parameter Sweep");
  lines.push("========================");
  lines.push(`Combinations tested: ${sweep.tested}`);
  lines.push("");
  lines.push("Top Results");

  for (const [index, result] of sweep.top.entries()) {
    lines.push(
      `${String(index + 1).padStart(2)}. score=${result.score.toFixed(4)} return=${pct(result.returnPct)} drawdown=${pct(result.maxDrawdownPct)} trades=${result.closedTrades} win=${pct(result.winRate)} params=${formatParams(result.params)}`
    );
  }

  return lines.join("\n");
}

export function formatWalkForwardResult(result) {
  const lines = [];
  lines.push("Walk-Forward Validation");
  lines.push("=======================");
  lines.push(`Split time: ${result.splitTime}`);
  lines.push(`Train bars: ${result.trainBars}`);
  lines.push(`Test bars:  ${result.testBars}`);
  lines.push(`Combinations tested on train set: ${result.tested}`);

  if (!result.selected) {
    lines.push("No strategy candidates produced a result.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Selected Candidate");
  lines.push(`Params: ${formatParams(result.selected.params)}`);
  lines.push(
    `Train: score=${result.selected.train.score.toFixed(4)} return=${pct(result.selected.train.returnPct)} drawdown=${pct(result.selected.train.maxDrawdownPct)} trades=${result.selected.train.closedTrades}`
  );
  lines.push(
    `Test:  score=${result.selected.test.score.toFixed(4)} return=${pct(result.selected.test.returnPct)} drawdown=${pct(result.selected.test.maxDrawdownPct)} trades=${result.selected.test.closedTrades}`
  );

  lines.push("");
  lines.push("Top Out-of-Sample Results");
  for (const [index, candidate] of result.top.entries()) {
    lines.push(
      `${String(index + 1).padStart(2)}. testScore=${candidate.test.score.toFixed(4)} testReturn=${pct(candidate.test.returnPct)} testDrawdown=${pct(candidate.test.maxDrawdownPct)} params=${formatParams(candidate.params)}`
    );
  }

  return lines.join("\n");
}

function summarizeResult(params, report) {
  const maxDrawdownPct = report.metrics.maxDrawdownPct;
  const returnPct = report.account.returnPct;
  const closedTrades = report.metrics.closedTrades;
  const score = returnPct - maxDrawdownPct * 1.5 - penaltyForThinTrades(closedTrades);

  return {
    params,
    score,
    returnPct,
    maxDrawdownPct,
    finalEquity: report.account.finalEquity,
    closedTrades,
    winRate: report.metrics.winRate,
    profitFactor: report.metrics.profitFactor
  };
}

function splitBarsByTime(bars, trainPct) {
  const times = [...new Set(bars.map((bar) => bar.time))].sort();
  const splitIndex = Math.max(1, Math.min(times.length - 1, Math.floor(times.length * trainPct)));
  const splitTime = times[splitIndex];
  const trainTimeSet = new Set(times.slice(0, splitIndex));

  return {
    splitTime,
    trainBars: bars.filter((bar) => trainTimeSet.has(bar.time)),
    testBars: bars.filter((bar) => !trainTimeSet.has(bar.time))
  };
}

function penaltyForThinTrades(closedTrades) {
  if (closedTrades >= 8) return 0;
  return (8 - closedTrades) * 0.015;
}

function formatParams(params) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}
