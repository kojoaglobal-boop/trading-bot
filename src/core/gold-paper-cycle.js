import { defaultConfig } from "../config/default.js";
import { GoldPullbackStrategy } from "../strategies/gold-pullback.js";
import { GoldTrendlineStrategy } from "../strategies/gold-trendline.js";
import { MomentumBreakoutStrategy } from "../strategies/momentum-breakout.js";
import { createAuditRecord } from "./audit-log.js";
import { runBacktest } from "./backtester.js";
import { fetchCapitalPrices } from "./capital-market-data.js";
import { writeAuditToDatabase } from "./database-journal.js";
import { upsertMarketBars } from "./database-market-data.js";
import { createSampleBars } from "./market-data.js";
import { fetchOandaCandles } from "./oanda-market-data.js";
import { PaperBroker } from "./paper-broker.js";
import { Portfolio } from "./portfolio.js";
import { RiskEngine } from "./risk-engine.js";

export async function runGoldPaperCycle(options = {}) {
  const provider = options.sample ? "sample" : String(options.provider || "oanda").trim().toLowerCase();
  const strategyName = String(options.strategy || "momentum").trim().toLowerCase();
  const mode = `gold-paper-${provider}`;
  const instrument = String(options.instrument || options.epic || defaultInstrumentForProvider(provider)).trim().toUpperCase();
  const granularity = String(options.granularity || options.resolution || "M5").trim().toUpperCase();
  const count = Number(options.count || 300);
  const writeDatabase = options.writeDatabase ?? true;
  const now = options.now || new Date();
  const bars = options.bars || await loadGoldBars({
    sample: Boolean(options.sample),
    provider,
    instrument,
    granularity,
    count,
    seed: Number(options.seed || 42),
    client: options.client,
    capitalClient: options.capitalClient,
    symbol: options.symbol
  });

  const report = runBacktest({
    bars,
    broker: new PaperBroker(createGoldExecutionConfig(options, provider)),
    config: defaultConfig,
    mode,
    portfolio: new Portfolio({ startingCash: defaultConfig.account.startingCash }),
    riskEngine: new RiskEngine(createGoldRiskConfig(options)),
    strategy: createGoldStrategy(strategyName, options)
  });
  const audit = createAuditRecord(report, now);
  const storedBars = writeDatabase ? await upsertMarketBars(bars) : null;
  const storedAudit = writeDatabase ? await writeAuditToDatabase(audit) : null;

  return {
    cycleId: audit.runId,
    createdAt: audit.createdAt,
    mode,
    instrument,
    granularity,
    strategy: strategyName,
    count,
    writeDatabase: Boolean(writeDatabase),
    bars,
    report,
    audit,
    storedBars,
    storedAudit
  };
}

export function formatGoldPaperCycle(cycle) {
  const { report } = cycle;
  const lines = [];

  lines.push("Gold/USD Paper Cycle");
  lines.push("====================");
  lines.push(`Cycle ID:      ${cycle.cycleId}`);
  lines.push(`Mode:          ${cycle.mode}`);
  lines.push(`Instrument:    ${cycle.instrument.replace("_", "/")}`);
  lines.push(`Granularity:   ${cycle.granularity}`);
  lines.push(`Strategy:      ${cycle.strategy}`);
  lines.push(`Bars:          ${report.metrics.bars}`);
  lines.push(`Starting:      ${money(report.account.startingCash)}`);
  lines.push(`Final equity:  ${money(report.account.finalEquity)}`);
  lines.push(`Net P/L:       ${money(report.account.netPnl)} (${pct(report.account.returnPct)})`);
  lines.push(`Decisions:     ${report.metrics.decisions}`);
  lines.push(`Fills:         ${report.metrics.fills}`);
  lines.push(`Closed trades: ${report.metrics.closedTrades}`);
  lines.push(`Win rate:      ${pct(report.metrics.winRate)}`);
  lines.push(`Profit factor: ${formatRatio(report.metrics.profitFactor)}`);
  lines.push(`Max drawdown:  ${pct(report.metrics.maxDrawdownPct)}`);

  if (cycle.storedBars) {
    lines.push(`DB bars:       ${cycle.storedBars.bars} ${cycle.storedBars.symbols.join(", ")} from ${cycle.storedBars.sources.join(", ")}`);
  }

  if (cycle.storedAudit) {
    lines.push(`DB audit:      ${cycle.storedAudit.runId} (${cycle.storedAudit.fills} fills, ${cycle.storedAudit.rejections} rejections)`);
  }

  if (report.positions.length) {
    lines.push("");
    lines.push("Open Positions");
    for (const position of report.positions) {
      lines.push(`  ${position.symbol.padEnd(8)} qty=${formatNumber(position.quantity)} value=${money(position.marketValue)}`);
    }
  }

  if (report.fills.length) {
    lines.push("");
    lines.push("Recent Fills");
    for (const fill of report.fills.slice(-8)) {
      lines.push(
        `  ${fill.time} ${fill.side.padEnd(4)} ${fill.symbol.padEnd(8)} qty=${formatNumber(fill.quantity)} price=${money(fill.price)} reason=${fill.reason || ""}`
      );
    }
  }

  if (report.rejections.length) {
    lines.push("");
    lines.push("Recent Rejections");
    for (const rejection of report.rejections.slice(-8)) {
      lines.push(`  ${rejection.time} ${rejection.action.padEnd(4)} ${rejection.symbol.padEnd(8)} ${rejection.reason}`);
    }
  }

  return lines.join("\n");
}

