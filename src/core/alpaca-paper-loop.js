import { defaultConfig } from "../config/default.js";
import { createPaperMarketOrderFromRiskOrder } from "../integrations/alpaca-client.js";
import { MomentumBreakoutStrategy } from "../strategies/momentum-breakout.js";
import { Portfolio } from "./portfolio.js";
import { RiskEngine } from "./risk-engine.js";

export async function runAlpacaPaperLoop({
  client,
  symbols = defaultConfig.stockPaper.symbols,
  timeframe = "1Hour",
  bars = 80,
  feed = "iex",
  lookbackDays = 30,
  submitOrders = false,
  maxBuyNotional,
  targetRewardRiskRatio,
  config = defaultConfig,
  now = new Date()
}) {
  const runConfig = createPaperTrainingConfig(config, {
    maxBuyNotional,
    targetRewardRiskRatio
  });
  const createdAt = now.toISOString();
  const start = new Date(now.getTime() - Number(lookbackDays) * 24 * 60 * 60 * 1000).toISOString();
  const runId = createRunId(createdAt);
  const requestedSymbols = normalizeSymbols(symbols);

  const [account, positions] = await Promise.all([
    client.getAccount(),
    client.getPositions()
  ]);
  const marketClock = submitOrders ? await getMarketClock(client) : null;
  const orderSubmissionEnabled = submitOrders && isMarketOpen(marketClock);
  const openPositionSymbols = normalizeSymbols(positions.map((position) => position.symbol));
  const normalizedSymbols = mergeSymbols(requestedSymbols, openPositionSymbols);
  const addedPositionSymbols = normalizedSymbols.filter((symbol) => !requestedSymbols.includes(symbol));

  const barPayload = await getStockBarsForSymbols(client, {
    symbols: normalizedSymbols,
    timeframe,
    bars,
    feed,
    start,
    end: createdAt
  });

  const alpacaBars = normalizeAlpacaBars(barPayload, {
    feed,
    timeframe
  });
  const barsBySymbol = groupBarsBySymbol(alpacaBars);
  const portfolio = createPortfolioFromAlpaca(account, positions);
  const riskEngine = new RiskEngine(runConfig.risk);
  const strategy = new MomentumBreakoutStrategy(runConfig.strategy.momentumBreakout);
  const markPrices = new Map();
  const signals = [];
  const riskDecisions = [];
  const orders = [];
  let barsProcessed = 0;

  for (const symbol of normalizedSymbols) {
    const symbolBars = barsBySymbol.get(symbol) || [];
    if (!symbolBars.length) {
      signals.push(createMissingDataSignal({ symbol, createdAt }));
      continue;
    }

    for (const bar of symbolBars.slice(0, -1)) {
      strategy.onBar({
        bar,
        mode: "alpaca-paper-warmup",
        portfolio,
        config: runConfig
      });
      barsProcessed += 1;
    }

    const latestBar = symbolBars.at(-1);
    markPrices.set(symbol, latestBar.close);
    barsProcessed += 1;

    const signal = strategy.onBar({
      bar: latestBar,
      mode: "alpaca-paper",
      portfolio,
      config: runConfig
    });

    const signalRecord = {
      time: latestBar.time,
      symbol,
      assetClass: latestBar.assetClass,
      action: signal.action,
      confidence: signal.confidence || null,
      reason: signal.reason || null,
      features: {
        close: latestBar.close,
        high: latestBar.high,
        low: latestBar.low,
        volume: latestBar.volume,
        source: latestBar.source
      }
    };
    signals.push(signalRecord);

    if (!signal || signal.action === "HOLD") {
      continue;
    }

    const riskResult = riskEngine.createOrder({
      bar: latestBar,
      markPrices,
      portfolio,
      signal
    });

    const riskRecord = {
      time: latestBar.time,
      symbol,
      assetClass: latestBar.assetClass,
      action: signal.action,
      approved: riskResult.approved,
      reason: riskResult.approved ? "approved" : riskResult.reason,
      order: riskResult.order || null,
      signal: signalRecord
    };
    riskDecisions.push(riskRecord);

    if (!riskResult.approved) {
      continue;
    }

    const request = createPaperMarketOrderFromRiskOrder({
      order: riskResult.order,
      maxBuyNotional: runConfig.paperTraining.maxBuyNotional
    });
    const requestRisk = estimateRequestRisk(request, riskResult.order);

    if (!submitOrders) {
      orders.push({
        status: "planned",
        assetClass: latestBar.assetClass,
        request,
        requestRisk,
        riskOrder: riskResult.order
      });
      continue;
    }

    if (!orderSubmissionEnabled) {
      orders.push({
        status: "skipped-market-closed",
        assetClass: latestBar.assetClass,
        request,
        requestRisk,
        riskOrder: riskResult.order,
        skipped: true,
        reason: "market closed"
      });
      continue;
    }

    const submitted = await client.submitOrder(request);
    orders.push({
      status: submitted.status || "submitted",
      assetClass: latestBar.assetClass,
      request,
      requestRisk,
      submitted,
      riskOrder: riskResult.order
    });
  }

  return {
    runId,
    createdAt,
    mode: "alpaca-paper",
    requestedSymbols,
    symbols: normalizedSymbols,
    addedPositionSymbols,
    timeframe,
    feed,
    lookbackDays,
    submitted: submitOrders,
    maxBuyNotional: runConfig.paperTraining.maxBuyNotional,
    targetRewardRiskRatio: runConfig.paperTraining.targetRewardRiskRatio,
    targetRiskPerTradeDollars: runConfig.paperTraining.targetRiskPerTradeDollars,
    marketClock: normalizeMarketClock(marketClock),
    orderSubmissionEnabled,
    account: normalizeAccount(account),
    rawAccount: account,
    positions: positions.map(normalizeAlpacaPosition),
    barsProcessed,
    signals,
    riskDecisions,
    orders,
    summary: {
      signals: signals.length,
      actionableSignals: signals.filter((signal) => signal.action !== "HOLD").length,
      approvedRiskDecisions: riskDecisions.filter((decision) => decision.approved).length,
      rejectedRiskDecisions: riskDecisions.filter((decision) => !decision.approved).length,
      orders: orders.length,
      submittedOrders: orders.filter((order) => Boolean(order.submitted)).length
    }
  };
}

