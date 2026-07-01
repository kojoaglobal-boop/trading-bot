import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultConfig } from "../config/default.js";
import { CapitalClient, formatCapitalDealResult } from "../integrations/capital-client.js";
import { fetchCapitalPrices } from "./capital-market-data.js";
import { runGoldPaperCycle } from "./gold-paper-cycle.js";
import { aggregateBars } from "../strategies/gold-trendline.js";
import { appendSubmittedEntry, buildTradeFrequencyGuard } from "./trade-frequency-guard.js";

const DEFAULT_PULLBACK_OPTIONS = {
  targetRR: 2,
  touchAtrMultiple: 0.75,
  stopAtrMultiple: 2,
  maxHoldBars: 12,
  minAtrPct: 0.00015
};
const DEFAULT_STATE_FILE = "logs/capital-gold-demo-state.json";

export async function runCapitalGoldDemoLoop({
  client = new CapitalClient(),
  bars,
  barsByResolution,
  epic = "GOLD",
  resolution = "MINUTE_5",
  resolutions = defaultConfig.goldDemo.timeframes,
  count = 300,
  size = defaultConfig.goldDemo.defaultSize,
  minPositionSize = defaultConfig.goldDemo.minPositionSize,
  submitOrders = false,
  strategyOptions = DEFAULT_PULLBACK_OPTIONS,
  now = new Date(),
  accountStartingCash = defaultConfig.goldDemo.accountStartingCash,
  dailyProfitTargetDollars = defaultConfig.goldDemo.dailyProfitTargetDollars,
  dailyMaxLossDollars = defaultConfig.goldDemo.dailyMaxLossDollars,
  maxOpenPositions = defaultConfig.goldDemo.maxOpenPositions,
  closePositionsOnDailyGuard = defaultConfig.goldDemo.closePositionsOnDailyGuard,
  maxSignalAgeBars = defaultConfig.goldDemo.maxSignalAgeBars,
  maxEntryDriftBps = defaultConfig.goldDemo.maxEntryDriftBps,
  allowTrendProbe = defaultConfig.goldDemo.allowTrendProbe,
  trendProbeMinBars = defaultConfig.goldDemo.trendProbeMinBars,
  manageProfitTargets = defaultConfig.goldDemo.manageProfitTargets,
  minProfitToExtendDollars = defaultConfig.goldDemo.minProfitToExtendDollars,
  profitTargetExtensionAtrMultiple = defaultConfig.goldDemo.profitTargetExtensionAtrMultiple,
  minProfitTargetMoveDistance = defaultConfig.goldDemo.minProfitTargetMoveDistance,
  moveStopOnTargetExtension = defaultConfig.goldDemo.moveStopOnTargetExtension,
  breakevenBufferDistance = defaultConfig.goldDemo.breakevenBufferDistance,
  minMinutesBetweenEntries = defaultConfig.goldDemo.minMinutesBetweenEntries,
  maxEntriesPerHour = defaultConfig.goldDemo.maxEntriesPerHour,
  maxDailyEntries = defaultConfig.goldDemo.maxDailyEntries,
  stateFile = DEFAULT_STATE_FILE,
  state,
  writeState = stateFile !== false
} = {}) {
  if (submitOrders && client.environment !== "demo") {
    throw new Error(`Refusing Capital.com order because CAPITAL_ENV is ${client.environment}; demo only is allowed here.`);
  }

  const timeframeBars = await loadGoldTimeframeBars({
    client,
    bars,
    barsByResolution,
    epic,
    resolution,
    resolutions,
    count
  });
  const primaryTimeframe = timeframeBars[0] || {
    resolution: normalizeResolution(resolution),
    bars: []
  };
  const [accountsPayload, positionsPayload] = await Promise.all([
    typeof client.getAccounts === "function" ? client.getAccounts() : { accounts: [] },
    client.getPositions()
  ]);
  const allPositions = extractOpenPositions(positionsPayload);
  const openGoldPositions = allPositions.filter((position) => position.epic === String(epic).toUpperCase());
  const account = extractAccountSnapshot({
    accountsPayload,
    positions: allPositions,
    fallbackEquity: accountStartingCash
  });
  const dailyState = await loadDailyState({
    state,
    stateFile,
    now,
    currentEquity: account.equity,
    fallbackEquity: accountStartingCash,
    writeState
  });
  const dailyGuard = buildDailyGuard({
    currentEquity: account.equity,
    dayStartEquity: dailyState.dayStartEquity,
    dailyProfitTargetDollars,
    dailyMaxLossDollars,
    closePositionsOnDailyGuard
  });
  const frequencyGuard = buildTradeFrequencyGuard({
    state: dailyState,
    now,
    minMinutesBetweenEntries,
    maxEntriesPerHour,
    maxDailyEntries
  });
  const mergedStrategyOptions = {
    ...DEFAULT_PULLBACK_OPTIONS,
    ...strategyOptions
  };
  const profitTargetAdjustments = manageProfitTargets
    ? buildProfitTargetAdjustments({
      bars: primaryTimeframe.bars,
      openGoldPositions,
      dailyGuard,
      minProfitToExtendDollars,
      profitTargetExtensionAtrMultiple,
      minProfitTargetMoveDistance,
      moveStopOnTargetExtension,
      breakevenBufferDistance
    })
    : [];
  const plannedOpenPositions = [...openGoldPositions];
  const timeframeResults = [];

  for (const timeframe of timeframeBars) {
    const cycle = await runGoldPaperCycle({
      bars: timeframe.bars,
      provider: "capital",
      strategy: "pullback",
      writeDatabase: false,
      ...DEFAULT_PULLBACK_OPTIONS,
      ...strategyOptions
    });
    const decision = buildCapitalGoldDemoDecision({
      bars: timeframe.bars,
      cycle,
      epic,
      openGoldPositions: plannedOpenPositions,
      size,
      strategyOptions: mergedStrategyOptions,
      dailyGuard,
      frequencyGuard,
      dailyState,
      maxOpenPositions,
      minPositionSize,
      maxSignalAgeBars,
      maxEntryDriftBps,
      allowTrendProbe,
      trendProbeMinBars,
      dedupeScope: timeframe.resolution
    });
    timeframeResults.push({
      resolution: timeframe.resolution,
      bars: timeframe.bars,
      cycle,
      decision
    });

    if (decision.action === "OPEN") {
      plannedOpenPositions.push({
        epic: String(epic).toUpperCase(),
        direction: decision.order.direction,
        size: decision.order.size,
        level: timeframe.bars.at(-1)?.close || 0,
        planned: true
      });
    }
  }

  const cycle = timeframeResults[0]?.cycle;
  const entryDecisions = timeframeResults
    .filter((result) => result.decision.action === "OPEN")
    .map((result) => ({
      ...result.decision,
      resolution: result.resolution,
      bars: result.bars
    }));
  const closeDecision = timeframeResults.find((result) => result.decision.action.startsWith("CLOSE"))?.decision;
  const decision = closeDecision || entryDecisions[0] || timeframeResults[0]?.decision || holdDecision("No Gold timeframe could be evaluated.");

  const submissions = [];
  const confirms = [];
  const profitTargetUpdates = [];
  if (submitOrders) {
    if (decision.action.startsWith("CLOSE")) {
      const positionsToClose = decision.closePositions || openGoldPositions;
      for (const position of positionsToClose) {
        if (!position.dealId) {
          continue;
        }
        const closed = await client.closePosition(position.dealId);
        submissions.push(closed);
        if (closed.dealReference) {
          confirms.push(await client.getConfirm(closed.dealReference));
        }
      }
    } else {
      for (const adjustment of profitTargetAdjustments) {
        const updated = await client.updatePosition(adjustment.dealId, {
          profitLevel: adjustment.profitLevel,
          stopLevel: adjustment.stopLevel
        });
        profitTargetUpdates.push({
          ...adjustment,
          response: updated
        });
        submissions.push(updated);
        if (updated.dealReference) {
          confirms.push(await client.getConfirm(updated.dealReference));
        }
      }

      for (const entryDecision of entryDecisions) {
        const created = await client.createPosition(entryDecision.order);
        submissions.push(created);
        if (created.dealReference) {
          confirms.push(await client.getConfirm(created.dealReference));
        }
        dailyState.submittedEntryBarTimes = unique([
          ...(dailyState.submittedEntryBarTimes || []),
          entryDecision.dedupeKey || entryDecision.latestBarTime
        ]).slice(-200);
        dailyState.lastSubmittedEntryBarTime = entryDecision.latestBarTime;
        Object.assign(dailyState, appendSubmittedEntry(dailyState, {
          submittedAt: now.toISOString(),
          barTime: entryDecision.latestBarTime,
          dedupeKey: entryDecision.dedupeKey,
          epic,
          direction: entryDecision.order.direction,
          resolution: entryDecision.resolution,
          setupType: entryDecision.setupType
        }));
      }
    }
  }

  if (writeState) {
    await saveDailyState({ stateFile, state: dailyState });
  }

  return {
    createdAt: now.toISOString(),
    mode: submitOrders ? "capital-demo-order-enabled" : "decision-only",
    epic,
    resolution: primaryTimeframe.resolution,
    resolutions: timeframeBars.map((timeframe) => timeframe.resolution),
    bars: primaryTimeframe.bars,
    account,
    dailyGuard,
    frequencyGuard,
    dailyState,
    maxOpenPositions,
    openGoldPositions,
    cycle,
    decision,
    timeframeResults,
    entryDecisions,
    profitTargetAdjustments,
    profitTargetUpdates,
    submissions,
    confirms,
    submitted: submissions[0] || null,
    confirm: confirms[0] || null
  };
}