async function loadGoldBars({
  sample,
  provider,
  instrument,
  granularity,
  count,
  seed,
  client,
  capitalClient,
  symbol
}) {
  if (sample) {
    return createSampleBars({
      symbols: [{
        symbol: "XAU/USD",
        assetClass: "gold",
        venue: "gold-paper-sim"
      }],
      barsPerSymbol: count,
      seed
    });
  }

  if (provider === "capital") {
    const result = await fetchCapitalPrices({
      epic: instrument,
      resolution: granularity,
      count,
      symbol: symbol || "XAU/USD",
      client: capitalClient || client
    });
    return result.bars;
  }

  const result = await fetchOandaCandles({
    instrument,
    granularity,
    count,
    price: "BA",
    client
  });
  return result.bars;
}

function defaultInstrumentForProvider(provider) {
  return provider === "capital" ? "GOLD" : "XAU_USD";
}

function createGoldStrategy(strategyName, options) {
  if (strategyName === "pullback") {
    return new GoldPullbackStrategy(createGoldPullbackStrategyConfig(options));
  }

  if (strategyName === "trendline") {
    return new GoldTrendlineStrategy(createGoldTrendlineStrategyConfig(options));
  }

  return new MomentumBreakoutStrategy(createGoldMomentumStrategyConfig(options));
}

function createGoldMomentumStrategyConfig(options) {
  return {
    ...defaultConfig.strategy.momentumBreakout,
    fastPeriod: Number(options.fastPeriod || options["fast-period"] || 5),
    slowPeriod: Number(options.slowPeriod || options["slow-period"] || 13),
    breakoutLookback: Number(options.breakoutLookback || options["breakout-lookback"] || 12),
    minVolumeExpansion: Number(options.minVolumeExpansion || options["min-volume-expansion"] || 0.85),
    stopLossPct: Number(options.stopLossPct || options["stop-loss-pct"] || 0.004),
    takeProfitRR: Number(options.targetRewardRiskRatio || options.targetRR || options["target-rr"] || 1.6)
  };
}

function createGoldPullbackStrategyConfig(options) {
  const defaults = defaultConfig.strategy.goldPullback;
  return {
    ...defaults,
    fastPeriod: numberOption(options, ["fastPeriod", "fast-period"], defaults.fastPeriod),
    pullbackPeriod: numberOption(options, ["pullbackPeriod", "pullback-period"], defaults.pullbackPeriod),
    trendPeriod: numberOption(options, ["trendPeriod", "trend-period"], defaults.trendPeriod),
    atrPeriod: numberOption(options, ["atrPeriod", "atr-period"], defaults.atrPeriod),
    trendSlopeBars: numberOption(options, ["trendSlopeBars", "trend-slope-bars"], defaults.trendSlopeBars),
    touchAtrMultiple: numberOption(options, ["touchAtrMultiple", "touch-atr-multiple"], defaults.touchAtrMultiple),
    stopAtrMultiple: numberOption(options, ["stopAtrMultiple", "stop-atr-multiple"], defaults.stopAtrMultiple),
    takeProfitRR: numberOption(options, ["targetRewardRiskRatio", "targetRR", "target-rr"], defaults.takeProfitRR),
    maxHoldBars: numberOption(options, ["maxHoldBars", "max-hold-bars"], defaults.maxHoldBars),
    minAtrPct: numberOption(options, ["minAtrPct", "min-atr-pct"], defaults.minAtrPct),
    maxAtrPct: numberOption(options, ["maxAtrPct", "max-atr-pct"], defaults.maxAtrPct),
    sessionUtcStartHour: numberOption(options, ["sessionUtcStartHour", "session-utc-start-hour"], defaults.sessionUtcStartHour),
    sessionUtcEndHour: numberOption(options, ["sessionUtcEndHour", "session-utc-end-hour"], defaults.sessionUtcEndHour)
  };
}

