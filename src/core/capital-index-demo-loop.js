import { defaultConfig } from "../config/default.js";
import { formatCapitalDealResult } from "../integrations/capital-client.js";
import { runCapitalOilDemoLoop } from "./capital-oil-demo-loop.js";

export function getIndexMarketConfig(market = "us2000") {
  const key = normalizeMarketKey(market);
  const config = defaultConfig.indexDemo.markets[key];
  if (!config) {
    const supported = Object.keys(defaultConfig.indexDemo.markets).join(", ");
    throw new Error(`Unknown index market "${market}". Supported: ${supported}`);
  }
  return {
    ...config,
    key
  };
}

export async function runCapitalIndexDemoLoop({
  market = "us2000",
  client,
  bars,
  barsByResolution,
  epic,
  symbol,
  label,
  resolution = "MINUTE_5",
  resolutions = defaultConfig.indexDemo.timeframes,
  count = 300,
  size,
  minPositionSize,
  submitOrders = false,
  now = new Date(),
  accountStartingCash = defaultConfig.indexDemo.accountStartingCash,
  dailyProfitTargetDollars = defaultConfig.indexDemo.dailyProfitTargetDollars,
  dailyMaxLossDollars = defaultConfig.indexDemo.dailyMaxLossDollars,
  maxOpenPositions = defaultConfig.indexDemo.maxOpenPositions,
  closePositionsOnDailyGuard = defaultConfig.indexDemo.closePositionsOnDailyGuard,
  strategyOptions = {},
  manageProfitTargets = defaultConfig.indexDemo.manageProfitTargets,
  minProfitToExtendDollars = defaultConfig.indexDemo.minProfitToExtendDollars,
  profitTargetExtensionAtrMultiple = defaultConfig.indexDemo.profitTargetExtensionAtrMultiple,
  minProfitTargetMoveDistance = defaultConfig.indexDemo.minProfitTargetMoveDistance,
  moveStopOnTargetExtension = defaultConfig.indexDemo.moveStopOnTargetExtension,
  breakevenBufferDistance = defaultConfig.indexDemo.breakevenBufferDistance,
  minMinutesBetweenEntries = defaultConfig.indexDemo.minMinutesBetweenEntries,
  maxEntriesPerHour = defaultConfig.indexDemo.maxEntriesPerHour,
  maxDailyEntries = defaultConfig.indexDemo.maxDailyEntries,
  stateFile,
  state,
  writeState
} = {}) {
  const marketConfig = getIndexMarketConfig(market);
  const resolvedLabel = label || marketConfig.label;
  const resolvedStateFile = stateFile === undefined
    ? `logs/capital-index-${marketConfig.key}-demo-state.json`
    : stateFile;
  const result = await runCapitalOilDemoLoop({
    client,
    bars,
    barsByResolution,
    epic: epic || marketConfig.epic,
    symbol: symbol || marketConfig.symbol,
    label: resolvedLabel,
    resolution,
    resolutions,
    count,
    size: size ?? marketConfig.defaultSize ?? defaultConfig.indexDemo.defaultSize,
    minPositionSize: minPositionSize ?? marketConfig.minPositionSize ?? defaultConfig.indexDemo.minPositionSize,
    submitOrders,
    now,
    accountStartingCash,
    dailyProfitTargetDollars,
    dailyMaxLossDollars,
    maxOpenPositions,
    closePositionsOnDailyGuard,
    strategyOptions: {
      breakoutLookback: defaultConfig.indexDemo.breakoutLookback,
      minAtrPct: defaultConfig.indexDemo.minAtrPct,
      maxAtrPct: defaultConfig.indexDemo.maxAtrPct,
      maxSpreadPct: defaultConfig.indexDemo.maxSpreadPct,
      minVolumeExpansion: defaultConfig.indexDemo.minVolumeExpansion,
      stopAtrMultiple: defaultConfig.indexDemo.stopAtrMultiple,
      targetRR: defaultConfig.indexDemo.targetRR,
      ...strategyOptions,
      label: resolvedLabel
    },
    manageProfitTargets,
    minProfitToExtendDollars,
    profitTargetExtensionAtrMultiple,
    minProfitTargetMoveDistance,
    moveStopOnTargetExtension,
    breakevenBufferDistance,
    inventoryBlackoutEnabled: false,
    minMinutesBetweenEntries,
    maxEntriesPerHour,
    maxDailyEntries,
    stateFile: resolvedStateFile,
    state,
    writeState
  });

  return {
    ...result,
    mode: submitOrders ? "capital-index-demo-order-enabled" : "decision-only",
    section: "index",
    market: marketConfig,
    indexLabel: resolvedLabel,
    openIndexPositions: result.openOilPositions || []
  };
}

