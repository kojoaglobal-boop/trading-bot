const POSITIVE_CATALYST_WORDS = [
  "beats",
  "beat",
  "raises",
  "raised",
  "upgrade",
  "upgraded",
  "bullish",
  "record",
  "approval",
  "approved",
  "partnership",
  "contract",
  "launch",
  "buyback",
  "surge",
  "surges",
  "jump",
  "jumps",
  "gain",
  "gains",
  "outperform",
  "outperforms"
];

const NEGATIVE_CATALYST_WORDS = [
  "downgrade",
  "downgraded",
  "bearish",
  "misses",
  "miss",
  "cuts",
  "cut",
  "lawsuit",
  "probe",
  "investigation",
  "recall",
  "plunge",
  "plunges",
  "slump",
  "slumps",
  "falls",
  "drops"
];

export const defaultStockSelectionConfig = {
  enabled: true,
  maxSelectedSymbols: 8,
  minBars: 25,
  momentumLookbackBars: 6,
  trendLookbackBars: 24,
  volumeLookbackBars: 20,
  useFinnhubCatalysts: true,
  maxCatalystSymbols: 8,
  catalystLookbackDays: 3,
  catalystScoreWeight: 1
};

export async function selectStockUniverse({
  symbols,
  barsBySymbol,
  openPositionSymbols = [],
  selection = {},
  newsClient,
  now = new Date()
} = {}) {
  const settings = {
    ...defaultStockSelectionConfig,
    ...(selection || {})
  };
  const scannedSymbols = normalizeSymbols(symbols);
  const openSymbols = normalizeSymbols(openPositionSymbols);

  if (!settings.enabled) {
    return {
      enabled: false,
      scannedSymbols,
      selectedSymbols: scannedSymbols,
      strategySymbols: mergeSymbols(scannedSymbols, openSymbols),
      rankings: [],
      catalystErrors: []
    };
  }

  const technicalRankings = rankStockCandidates({
    symbols: scannedSymbols,
    barsBySymbol,
    selection: settings
  });
  const catalystSymbols = technicalRankings
    .slice(0, Number(settings.maxCatalystSymbols || 0))
    .map((candidate) => candidate.symbol);
  const catalysts = await fetchCatalysts({
    newsClient,
    symbols: settings.useFinnhubCatalysts ? catalystSymbols : [],
    days: Number(settings.catalystLookbackDays || 3),
    now
  });
  const rankings = rankStockCandidates({
    symbols: scannedSymbols,
    barsBySymbol,
    newsBySymbol: catalysts.newsBySymbol,
    selection: settings
  });
  const openSet = new Set(openSymbols);
  const selectedSymbols = rankings
    .filter((candidate) => !openSet.has(candidate.symbol))
    .slice(0, Number(settings.maxSelectedSymbols || defaultStockSelectionConfig.maxSelectedSymbols))
    .map((candidate) => candidate.symbol);

  return {
    enabled: true,
    scannedSymbols,
    selectedSymbols,
    strategySymbols: mergeSymbols(openSymbols, selectedSymbols),
    rankings,
    catalystErrors: catalysts.errors
  };
}

export function rankStockCandidates({
  symbols,
  barsBySymbol,
  newsBySymbol = new Map(),
  selection = {}
} = {}) {
  const settings = {
    ...defaultStockSelectionConfig,
    ...(selection || {})
  };
  const rankings = [];

  for (const symbol of normalizeSymbols(symbols)) {
    const bars = getSymbolBars(barsBySymbol, symbol);
    const candidate = scoreStockCandidate({
      symbol,
      bars,
      news: getSymbolNews(newsBySymbol, symbol),
      selection: settings
    });

    if (candidate) {
      rankings.push(candidate);
    }
  }

  return rankings.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}

