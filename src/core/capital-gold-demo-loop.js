import { CapitalClient, formatCapitalDealResult } from "../integrations/capital-client.js";
import { fetchCapitalPrices } from "./capital-market-data.js";
import { runGoldPaperCycle } from "./gold-paper-cycle.js";

const DEFAULT_PULLBACK_OPTIONS = {
  targetRR: 2,
  touchAtrMultiple: 0.75,
  stopAtrMultiple: 2,
  maxHoldBars: 12,
  minAtrPct: 0.00015
};

export async function runCapitalGoldDemoLoop({
  client = new CapitalClient(),
  bars,
  epic = "GOLD",
  resolution = "MINUTE_5",
  count = 300,
  size,
  submitOrders = false,
  strategyOptions = DEFAULT_PULLBACK_OPTIONS,
  now = new Date()
} = {}) {
  if (submitOrders && client.environment !== "demo") {
    throw new Error(`Refusing Capital.com order because CAPITAL_ENV is ${client.environment}; demo only is allowed here.`);
  }

  const priceBars = bars || (await fetchCapitalPrices({
    client,
    epic,
    resolution,
    count,
    symbol: "XAU/USD"
  })).bars;
  const positionsPayload = await client.getPositions();
  const openGoldPositions = extractOpenPositions(positionsPayload, epic);
  const cycle = await runGoldPaperCycle({
    bars: priceBars,
    provider: "capital",
    strategy: "pullback",
    writeDatabase: false,
    ...DEFAULT_PULLBACK_OPTIONS,
    ...strategyOptions
  });
  const decision = buildCapitalGoldDemoDecision({
    bars: priceBars,
    cycle,
    epic,
    openGoldPositions,
    size,
    strategyOptions: {
      ...DEFAULT_PULLBACK_OPTIONS,
      ...strategyOptions
    }
  });

  let submitted = null;
  let confirm = null;
  if (submitOrders && decision.action === "OPEN") {
    if (!Number.isFinite(Number(size)) || Number(size) <= 0) {
      throw new Error("Add --size with a positive Capital.com demo size before submitting.");
    }
    submitted = await client.createPosition(decision.order);
    if (submitted.dealReference) {
      confirm = await client.getConfirm(submitted.dealReference);
    }
  }

  return {
    createdAt: now.toISOString(),
    mode: submitOrders ? "capital-demo-order-enabled" : "decision-only",
    epic,
    resolution,
    bars: priceBars,
    openGoldPositions,
    cycle,
    decision,
    submitted,
    confirm
  };
}

export function buildCapitalGoldDemoDecision({
  bars,
  cycle,
  epic = "GOLD",
  openGoldPositions = [],
  size,
  strategyOptions = DEFAULT_PULLBACK_OPTIONS
}) {
  const latestBar = bars.at(-1);
  if (!latestBar) {
    return holdDecision("No Capital.com Gold bars were available.");
  }

  if (openGoldPositions.length) {
    return holdDecision(`Capital.com already has ${openGoldPositions.length} open ${epic} demo position(s).`);
  }

  const latestFill = cycle.report.fills.at(-1);
  if (!latestFill || !["LONG_ENTRY", "SHORT_ENTRY"].includes(latestFill.intent)) {
    return holdDecision("No fresh Gold pullback entry on the latest bar.");
  }

  if (latestFill.time !== latestBar.time) {
    return holdDecision(`Last pullback entry was ${latestFill.time}; latest bar is ${latestBar.time}.`);
  }

  const direction = latestFill.intent === "SHORT_ENTRY" ? "SELL" : "BUY";
  const stopDistance = calculateStopDistance({
    bars,
    stopAtrMultiple: Number(strategyOptions.stopAtrMultiple || DEFAULT_PULLBACK_OPTIONS.stopAtrMultiple)
  });
  const targetRR = Number(strategyOptions.targetRR || strategyOptions.targetRewardRiskRatio || DEFAULT_PULLBACK_OPTIONS.targetRR);
  const profitDistance = stopDistance * targetRR;

  return {
    action: "OPEN",
    reason: latestFill.reason || "fresh Gold pullback entry",
    latestBarTime: latestBar.time,
    order: {
      epic,
      direction,
      size: Number(size || 0),
      stopDistance: roundDistance(stopDistance),
      profitDistance: roundDistance(profitDistance)
    }
  };
}

export function formatCapitalGoldDemoLoop(result) {
  const lines = [];
  lines.push("Capital.com Gold Demo Loop");
  lines.push("==========================");
  lines.push(`Created:       ${result.createdAt}`);
  lines.push(`Mode:          ${result.mode}`);
  lines.push(`Epic:          ${result.epic}`);
  lines.push(`Resolution:    ${result.resolution}`);
  lines.push(`Bars:          ${result.bars.length}`);
  lines.push(`Latest bar:    ${result.bars.at(-1)?.time || "n/a"}`);
  lines.push(`Open demo pos: ${result.openGoldPositions.length}`);
  lines.push(`Paper P/L:     ${money(result.cycle.report.account.netPnl)} (${pct(result.cycle.report.account.returnPct)})`);
  lines.push(`Paper trades:  ${result.cycle.report.metrics.closedTrades}`);
  lines.push(`Paper PF:      ${formatRatio(result.cycle.report.metrics.profitFactor)}`);
  lines.push(`Decision:      ${result.decision.action}`);
  lines.push(`Reason:        ${result.decision.reason}`);

  if (result.decision.order) {
    lines.push("");
    lines.push("Planned Demo Order");
    lines.push(`  ${result.decision.order.direction} ${result.decision.order.epic} size=${result.decision.order.size}`);
    lines.push(`  stopDistance=${result.decision.order.stopDistance} profitDistance=${result.decision.order.profitDistance}`);
  }

  if (result.submitted) {
    lines.push("");
    lines.push(formatCapitalDealResult(result.submitted, {
      title: "Submitted Demo Deal"
    }));
  }

  if (result.confirm) {
    lines.push("");
    lines.push(formatCapitalDealResult(result.confirm, {
      title: "Confirmed Demo Deal"
    }));
  }

  return lines.join("\n");
}

function extractOpenPositions(payload, epic) {
  return (payload.positions || [])
    .map((item) => {
      const position = item.position || item;
      const market = item.market || {};
      return {
        epic: String(market.epic || position.epic || "").toUpperCase(),
        dealId: position.dealId,
        direction: position.direction,
        size: Number(position.size || 0),
        level: Number(position.level || 0),
        upl: Number(position.upl || 0)
      };
    })
    .filter((position) => position.epic === String(epic).toUpperCase());
}

function calculateStopDistance({ bars, stopAtrMultiple }) {
  const atr = averageTrueRange(bars.slice(-15));
  const latestClose = bars.at(-1)?.close || 0;
  return Math.max(atr * stopAtrMultiple, latestClose * 0.001);
}

function averageTrueRange(bars) {
  if (bars.length < 2) {
    return 0;
  }

  const ranges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previous = bars[index - 1];
    ranges.push(Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close)
    ));
  }

  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function holdDecision(reason) {
  return {
    action: "HOLD",
    reason
  };
}

function roundDistance(value) {
  return Number(Number(value || 0).toFixed(2));
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