export function buildCapitalGoldDemoDecision({
  bars,
  cycle,
  epic = "GOLD",
  openGoldPositions = [],
  size = defaultConfig.goldDemo.defaultSize,
  strategyOptions = DEFAULT_PULLBACK_OPTIONS,
  dailyGuard = activeGuard(),
  frequencyGuard = activeFrequencyGuard(),
  dailyState = {},
  maxOpenPositions = defaultConfig.goldDemo.maxOpenPositions,
  minPositionSize = defaultConfig.goldDemo.minPositionSize,
  maxSignalAgeBars = defaultConfig.goldDemo.maxSignalAgeBars,
  maxEntryDriftBps = defaultConfig.goldDemo.maxEntryDriftBps,
  allowTrendProbe = defaultConfig.goldDemo.allowTrendProbe,
  trendProbeMinBars = defaultConfig.goldDemo.trendProbeMinBars,
  dedupeScope = ""
}) {
  const latestBar = bars.at(-1);
  if (!latestBar) {
    return holdDecision("No Capital.com Gold bars were available.");
  }

  if (dailyGuard.closeOpenPositions && openGoldPositions.length) {
    return {
      action: "CLOSE_ALL",
      reason: `${dailyGuard.status}: ${dailyGuard.reason}`,
      closePositions: openGoldPositions
    };
  }

  if (dailyGuard.blocksEntries) {
    return holdDecision(`${dailyGuard.status}: ${dailyGuard.reason}`);
  }

  const minimumSize = Number(minPositionSize || size || 0);
  const undersizedOpenPositions = Number.isFinite(minimumSize) && minimumSize > 0
    ? openGoldPositions.filter((position) => Number(position.size || 0) > 0 && Number(position.size || 0) < minimumSize)
    : [];
  if (undersizedOpenPositions.length) {
    return {
      action: "CLOSE_UNDERSIZED",
      reason: `${undersizedOpenPositions.length} open ${epic} demo position(s) are below minimum size ${minimumSize}. Closing them before new entries.`,
      closePositions: undersizedOpenPositions
    };
  }

  if (openGoldPositions.length >= maxOpenPositions) {
    return holdDecision(`Capital.com already has ${openGoldPositions.length}/${maxOpenPositions} open ${epic} demo position(s).`);
  }

  if (frequencyGuard.blocksEntries) {
    return holdDecision(`${frequencyGuard.status}: ${frequencyGuard.reason}`);
  }

  const orderSize = Number(size);
  if (!Number.isFinite(orderSize) || orderSize <= 0) {
    return holdDecision("No valid Capital.com demo size was configured.");
  }

  const recentEntry = findRecentEntryFill({
    fills: cycle.report.fills,
    bars,
    maxSignalAgeBars,
    maxEntryDriftBps,
    submittedEntryBarTimes: dailyState.submittedEntryBarTimes || [],
    dedupeScope
  });
  const trendProbe = recentEntry ? null : buildTrendProbe({
    bars,
    submittedEntryBarTimes: dailyState.submittedEntryBarTimes || [],
    dedupeScope,
    trendProbeMinBars
  });
  const setup = recentEntry || (allowTrendProbe ? trendProbe : null);

  if (!setup) {
    return holdDecision(`No tradable Gold setup. Last pullback signal age/drift failed and trend probe is ${allowTrendProbe ? "not aligned" : "disabled"}.`);
  }

  const stopDistance = calculateStopDistance({
    bars,
    stopAtrMultiple: Number(strategyOptions.stopAtrMultiple || DEFAULT_PULLBACK_OPTIONS.stopAtrMultiple)
  });
  const targetRR = Number(strategyOptions.targetRR || strategyOptions.targetRewardRiskRatio || DEFAULT_PULLBACK_OPTIONS.targetRR);
  const profitDistance = stopDistance * targetRR;

  return {
    action: "OPEN",
    reason: setup.reason,
    latestBarTime: setup.latestBarTime,
    dedupeKey: setup.dedupeKey,
    setupType: setup.setupType,
    openPositionsAfterFill: openGoldPositions.length + 1,
    maxOpenPositions,
    order: {
      epic,
      direction: setup.direction,
      size: orderSize,
      stopDistance: roundDistance(stopDistance),
      profitDistance: roundDistance(profitDistance)
    }
  };
}