function createGoldTrendlineStrategyConfig(options) {
  return {
    ...defaultConfig.strategy.goldTrendline,
    fastBiasPeriod: Number(options.fastBiasPeriod || options["fast-bias-period"] || defaultConfig.strategy.goldTrendline.fastBiasPeriod),
    slowBiasPeriod: Number(options.slowBiasPeriod || options["slow-bias-period"] || defaultConfig.strategy.goldTrendline.slowBiasPeriod),
    pivotDepth: Number(options.pivotDepth || options["pivot-depth"] || defaultConfig.strategy.goldTrendline.pivotDepth),
    trendlineLookback: Number(options.trendlineLookback || options["trendline-lookback"] || defaultConfig.strategy.goldTrendline.trendlineLookback),
    minTrendlineTouches: Number(options.minTrendlineTouches || options["min-trendline-touches"] || defaultConfig.strategy.goldTrendline.minTrendlineTouches),
    maxTrendlineViolations: Number(options.maxTrendlineViolations || options["max-trendline-violations"] || defaultConfig.strategy.goldTrendline.maxTrendlineViolations),
    touchAtrMultiple: Number(options.touchAtrMultiple || options["touch-atr-multiple"] || defaultConfig.strategy.goldTrendline.touchAtrMultiple),
    entryAtrMultiple: Number(options.entryAtrMultiple || options["entry-atr-multiple"] || defaultConfig.strategy.goldTrendline.entryAtrMultiple),
    stopAtrMultiple: Number(options.stopAtrMultiple || options["stop-atr-multiple"] || defaultConfig.strategy.goldTrendline.stopAtrMultiple),
    takeProfitRR: Number(options.targetRewardRiskRatio || options.targetRR || options["target-rr"] || defaultConfig.strategy.goldTrendline.takeProfitRR),
    minAtrPct: Number(options.minAtrPct || options["min-atr-pct"] || defaultConfig.strategy.goldTrendline.minAtrPct),
    maxAtrPct: Number(options.maxAtrPct || options["max-atr-pct"] || defaultConfig.strategy.goldTrendline.maxAtrPct),
    sessionUtcStartHour: Number(options.sessionUtcStartHour || options["session-utc-start-hour"] || defaultConfig.strategy.goldTrendline.sessionUtcStartHour),
    sessionUtcEndHour: Number(options.sessionUtcEndHour || options["session-utc-end-hour"] || defaultConfig.strategy.goldTrendline.sessionUtcEndHour)
  };
}

function createGoldRiskConfig(options) {
  const strategyName = String(options.strategy || "").toLowerCase();
  const provider = String(options.provider || "").toLowerCase();
  const capitalPullbackPaper = provider === "capital" && strategyName === "pullback";
  const defaultMaxNotionalPct = capitalPullbackPaper ? 2 : 0.35;
  const defaultGoldExposurePct = capitalPullbackPaper ? 2 : 0.45;
  const defaultGrossLeverage = capitalPullbackPaper ? 3 : defaultConfig.risk.maxGrossLeverage.gold;

  return {
    ...defaultConfig.risk,
    maxOpenPositions: Number(options.maxOpenPositions || options["max-open-positions"] || 1),
    maxRiskPerTradePct: numberOption(options, ["maxRiskPerTradePct", "max-risk-pct"], capitalPullbackPaper ? 0.04 : 0.015),
    maxNotionalPerTradePct: numberOption(options, ["maxNotionalPerTradePct", "max-notional-pct"], defaultMaxNotionalPct),
    maxAssetClassExposurePct: {
      ...defaultConfig.risk.maxAssetClassExposurePct,
      gold: numberOption(options, ["maxGoldExposurePct", "max-gold-exposure-pct"], defaultGoldExposurePct)
    },
    allowShorts: {
      ...defaultConfig.risk.allowShorts,
      gold: ["trendline", "pullback"].includes(strategyName)
    },
    maxGrossLeverage: {
      ...defaultConfig.risk.maxGrossLeverage,
      gold: numberOption(options, ["maxGrossLeverage", "max-gross-leverage"], defaultGrossLeverage)
    },
    maxSpreadBps: {
      ...defaultConfig.risk.maxSpreadBps,
      gold: Number(options.maxSpreadBps || options["max-spread-bps"] || 12)
    },
    minVolume: {
      ...defaultConfig.risk.minVolume,
      gold: Number(options.minVolume || options["min-volume"] || 1)
    },
    targetRiskPerTradeDollars: numberOption(options, ["targetRiskDollars", "target-risk-dollars"], 0),
    targetRewardRiskRatio: Number(options.targetRewardRiskRatio || options.targetRR || options["target-rr"] || 1.6)
  };
}

function createGoldExecutionConfig(options, provider) {
  const defaults = provider === "capital"
    ? {
        ...defaultConfig.execution.paper,
        ...defaultConfig.execution.goldCapitalPaper,
        slippageBps: {
          ...defaultConfig.execution.paper.slippageBps,
          ...defaultConfig.execution.goldCapitalPaper.slippageBps
        }
      }
    : defaultConfig.execution.paper;

  return {
    ...defaults,
    commissionBps: numberOption(options, ["commissionBps", "commission-bps"], defaults.commissionBps),
    minCommission: numberOption(options, ["minCommission", "min-commission"], defaults.minCommission),
    slippageBps: {
      ...defaults.slippageBps,
      gold: numberOption(options, ["slippageBps", "slippage-bps"], defaults.slippageBps.gold)
    }
  };
}

function numberOption(options, keys, fallback) {
  for (const key of keys) {
    if (options[key] !== undefined && options[key] !== null && options[key] !== "") {
      return Number(options[key]);
    }
  }
  return fallback;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatRatio(value) {
  return value === Infinity ? "Infinity" : Number(value || 0).toFixed(2);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}