export function scoreStockCandidate({
  symbol,
  bars,
  news = [],
  selection = {}
} = {}) {
  const settings = {
    ...defaultStockSelectionConfig,
    ...(selection || {})
  };
  const cleanBars = Array.isArray(bars)
    ? bars.filter((bar) => Number.isFinite(Number(bar.close)) && Number(bar.close) > 0)
    : [];

  if (cleanBars.length < Number(settings.minBars || 1)) {
    return null;
  }

  const latest = cleanBars.at(-1);
  const momentumLookback = Math.min(Number(settings.momentumLookbackBars || 6), cleanBars.length - 1);
  const trendLookback = Math.min(Number(settings.trendLookbackBars || 24), cleanBars.length - 1);
  const volumeLookback = Math.min(Number(settings.volumeLookbackBars || 20), cleanBars.length - 1);
  const momentumBase = cleanBars.at(-momentumLookback - 1);
  const trendBase = cleanBars.at(-trendLookback - 1);
  const priorVolumeBars = cleanBars.slice(-volumeLookback - 1, -1);
  const averageVolume = average(priorVolumeBars.map((bar) => Number(bar.volume || 0)));
  const volumeExpansion = averageVolume > 0
    ? Number(latest.volume || 0) / averageVolume
    : 0;
  const momentumPct = momentumBase
    ? Number(latest.close) / Number(momentumBase.close) - 1
    : 0;
  const trendPct = trendBase
    ? Number(latest.close) / Number(trendBase.close) - 1
    : 0;
  const rangePct = Number(latest.close) > 0
    ? (Number(latest.high || latest.close) - Number(latest.low || latest.close)) / Number(latest.close)
    : 0;
  const dollarVolume = Number(latest.close || 0) * Number(latest.volume || 0);
  const recentBars = cleanBars.slice(-trendLookback);
  const recentHigh = Math.max(...recentBars.map((bar) => Number(bar.high || bar.close)));
  const recentLow = Math.min(...recentBars.map((bar) => Number(bar.low || bar.close)));
  const closePosition = recentHigh > recentLow
    ? (Number(latest.close) - recentLow) / (recentHigh - recentLow)
    : 0.5;
  const catalyst = scoreNewsCatalysts(news);

  const momentumScore = Math.max(0, momentumPct) * 1200;
  const trendScore = Math.max(0, trendPct) * 500;
  const volumeScore = clamp(volumeExpansion, 0, 6) * 8;
  const rangeScore = clamp(rangePct * 100, 0, 8) * 2;
  const liquidityScore = dollarVolume > 0 ? clamp(Math.log10(dollarVolume), 0, 9) : 0;
  const closePositionScore = clamp(closePosition, 0, 1) * 10;
  const negativeMomentumPenalty = momentumPct < -0.005 ? 8 : 0;
  const score = Number((
    momentumScore +
    trendScore +
    volumeScore +
    rangeScore +
    liquidityScore +
    closePositionScore +
    catalyst.score * Number(settings.catalystScoreWeight || 1) -
    negativeMomentumPenalty
  ).toFixed(4));

  return {
    symbol,
    score,
    latestTime: latest.time || latest.t || null,
    close: Number(latest.close),
    momentumPct,
    trendPct,
    rangePct,
    volumeExpansion,
    dollarVolume,
    closePosition,
    catalyst,
    reasons: buildReasons({
      momentumPct,
      trendPct,
      volumeExpansion,
      rangePct,
      catalyst
    })
  };
}

export function scoreNewsCatalysts(news = []) {
  let positive = 0;
  let negative = 0;
  let neutral = 0;

  for (const item of Array.isArray(news) ? news : []) {
    const text = `${item.headline || ""} ${item.summary || ""}`.toLowerCase();
    const hasPositive = POSITIVE_CATALYST_WORDS.some((word) => text.includes(word));
    const hasNegative = NEGATIVE_CATALYST_WORDS.some((word) => text.includes(word));

    if (hasPositive && !hasNegative) {
      positive += 1;
    } else if (hasNegative && !hasPositive) {
      negative += 1;
    } else {
      neutral += 1;
    }
  }

  return {
    newsCount: Array.isArray(news) ? news.length : 0,
    positive,
    negative,
    neutral,
    score: clamp(positive * 6 + neutral * 1.5 - negative * 6, -18, 24)
  };
}

async function fetchCatalysts({
  newsClient,
  symbols,
  days,
  now
}) {
  const newsBySymbol = new Map();
  const errors = [];

  if (!newsClient || typeof newsClient.getCompanyNews !== "function") {
    return { newsBySymbol, errors };
  }

  const to = formatDate(now);
  const from = formatDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));

  for (const symbol of normalizeSymbols(symbols)) {
    try {
      const news = await newsClient.getCompanyNews({ symbol, from, to });
      newsBySymbol.set(symbol, news);
    } catch (error) {
      errors.push({
        symbol,
        reason: error.message
      });
    }
  }

  return { newsBySymbol, errors };
}

function buildReasons({
  momentumPct,
  trendPct,
  volumeExpansion,
  rangePct,
  catalyst
}) {
  const reasons = [];
  reasons.push(`move ${formatPct(momentumPct)}`);
  reasons.push(`trend ${formatPct(trendPct)}`);
  reasons.push(`volume ${volumeExpansion.toFixed(2)}x`);
  reasons.push(`range ${formatPct(rangePct)}`);
  if (catalyst.newsCount) {
    reasons.push(`news ${catalyst.score >= 0 ? "+" : ""}${catalyst.score.toFixed(1)}`);
  }
  return reasons;
}

function getSymbolBars(barsBySymbol, symbol) {
  if (!barsBySymbol) {
    return [];
  }

  if (barsBySymbol instanceof Map) {
    return barsBySymbol.get(symbol) || [];
  }

  return barsBySymbol[symbol] || [];
}

function getSymbolNews(newsBySymbol, symbol) {
  if (!newsBySymbol) {
    return [];
  }

  if (newsBySymbol instanceof Map) {
    return newsBySymbol.get(symbol) || [];
  }

  return newsBySymbol[symbol] || [];
}

function normalizeSymbols(symbols) {
  return String(Array.isArray(symbols) ? symbols.join(",") : symbols)
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function mergeSymbols(primary, secondary) {
  const seen = new Set();
  const merged = [];

  for (const symbol of [...normalizeSymbols(primary), ...normalizeSymbols(secondary)]) {
    if (!seen.has(symbol)) {
      seen.add(symbol);
      merged.push(symbol);
    }
  }

  return merged;
}

function average(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value));
  if (!clean.length) {
    return 0;
  }
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