export function formatCapitalGoldDemoLoop(result) {
  const lines = [];
  const timeframeResults = result.timeframeResults || [];
  const entryDecisions = result.entryDecisions || [];
  const decisionAction = entryDecisions.length > 1
    ? "OPEN_MULTIPLE"
    : entryDecisions[0]?.action || result.decision.action;
  const decisionReason = entryDecisions.length > 1
    ? `${entryDecisions.length} Gold setup(s) across ${entryDecisions.map((decision) => decision.resolution).join(", ")}.`
    : entryDecisions[0]?.reason || result.decision.reason;

  lines.push("Capital.com Gold Demo Loop");
  lines.push("==========================");
  lines.push(`Created:       ${result.createdAt}`);
  lines.push(`Mode:          ${result.mode}`);
  lines.push(`Epic:          ${result.epic}`);
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
  lines.push(`Recovery:      ${result.dailyGuard.recoveryMode ? "ACTIVE after loss, still hunting valid setups" : "idle"}`);
  lines.push(`Open demo pos: ${result.openGoldPositions.length}/${result.maxOpenPositions}`);
  lines.push(`Paper P/L:     ${money(result.cycle.report.account.netPnl)} (${pct(result.cycle.report.account.returnPct)})`);
  lines.push(`Paper trades:  ${result.cycle.report.metrics.closedTrades}`);
  lines.push(`Paper PF:      ${formatRatio(result.cycle.report.metrics.profitFactor)}`);
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

  if (result.openGoldPositions.length) {
    lines.push("");
    lines.push("Open Gold Positions");
    for (const position of result.openGoldPositions) {
      lines.push(`  ${position.direction || "n/a"} size=${formatNumber(position.size)} level=${formatMaybeMoney(position.level)} tp=${formatMaybeMoney(position.profitLevel)} upl=${money(position.upl)} deal=${position.dealId || "n/a"}`);
    }
  }

  if ((result.profitTargetAdjustments || []).length) {
    lines.push("");
    lines.push("Profit Target Adjustments");
    for (const adjustment of result.profitTargetAdjustments) {
      lines.push(`  ${adjustment.direction} deal=${adjustment.dealId} tp ${formatMaybeMoney(adjustment.previousProfitLevel)} -> ${formatMaybeMoney(adjustment.profitLevel)} sl ${formatMaybeMoney(adjustment.previousStopLevel)} -> ${formatMaybeMoney(adjustment.stopLevel)} reason=${adjustment.reason}`);
    }
  }

  const plannedDecisions = entryDecisions.length
    ? entryDecisions
    : result.decision.order
      ? [result.decision]
      : [];

  if (plannedDecisions.length) {
    lines.push("");
    lines.push(plannedDecisions.length === 1 ? "Planned Demo Order" : "Planned Demo Orders");
    for (const planned of plannedDecisions) {
      const prefix = planned.resolution ? `${planned.resolution} ` : "";
      lines.push(`  ${prefix}${planned.order.direction} ${planned.order.epic} size=${planned.order.size}`);
      lines.push(`    stopDistance=${planned.order.stopDistance} profitDistance=${planned.order.profitDistance}`);
      lines.push(`    would become position ${planned.openPositionsAfterFill}/${planned.maxOpenPositions}`);
      if (planned.setupType) {
        lines.push(`    setup=${planned.setupType} key=${planned.dedupeKey || planned.latestBarTime}`);
      }
    }
  }

  if (result.submissions.length) {
    lines.push("");
    lines.push("Submitted Demo Deals");
    for (const submission of result.submissions) {
      lines.push(formatCapitalDealResult(submission, {
        title: "Submitted Demo Deal"
      }));
    }
  }

  if (result.confirms.length) {
    lines.push("");
    lines.push("Confirmed Demo Deals");
    for (const confirm of result.confirms) {
      lines.push(formatCapitalDealResult(confirm, {
        title: "Confirmed Demo Deal"
      }));
    }
  }

  return lines.join("\n");
}

