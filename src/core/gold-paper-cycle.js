import { defaultConfig } from "../config/default.js";
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
    broker: new PaperBroker(defaultConfig.execution.paper),
    config: defaultConfig,
    mode,
    portfolio: new Portfolio({ startingCash: defaultConfig.account.startingCash }),
    riskEngine: new RiskEngine(createGoldRiskConfig(options)),
    strategy: new MomentumBreakoutStrategy(createGoldStrategyConfig(options))
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

function createGoldStrategyConfig(options) {
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

function createGoldRiskConfig(options) {
  return {
    ...defaultConfig.risk,
    maxOpenPositions: Number(options.maxOpenPositions || options["max-open-positions"] || 1),
    maxRiskPerTradePct: Number(options.maxRiskPerTradePct || options["max-risk-pct"] || 0.015),
    maxNotionalPerTradePct: Number(options.maxNotionalPerTradePct || options["max-notional-pct"] || 0.35),
    maxAssetClassExposurePct: {
      ...defaultConfig.risk.maxAssetClassExposurePct,
      gold: Number(options.maxGoldExposurePct || options["max-gold-exposure-pct"] || 0.45)
    },
    maxSpreadBps: {
      ...defaultConfig.risk.maxSpreadBps,
      gold: Number(options.maxSpreadBps || options["max-spread-bps"] || 12)
    },
    minVolume: {
      ...defaultConfig.risk.minVolume,
      gold: Number(options.minVolume || options["min-volume"] || 1)
    },
    targetRewardRiskRatio: Number(options.targetRewardRiskRatio || options.targetRR || options["target-rr"] || 1.6)
  };
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