async function getStockBarsForSymbols(client, {
  symbols,
  timeframe,
  bars,
  feed,
  start,
  end
}) {
  const payloads = await Promise.all(symbols.map(async (symbol) => client.getStockBars({
    symbols: [symbol],
    timeframe,
    limit: bars,
    feed,
    sort: "desc",
    start,
    end
  })));

  return {
    bars: payloads.reduce((combined, payload) => ({
      ...combined,
      ...(payload.bars || {})
    }), {})
  };
}

export function formatAlpacaPaperLoop(run) {
  const lines = [];
  lines.push("Alpaca Live-Paper Strategy Loop");
  lines.push("===============================");
  lines.push(`Run ID:        ${run.runId}`);
  const mode = run.submitted
    ? run.orderSubmissionEnabled === false
      ? "paper submission skipped (market closed)"
      : "submitted paper orders"
    : "decision/log only";
  lines.push(`Mode:          ${mode}`);
  lines.push(`Symbols:       ${run.symbols.join(", ")}`);
  if (run.addedPositionSymbols?.length) {
    lines.push(`Added exits:   ${run.addedPositionSymbols.join(", ")}`);
  }
  lines.push(`Timeframe:     ${run.timeframe}`);
  lines.push(`Feed:          ${run.feed}`);
  lines.push(`Lookback days: ${run.lookbackDays}`);
  if (run.marketClock) {
    lines.push(`Market open:   ${run.marketClock.isOpen ? "yes" : "no"}`);
  }
  lines.push(`Bars:          ${run.barsProcessed}`);
  lines.push(`Max buy size:  ${money(run.maxBuyNotional)}`);
  lines.push(`Target R/R:    1:${Number(run.targetRewardRiskRatio || 0).toFixed(2)}`);
  lines.push(`Buying Power:  ${money(run.account.buyingPower)}`);
  lines.push(`Equity:        ${money(run.account.portfolioValue)}`);
  lines.push(`Signals:       ${run.summary.signals}`);
  lines.push(`Actionable:    ${run.summary.actionableSignals}`);
  lines.push(`Risk approved: ${run.summary.approvedRiskDecisions}`);
  lines.push(`Risk rejected: ${run.summary.rejectedRiskDecisions}`);
  lines.push(`Orders:        ${run.summary.orders}`);

  if (run.signals.length) {
    lines.push("");
    lines.push("Latest Signals");
    for (const signal of run.signals) {
      lines.push(
        `  ${signal.time} ${signal.symbol.padEnd(6)} ${signal.action.padEnd(4)} ${signal.reason || ""}`
      );
    }
  }

  if (run.riskDecisions.length) {
    lines.push("");
    lines.push("Risk Decisions");
    for (const decision of run.riskDecisions) {
      lines.push(
        `  ${decision.symbol.padEnd(6)} ${decision.action.padEnd(4)} ${decision.approved ? "APPROVED" : "BLOCKED"} ${decision.reason || ""}`
      );
    }
  }

  if (run.orders.length) {
    lines.push("");
    lines.push("Paper Orders");
    for (const order of run.orders) {
      const request = order.request || {};
      const requestRisk = order.requestRisk || {};
      lines.push(
        `  ${String(request.symbol || "?").padEnd(6)} ${String(request.side || "?").padEnd(4)} ${order.status.padEnd(12)} notional=${request.notional || "n/a"} qty=${request.qty || "n/a"} risk=${money(requestRisk.estimatedRiskDollars || 0)} target=${money(requestRisk.targetProfitDollars || 0)}`
      );
    }
  }

  return lines.join("\n");
}