export function buildProfitTargetAdjustments({
  bars,
  openGoldPositions = [],
  dailyGuard = activeGuard(),
  minProfitToExtendDollars = defaultConfig.goldDemo.minProfitToExtendDollars,
  profitTargetExtensionAtrMultiple = defaultConfig.goldDemo.profitTargetExtensionAtrMultiple,
  minProfitTargetMoveDistance = defaultConfig.goldDemo.minProfitTargetMoveDistance,
  moveStopOnTargetExtension = defaultConfig.goldDemo.moveStopOnTargetExtension,
  breakevenBufferDistance = defaultConfig.goldDemo.breakevenBufferDistance
} = {}) {
  if (!bars?.length || dailyGuard.blocksEntries || dailyGuard.closeOpenPositions) {
    return [];
  }

  const latestBar = bars.at(-1);
  const atr = averageTrueRange(bars.slice(-15));
  const trend = trendConfidence(bars);
  if (!latestBar || !Number.isFinite(atr) || atr <= 0) {
    return [];
  }

  const minProfit = Number(minProfitToExtendDollars || 0);
  const extension = Math.max(atr * Number(profitTargetExtensionAtrMultiple || 1.5), latestBar.close * 0.0005);
  const minMove = Number(minProfitTargetMoveDistance || 0);
  const adjustments = [];

  for (const position of openGoldPositions) {
    const direction = String(position.direction || "").toUpperCase();
    const upl = Number(position.upl || 0);
    if (!position.dealId || upl < minProfit) {
      continue;
    }

    if (direction === "BUY" && !trend.bullish) {
      continue;
    }
    if (direction === "SELL" && !trend.bearish) {
      continue;
    }

    const currentPrice = direction === "BUY"
      ? latestBar.bid || latestBar.close
      : latestBar.ask || latestBar.close;
    const nextProfitLevel = direction === "BUY"
      ? roundDistance(currentPrice + extension)
      : roundDistance(currentPrice - extension);
    const previousProfitLevel = Number(position.profitLevel || 0);

    if (previousProfitLevel > 0) {
      const improvesTarget = direction === "BUY"
        ? nextProfitLevel > previousProfitLevel + minMove
        : nextProfitLevel < previousProfitLevel - minMove;
      if (!improvesTarget) {
        continue;
      }
    }

    const stopLevel = moveStopOnTargetExtension
      ? buildProtectedStopLevel({
        position,
        direction,
        breakevenBufferDistance
      })
      : null;

    adjustments.push({
      dealId: position.dealId,
      direction,
      profitLevel: nextProfitLevel,
      stopLevel,
      previousStopLevel: position.stopLevel || null,
      previousProfitLevel: previousProfitLevel || null,
      reason: `extended TP${stopLevel ? " and protected SL" : ""} while ${direction.toLowerCase()} is profitable (${money(upl)}) and trend remains aligned`
    });
  }

  return adjustments;
}