export function formatCapitalIndexDemoLoop(result) {
  const lines = [];
  const label = result.indexLabel || result.label || result.market?.label || "Index";
  const timeframeResults = result.timeframeResults || [];
  const entryDecisions = result.entryDecisions || [];
  const openPositions = result.openIndexPositions || result.openOilPositions || [];
  const decisionAction = entryDecisions.length > 1
    ? "OPEN_MULTIPLE"
    : entryDecisions[0]?.action || result.decision.action;
  const decisionReason = entryDecisions.length > 1
    ? `${entryDecisions.length} ${label} setup(s) across ${entryDecisions.map((decision) => decision.resolution).join(", ")}.`
    : entryDecisions[0]?.reason || result.decision.reason;

  lines.push(`Capital.com ${label} Index Demo Loop`);
  lines.push("=".repeat(lines[0].length));
  lines.push(`Created:       ${result.createdAt}`);
  lines.push(`Mode:          ${result.mode}`);
  lines.push(`Market:        ${result.market?.key || "custom"}`);
  lines.push(`Epic:          ${result.epic}`);
  lines.push(`Symbol:        ${result.symbol}`);
  lines.push(`Resolution:    ${result.resolution}`);
  if ((result.resolutions || []).length > 1) {
    lines.push(`Timeframes:    ${result.resolutions.join(", ")}`);
  }
  lines.push(`Bars:          ${result.bars.length}`);
  lines.push(`Latest bar:    ${result.bars.at(-1)?.time || "n/a"}`);
  lines.push(`Equity:        ${money(result.account.equity)} (${result.account.currency})`);
  lines.push(`Day start:     ${money(result.dailyState.dayStartEquity)}`);
  lines.push(`Daily P/L:     ${money(result.dailyGuard.dailyPnl)} / target ${money(result.dailyGuard.dailyProfitTargetDollars)} / max loss ${money(-result.dailyGuard.dailyMaxLossDollars)}`);
  lines.push(`Daily guard:   ${result.dailyGuard.status}`);
  lines.push(`Entry guard:   ${result.frequencyGuard.status} (${result.frequencyGuard.entriesLastHour || 0}/hr, ${result.frequencyGuard.entriesToday || 0}/day)`);
  lines.push(`Open demo pos: ${openPositions.length}/${result.maxOpenPositions}`);
  lines.push(`Decision:      ${decisionAction}`);
  lines.push(`Reason:        ${decisionReason}`);

  if (timeframeResults.length > 1) {
    lines.push("");
    lines.push("Timeframe Decisions");
    for (const timeframe of timeframeResults) {
      const setup = timeframe.decision.setupType ? ` setup=${timeframe.decision.setupType}` : "";
      lines.push(`  ${timeframe.resolution.padEnd(9)} ${timeframe.decision.action.padEnd(9)}${setup} ${timeframe.decision.reason}`);
    }
  }

  if (openPositions.length) {
    lines.push("");
    lines.push(`Open ${label} Positions`);
    for (const position of openPositions) {
      lines.push(`  ${position.direction || "n/a"} size=${formatNumber(position.size)} level=${formatMaybeMoney(position.level)} tp=${formatMaybeMoney(position.profitLevel)} upl=${money(position.upl)} deal=${position.dealId || "n/a"}`);
    }
  }

  if ((result.profitTargetAdjustments || []).length) {
    lines.push("");
    lines.push(`${label} Profit Target Adjustments`);
    for (const adjustment of result.profitTargetAdjustments) {
      lines.push(`  ${adjustment.direction} deal=${adjustment.dealId} tp ${formatMaybeMoney(adjustment.previousProfitLevel)} -> ${formatMaybeMoney(adjustment.profitLevel)} sl ${formatMaybeMoney(adjustment.previousStopLevel)} -> ${formatMaybeMoney(adjustment.stopLevel)} reason=${adjustment.reason}`);
    }
  }

  if (entryDecisions.length) {
    lines.push("");
    lines.push(entryDecisions.length === 1 ? "Planned Demo Order" : "Planned Demo Orders");
    for (const planned of entryDecisions) {
      lines.push(`  ${planned.resolution} ${planned.order.direction} ${planned.order.epic} size=${planned.order.size}`);
      lines.push(`    stopDistance=${planned.order.stopDistance} profitDistance=${planned.order.profitDistance}`);
      lines.push(`    would become position ${planned.openPositionsAfterFill}/${planned.maxOpenPositions}`);
      lines.push(`    setup=${planned.setupType} confidence=${Number(planned.confidence || 0).toFixed(2)} key=${planned.dedupeKey || planned.latestBarTime}`);
    }
  }

  if (result.submissions.length) {
    lines.push("");
    lines.push(`Submitted ${label} Demo Deals`);
    for (const submission of result.submissions) {
      lines.push(formatCapitalDealResult(submission, {
        title: `Submitted ${label} Demo Deal`
      }));
    }
  }

  if (result.confirms.length) {
    lines.push("");
    lines.push(`Confirmed ${label} Demo Deals`);
    for (const confirm of result.confirms) {
      lines.push(formatCapitalDealResult(confirm, {
        title: `Confirmed ${label} Demo Deal`
      }));
    }
  }

  return lines.join("\n");
}

function normalizeMarketKey(value) {
  const normalized = String(value || "us2000").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = {
    rty: "us2000",
    russell: "us2000",
    russell2000: "us2000",
    us2k: "us2000",
    us2000: "us2000",
    de40: "ger40",
    dax: "ger40",
    ger40: "ger40",
    germany40: "ger40",
    nasdaq: "nas100",
    nasdaq100: "nas100",
    nas100: "nas100",
    us100: "nas100",
    dow: "us30",
    dow30: "us30",
    wallstreet: "us30",
    us30: "us30"
  };
  return aliases[normalized] || normalized;
}

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(number);
}

function formatMaybeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) {
    return "n/a";
  }
  return money(number);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8
  }).format(number);
}