async function getMarketClock(client) {
  if (typeof client.getClock !== "function") {
    return null;
  }

  return client.getClock();
}

function isMarketOpen(marketClock) {
  return !marketClock || marketClock.is_open === true;
}

function estimateRequestRisk(request, riskOrder) {
  const notional = Number(request.notional || 0) ||
    Number(riskOrder.notional || 0) ||
    Number(riskOrder.quantity || 0) * Number(riskOrder.expectedPrice || 0);
  const stopLossPct = Number(riskOrder.stopLossPct || 0);
  const targetRewardRiskRatio = Number(riskOrder.targetRewardRiskRatio || 0);
  const estimatedRiskDollars = notional * stopLossPct;

  return {
    notional,
    stopLossPct,
    targetRewardRiskRatio,
    estimatedRiskDollars,
    targetProfitDollars: targetRewardRiskRatio > 0
      ? estimatedRiskDollars * targetRewardRiskRatio
      : null
  };
}

function createPaperTrainingConfig(config, overrides = {}) {
  const training = config.paperTraining || {};
  const trainingRisk = training.risk || {};
  const strategy = {
    ...config.strategy,
    momentumBreakout: {
      ...config.strategy.momentumBreakout,
      ...(training.strategy || {}),
      takeProfitRR: Number(
        overrides.targetRewardRiskRatio ||
        training.targetRewardRiskRatio ||
        config.strategy.momentumBreakout.takeProfitRR ||
        2.5
      )
    }
  };
  const risk = {
    ...config.risk,
    ...trainingRisk,
    maxSpreadBps: {
      ...config.risk.maxSpreadBps,
      ...(trainingRisk.maxSpreadBps || {})
    },
    minVolume: {
      ...config.risk.minVolume,
      ...(trainingRisk.minVolume || {})
    },
    maxAssetClassExposurePct: {
      ...config.risk.maxAssetClassExposurePct,
      ...(trainingRisk.maxAssetClassExposurePct || {})
    },
    targetRiskPerTradeDollars: Number(
      training.targetRiskPerTradeDollars ||
      trainingRisk.targetRiskPerTradeDollars ||
      0
    ),
    targetRewardRiskRatio: strategy.momentumBreakout.takeProfitRR
  };

  return {
    ...config,
    strategy,
    risk,
    paperTraining: {
      ...training,
      maxBuyNotional: Number(overrides.maxBuyNotional || training.maxBuyNotional || 100),
      targetRewardRiskRatio: strategy.momentumBreakout.takeProfitRR,
      targetRiskPerTradeDollars: risk.targetRiskPerTradeDollars
    }
  };
}