function buildProtectedStopLevel({
  position,
  direction,
  breakevenBufferDistance
}) {
  const entry = Number(position.level || 0);
  if (!Number.isFinite(entry) || entry <= 0) {
    return null;
  }

  const buffer = Math.max(0, Number(breakevenBufferDistance || 0));
  const currentStop = Number(position.stopLevel || 0);
  const protectedStop = direction === "BUY"
    ? roundDistance(entry + buffer)
    : roundDistance(entry - buffer);

  if (currentStop > 0) {
    const improvesStop = direction === "BUY"
      ? protectedStop > currentStop
      : protectedStop < currentStop;
    if (!improvesStop) {
      return null;
    }
  }

  return protectedStop;
}

async function loadGoldTimeframeBars({
  client,
  bars,
  barsByResolution,
  epic,
  resolution,
  resolutions,
  count
}) {
  const normalizedResolutions = normalizeResolutions(resolutions, resolution);

  if (bars) {
    return [{
      resolution: normalizedResolutions[0],
      bars
    }];
  }

  if (barsByResolution) {
    const provided = normalizedResolutions
      .map((item) => ({
        resolution: item,
        bars: barsByResolution[item] || barsByResolution[item.toLowerCase()]
      }))
      .filter((item) => Array.isArray(item.bars));

    if (provided.length) {
      return provided;
    }
  }

  return fetchReducedCapitalTimeframes({
    client,
    epic,
    resolutions: normalizedResolutions,
    count
  });
}

async function fetchReducedCapitalTimeframes({
  client,
  epic,
  resolutions,
  count
}) {
  const byResolution = new Map();
  const standardResolutions = ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30"];
  const canBuildFromMinute = resolutions.every((item) => standardResolutions.includes(item));

  if (canBuildFromMinute) {
    const baseCount = Math.max(count, Number(defaultConfig.goldDemo.baseMinuteBars || 1500));
    const result = await fetchCapitalPricesWithMaxFallback({
      client,
      epic,
      resolution: "MINUTE",
      count: baseCount,
      symbol: "XAU/USD"
    });
    const minuteBars = result.bars;
    if (resolutions.includes("MINUTE")) {
      byResolution.set("MINUTE", minuteBars.slice(-count));
    }
    if (resolutions.includes("MINUTE_5")) {
      byResolution.set("MINUTE_5", aggregateBars(minuteBars, 5).slice(-count));
    }
    if (resolutions.includes("MINUTE_15")) {
      byResolution.set("MINUTE_15", aggregateBars(minuteBars, 15).slice(-count));
    }
    if (resolutions.includes("MINUTE_30")) {
      byResolution.set("MINUTE_30", aggregateBars(minuteBars, 30).slice(-count));
    }
  } else {
    await Promise.all(resolutions.map(async (item) => {
      const result = await fetchCapitalPricesWithMaxFallback({
        client,
        epic,
        resolution: item,
        count,
        symbol: "XAU/USD"
      });
      byResolution.set(item, result.bars);
    }));
  }

  return resolutions
    .filter((item) => byResolution.has(item))
    .map((item) => ({
      resolution: item,
      bars: byResolution.get(item)
    }));
}