export function normalizeAlpacaBars(payload, { feed, timeframe } = {}) {
  const barsBySymbol = payload.bars || {};
  const bars = [];

  for (const [symbol, symbolBars] of Object.entries(barsBySymbol)) {
    for (const bar of symbolBars || []) {
      const close = Number(bar.c);
      bars.push({
        time: new Date(bar.t).toISOString(),
        symbol,
        assetClass: "stock",
        venue: "alpaca-paper",
        open: Number(bar.o),
        high: Number(bar.h),
        low: Number(bar.l),
        close,
        volume: Number(bar.v || 0),
        bid: close,
        ask: close,
        source: {
          provider: "alpaca",
          mode: "paper-market-data",
          feed,
          timeframe
        }
      });
    }
  }

  return bars.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.symbol.localeCompare(b.symbol));
}

export function createPortfolioFromAlpaca(account, positions = []) {
  return new Portfolio({
    startingCash: Number(account.portfolio_value || account.cash || 0),
    cash: Number(account.cash || 0),
    positions: positions.map(normalizeAlpacaPosition)
  });
}

function normalizeAlpacaPosition(position) {
  return {
    symbol: position.symbol,
    assetClass: mapAlpacaAssetClass(position.asset_class),
    quantity: Math.abs(Number(position.qty || 0)),
    avgPrice: Number(position.avg_entry_price || 0),
    marketValue: Number(position.market_value || 0),
    raw: position
  };
}

function normalizeAccount(account) {
  return {
    id: account.id,
    status: account.status,
    cash: Number(account.cash || 0),
    buyingPower: Number(account.buying_power || 0),
    portfolioValue: Number(account.portfolio_value || 0),
    patternDayTrader: Boolean(account.pattern_day_trader)
  };
}

function normalizeMarketClock(clock) {
  if (!clock) {
    return null;
  }

  return {
    isOpen: Boolean(clock.is_open),
    timestamp: clock.timestamp ? new Date(clock.timestamp).toISOString() : null,
    nextOpen: clock.next_open ? new Date(clock.next_open).toISOString() : null,
    nextClose: clock.next_close ? new Date(clock.next_close).toISOString() : null
  };
}

function createMissingDataSignal({ symbol, createdAt }) {
  return {
    time: createdAt,
    symbol,
    assetClass: "stock",
    action: "HOLD",
    confidence: null,
    reason: "no Alpaca bars returned",
    features: {}
  };
}

function groupBarsBySymbol(bars) {
  const grouped = new Map();

  for (const bar of bars) {
    if (!grouped.has(bar.symbol)) {
      grouped.set(bar.symbol, []);
    }
    grouped.get(bar.symbol).push(bar);
  }

  return grouped;
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

  for (const symbol of [...primary, ...secondary]) {
    if (!seen.has(symbol)) {
      seen.add(symbol);
      merged.push(symbol);
    }
  }

  return merged;
}

function mapAlpacaAssetClass(assetClass) {
  if (assetClass === "us_equity") {
    return "stock";
  }
  return assetClass || "stock";
}

function createRunId(createdAt) {
  return `${createdAt.replace(/[:.]/g, "-")}-alpaca-paper`;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}