async function fetchCapitalPricesWithMaxFallback(options) {
  const requestedCount = Number(options.count || 0);
  const fallbackCounts = unique([
    requestedCount,
    Math.min(requestedCount, 1000),
    Math.min(requestedCount, 500),
    Math.min(requestedCount, 300)
  ]).filter((value) => Number.isFinite(value) && value > 0);

  let lastError = null;
  for (const count of fallbackCounts) {
    try {
      return await fetchCapitalPrices({
        ...options,
        count
      });
    } catch (error) {
      lastError = error;
      if (!/invalid\.max/i.test(error.message)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function normalizeResolutions(resolutions, fallbackResolution) {
  const raw = Array.isArray(resolutions)
    ? resolutions
    : String(resolutions || fallbackResolution || "MINUTE_5").split(",");
  const normalized = raw
    .map((item) => normalizeResolution(item))
    .filter(Boolean);
  return unique(normalized.length ? normalized : [normalizeResolution(fallbackResolution)]);
}

function normalizeResolution(value) {
  return String(value || "MINUTE_5").trim().toUpperCase();
}

function extractOpenPositions(payload, epic) {
  const positions = (payload.positions || [])
    .map((item) => {
      const position = item.position || item;
      const market = item.market || {};
      return {
        epic: String(market.epic || position.epic || "").toUpperCase(),
        dealId: position.dealId,
        direction: position.direction,
        size: Number(position.size || 0),
        level: Number(position.level || 0),
        stopLevel: numberOrNull(position.stopLevel),
        profitLevel: numberOrNull(position.profitLevel),
        upl: Number(position.upl || 0)
      };
    });

  if (!epic) {
    return positions;
  }
  return positions.filter((position) => position.epic === String(epic).toUpperCase());
}

function extractAccountSnapshot({ accountsPayload, positions, fallbackEquity }) {
  const account = (accountsPayload.accounts || [])[0] || {};
  const balance = firstFinite(
    account.balance?.balance,
    account.balance?.available,
    account.balance,
    fallbackEquity
  );
  const available = firstFinite(
    account.balance?.available,
    account.balance?.balance,
    balance
  );
  const openPositionUpl = positions.reduce((sum, position) => sum + (Number(position.upl) || 0), 0);
  const equity = balance + openPositionUpl;

  return {
    currency: account.currency || defaultConfig.account.baseCurrency,
    balance,
    available,
    openPositionUpl,
    equity
  };
}

async function loadDailyState({
  state,
  stateFile,
  now,
  currentEquity,
  fallbackEquity,
  writeState
}) {
  const today = toDateKey(now);
  const loaded = state
    ? { ...state }
    : writeState
      ? await readDailyState(stateFile)
      : {};

  if (loaded.date !== today) {
    return {
      date: today,
      dayStartEquity: firstFinite(currentEquity, fallbackEquity),
      submittedEntryBarTimes: [],
      submittedEntries: []
    };
  }

  return {
    ...loaded,
    dayStartEquity: firstFinite(loaded.dayStartEquity, currentEquity, fallbackEquity),
    submittedEntryBarTimes: Array.isArray(loaded.submittedEntryBarTimes)
      ? loaded.submittedEntryBarTimes
      : [],
    submittedEntries: Array.isArray(loaded.submittedEntries)
      ? loaded.submittedEntries
      : []
  };
}

async function readDailyState(stateFile) {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch (_error) {
    return {};
  }
}

async function saveDailyState({ stateFile, state }) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function buildDailyGuard({
  currentEquity,
  dayStartEquity,
  dailyProfitTargetDollars,
  dailyMaxLossDollars,
  closePositionsOnDailyGuard
}) {
  const dailyPnl = currentEquity - dayStartEquity;
  const base = {
    status: "ACTIVE",
    reason: "Daily guard is inside limits.",
    blocksEntries: false,
    closeOpenPositions: false,
    dayStartEquity,
    currentEquity,
    dailyPnl,
    dailyProfitTargetDollars,
    dailyMaxLossDollars,
    recoveryMode: dailyPnl < 0 && dailyPnl > -dailyMaxLossDollars
  };

  if (dailyPnl >= dailyProfitTargetDollars) {
    return {
      ...base,
      status: "PROFIT_TARGET_HIT",
      reason: `${money(dailyPnl)} daily P/L is at or above ${money(dailyProfitTargetDollars)} target.`,
      blocksEntries: true,
      closeOpenPositions: Boolean(closePositionsOnDailyGuard)
    };
  }

  if (dailyPnl <= -dailyMaxLossDollars) {
    return {
      ...base,
      status: "MAX_LOSS_HIT",
      reason: `${money(dailyPnl)} daily P/L is at or below ${money(-dailyMaxLossDollars)} max loss.`,
      blocksEntries: true,
      closeOpenPositions: Boolean(closePositionsOnDailyGuard)
    };
  }

  return base;
}

function activeGuard() {
  return buildDailyGuard({
    currentEquity: defaultConfig.goldDemo.accountStartingCash,
    dayStartEquity: defaultConfig.goldDemo.accountStartingCash,
    dailyProfitTargetDollars: defaultConfig.goldDemo.dailyProfitTargetDollars,
    dailyMaxLossDollars: defaultConfig.goldDemo.dailyMaxLossDollars,
    closePositionsOnDailyGuard: defaultConfig.goldDemo.closePositionsOnDailyGuard
  });
}

function activeFrequencyGuard() {
  return {
    status: "ACTIVE",
    blocksEntries: false,
    reason: "Trade frequency guard is inside limits.",
    entriesToday: 0,
    entriesLastHour: 0,
    minutesSinceLastEntry: null
  };
}

function findRecentEntryFill({
  fills,
  bars,
  maxSignalAgeBars,
  maxEntryDriftBps,
  submittedEntryBarTimes,
  dedupeScope
}) {
  const latestBar = bars.at(-1);
  const latestBarIndex = bars.length - 1;
  const barIndexByTime = new Map(bars.map((bar, index) => [bar.time, index]));
  const maxAge = Math.max(0, Number(maxSignalAgeBars || 0));

  for (const fill of [...fills].reverse()) {
    if (!["LONG_ENTRY", "SHORT_ENTRY"].includes(fill.intent)) {
      continue;
    }

    const dedupeKey = scopedDedupeKey(dedupeScope, fill.time);
    if (submittedEntryBarTimes.includes(dedupeKey) || submittedEntryBarTimes.includes(fill.time)) {
      continue;
    }

    const fillIndex = barIndexByTime.get(fill.time);
    if (fillIndex === undefined) {
      continue;
    }

    const ageBars = latestBarIndex - fillIndex;
    if (ageBars < 0 || ageBars > maxAge) {
      continue;
    }

    const direction = fill.intent === "SHORT_ENTRY" ? "SELL" : "BUY";
    const currentEntryPrice = direction === "BUY"
      ? latestBar.ask || latestBar.close
      : latestBar.bid || latestBar.close;
    const driftBps = Math.abs((currentEntryPrice - fill.price) / fill.price) * 10000;
    if (driftBps > Number(maxEntryDriftBps || 0)) {
      continue;
    }

    return {
      setupType: ageBars === 0 ? "fresh-pullback" : "recent-pullback",
      direction,
      latestBarTime: fill.time,
      dedupeKey,
      reason: ageBars === 0
        ? fill.reason || "fresh Gold pullback entry"
        : `${fill.reason || "Gold pullback entry"} accepted ${ageBars} bars late (${driftBps.toFixed(1)} bps drift)`
    };
  }

  return null;
}

function buildTrendProbe({
  bars,
  submittedEntryBarTimes,
  dedupeScope,
  trendProbeMinBars = defaultConfig.goldDemo.trendProbeMinBars
}) {
  const latestBar = bars.at(-1);
  const previous = bars.at(-2);
  if (bars.length < Number(trendProbeMinBars || 50) || !latestBar || !previous) {
    return null;
  }

  const confidence = trendConfidence(bars);
  const atr = averageTrueRange(bars.slice(-15));
  const atrPct = latestBar.close > 0 ? atr / latestBar.close : 0;
  const bullish = confidence.bullish;
  const bearish = confidence.bearish;

  if (atrPct < 0.00015 || atrPct > 0.008) {
    return null;
  }

  const direction = bullish ? "BUY" : bearish ? "SELL" : null;
  if (!direction) {
    return null;
  }

  const rawDedupeKey = `trend-probe:${latestBar.time}:${direction}`;
  const dedupeKey = scopedDedupeKey(dedupeScope, rawDedupeKey);
  if (submittedEntryBarTimes.includes(dedupeKey) || submittedEntryBarTimes.includes(rawDedupeKey)) {
    return null;
  }

  return {
    setupType: "trend-probe",
    direction,
    latestBarTime: latestBar.time,
    dedupeKey,
    reason: `aggressive Gold trend-probe ${direction.toLowerCase()} with EMA stack and ATR ${atrPct.toFixed(5)}`
  };
}

function trendConfidence(bars) {
  const latestBar = bars.at(-1);
  const previous = bars.at(-2);
  if (bars.length < 30 || !latestBar || !previous) {
    return {
      bullish: false,
      bearish: false
    };
  }

  const closes = bars.map((bar) => bar.close);
  const fast = ema(closes, 9);
  const pullback = ema(closes, 21);
  const trend = ema(closes, 50);

  return {
    bullish: fast > pullback && pullback > trend && latestBar.close > previous.close && latestBar.close > fast,
    bearish: fast < pullback && pullback < trend && latestBar.close < previous.close && latestBar.close < fast
  };
}

function scopedDedupeKey(scope, key) {
  const normalizedScope = String(scope || "").trim().toUpperCase();
  return normalizedScope ? `${normalizedScope}:${key}` : key;
}

function ema(values, period) {
  const slice = values.slice(-Math.max(period * 3, period));
  const multiplier = 2 / (period + 1);
  let current = slice[0];
  for (const value of slice.slice(1)) {
    current = value * multiplier + current * (1 - multiplier);
  }
  return current;
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

function toDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

function formatNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}

function formatMaybeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? money(number) : "n/a";
}
