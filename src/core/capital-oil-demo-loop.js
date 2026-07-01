import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultConfig } from "../config/default.js";
import { CapitalClient, formatCapitalDealResult } from "../integrations/capital-client.js";
import { fetchCapitalPrices } from "./capital-market-data.js";
import { aggregateBars } from "../strategies/gold-trendline.js";
import { appendSubmittedEntry, buildTradeFrequencyGuard } from "./trade-frequency-guard.js";

const DEFAULT_STATE_FILE = "logs/capital-oil-demo-state.json";

export async function runCapitalOilDemoLoop({
  client = new CapitalClient(),
  bars,
  barsByResolution,
  epic = defaultConfig.oilDemo.epic,
  symbol = defaultConfig.oilDemo.symbol,
  resolution = "MINUTE_5",
  resolutions = defaultConfig.oilDemo.timeframes,
  count = 300,
  size = defaultConfig.oilDemo.defaultSize,
  minPositionSize = defaultConfig.oilDemo.minPositionSize,
  submitOrders = false,
  now = new Date(),
  accountStartingCash = defaultConfig.oilDemo.accountStartingCash,
  dailyProfitTargetDollars = defaultConfig.oilDemo.dailyProfitTargetDollars,
  dailyMaxLossDollars = defaultConfig.oilDemo.dailyMaxLossDollars,
  maxOpenPositions = defaultConfig.oilDemo.maxOpenPositions,
  closePositionsOnDailyGuard = defaultConfig.oilDemo.closePositionsOnDailyGuard,
  strategyOptions = {},
  manageProfitTargets = defaultConfig.oilDemo.manageProfitTargets,
  minProfitToExtendDollars = defaultConfig.oilDemo.minProfitToExtendDollars,
  profitTargetExtensionAtrMultiple = defaultConfig.oilDemo.profitTargetExtensionAtrMultiple,
  minProfitTargetMoveDistance = defaultConfig.oilDemo.minProfitTargetMoveDistance,
  moveStopOnTargetExtension = defaultConfig.oilDemo.moveStopOnTargetExtension,
  breakevenBufferDistance = defaultConfig.oilDemo.breakevenBufferDistance,
  inventoryBlackoutEnabled = defaultConfig.oilDemo.inventoryBlackoutEnabled,
  minMinutesBetweenEntries = defaultConfig.oilDemo.minMinutesBetweenEntries,
  maxEntriesPerHour = defaultConfig.oilDemo.maxEntriesPerHour,
  maxDailyEntries = defaultConfig.oilDemo.maxDailyEntries,
  stateFile = DEFAULT_STATE_FILE,
  state,
  writeState = stateFile !== false
} = {}) {
  if (submitOrders && client.environment !== "demo") {
    throw new Error(`Refusing Capital.com oil order because CAPITAL_ENV is ${client.environment}; demo only is allowed here.`);
  }

  const timeframeBars = await loadOilTimeframeBars({
    client,
    bars,
    barsByResolution,
    epic,
    symbol,
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
  const openOilPositions = allPositions.filter((position) => position.epic === String(epic).toUpperCase());
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
  const inventoryGuard = buildInventoryBlackoutGuard({
    now,
    enabled: inventoryBlackoutEnabled
  });
  const frequencyGuard = buildTradeFrequencyGuard({
    state: dailyState,
    now,
    minMinutesBetweenEntries,
    maxEntriesPerHour,
    maxDailyEntries
  });

  const profitTargetAdjustments = manageProfitTargets
    ? buildOilProfitTargetAdjustments({
      bars: primaryTimeframe.bars,
      openOilPositions,
      dailyGuard,
      minProfitToExtendDollars,
      profitTargetExtensionAtrMultiple,
      minProfitTargetMoveDistance,
      moveStopOnTargetExtension,
      breakevenBufferDistance
    })
    : [];
  const plannedOpenPositions = [...openOilPositions];
  const timeframeResults = [];

  for (const timeframe of timeframeBars) {
    const signal = buildOilMomentumSignal({
      bars: timeframe.bars,
      ...strategyOptions
    });
    const decision = buildCapitalOilDemoDecision({
      bars: timeframe.bars,
      signal,
      epic,
      openOilPositions: plannedOpenPositions,
      size,
      minPositionSize,
      maxOpenPositions,
      dailyGuard,
      inventoryGuard,
      frequencyGuard,
      dailyState,
      dedupeScope: timeframe.resolution,
      strategyOptions
    });
    timeframeResults.push({
      resolution: timeframe.resolution,
      bars: timeframe.bars,
      signal,
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

  const entryDecisions = timeframeResults
    .filter((result) => result.decision.action === "OPEN")
    .map((result) => ({
      ...result.decision,
      resolution: result.resolution,
      bars: result.bars
    }));
  const closeDecision = timeframeResults.find((result) => result.decision.action.startsWith("CLOSE"))?.decision;
  const decision = closeDecision || entryDecisions[0] || timeframeResults[0]?.decision || holdDecision("No Oil timeframe could be evaluated.");

  const submissions = [];
  const confirms = [];
  const profitTargetUpdates = [];
  if (submitOrders) {
    if (decision.action.startsWith("CLOSE")) {
      const positionsToClose = decision.closePositions || openOilPositions;
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
    mode: submitOrders ? "capital-oil-demo-order-enabled" : "decision-only",
    epic,
    symbol,
    resolution: primaryTimeframe.resolution,
    resolutions: timeframeBars.map((timeframe) => timeframe.resolution),
    bars: primaryTimeframe.bars,
    account,
    dailyGuard,
    inventoryGuard,
    frequencyGuard,
    dailyState,
    maxOpenPositions,
    openOilPositions,
    timeframeResults,
    entryDecisions,
    profitTargetAdjustments,
    profitTargetUpdates,
    decision,
    submissions,
    confirms,
    submitted: submissions[0] || null,
    confirm: confirms[0] || null
  };
}

export function buildCapitalOilDemoDecision({
  bars,
  signal,
  epic = defaultConfig.oilDemo.epic,
  openOilPositions = [],
  size = defaultConfig.oilDemo.defaultSize,
  minPositionSize = defaultConfig.oilDemo.minPositionSize,
  maxOpenPositions = defaultConfig.oilDemo.maxOpenPositions,
  dailyGuard = activeGuard(),
  inventoryGuard = inactiveInventoryGuard(),
  frequencyGuard = activeFrequencyGuard(),
  dailyState = {},
  dedupeScope = "",
  strategyOptions = {}
} = {}) {
  const latestBar = bars.at(-1);
  if (!latestBar) {
    return holdDecision("No Capital.com Oil bars were available.");
  }

  if (dailyGuard.closeOpenPositions && openOilPositions.length) {
    return {
      action: "CLOSE_ALL",
      reason: `${dailyGuard.status}: ${dailyGuard.reason}`,
      closePositions: openOilPositions
    };
  }

  if (dailyGuard.blocksEntries) {
    return holdDecision(`${dailyGuard.status}: ${dailyGuard.reason}`);
  }

  if (inventoryGuard.blocksEntries) {
    return holdDecision(inventoryGuard.reason);
  }

  const minimumSize = Number(minPositionSize || size || 0);
  const undersizedOpenPositions = Number.isFinite(minimumSize) && minimumSize > 0
    ? openOilPositions.filter((position) => Number(position.size || 0) > 0 && Number(position.size || 0) < minimumSize)
    : [];
  if (undersizedOpenPositions.length) {
    return {
      action: "CLOSE_UNDERSIZED",
      reason: `${undersizedOpenPositions.length} open ${epic} demo position(s) are below minimum size ${minimumSize}. Closing them before new oil entries.`,
      closePositions: undersizedOpenPositions
    };
  }

  if (openOilPositions.length >= maxOpenPositions) {
    return holdDecision(`Capital.com already has ${openOilPositions.length}/${maxOpenPositions} open ${epic} demo position(s).`);
  }

  if (frequencyGuard.blocksEntries) {
    return holdDecision(`${frequencyGuard.status}: ${frequencyGuard.reason}`);
  }

  const orderSize = Number(size);
  if (!Number.isFinite(orderSize) || orderSize <= 0) {
    return holdDecision("No valid Capital.com oil demo size was configured.");
  }

  if (!signal || signal.action !== "OPEN") {
    return holdDecision(signal?.reason || "No tradable Oil setup.");
  }

  const rawDedupeKey = signal.dedupeKey || `${signal.setupType}:${signal.latestBarTime}:${signal.direction}`;
  const dedupeKey = scopedDedupeKey(dedupeScope, rawDedupeKey);
  const submittedEntryBarTimes = dailyState.submittedEntryBarTimes || [];
  if (submittedEntryBarTimes.includes(dedupeKey) || submittedEntryBarTimes.includes(rawDedupeKey)) {
    return holdDecision("Oil setup already submitted for this candle.");
  }

  const stopDistance = calculateStopDistance({
    bars,
    stopAtrMultiple: Number(strategyOptions.stopAtrMultiple || defaultConfig.oilDemo.stopAtrMultiple)
  });
  const targetRR = Number(strategyOptions.targetRR || defaultConfig.oilDemo.targetRR);
  const profitDistance = stopDistance * targetRR;

  return {
    action: "OPEN",
    reason: signal.reason,
    latestBarTime: signal.latestBarTime,
    dedupeKey,
    setupType: signal.setupType,
    confidence: signal.confidence,
    openPositionsAfterFill: openOilPositions.length + 1,
    maxOpenPositions,
    order: {
      epic,
      direction: signal.direction,
      size: orderSize,
      stopDistance: roundDistance(stopDistance),
      profitDistance: roundDistance(profitDistance)
    }
  };
}

export function buildOilMomentumSignal({
  bars,
  breakoutLookback = defaultConfig.oilDemo.breakoutLookback,
  minAtrPct = defaultConfig.oilDemo.minAtrPct,
  maxAtrPct = defaultConfig.oilDemo.maxAtrPct,
  maxSpreadPct = defaultConfig.oilDemo.maxSpreadPct,
  minVolumeExpansion = defaultConfig.oilDemo.minVolumeExpansion
} = {}) {
  const minBars = Math.max(60, Number(breakoutLookback || 0) + 5);
  const latestBar = bars?.at(-1);
  const previous = bars?.at(-2);
  if (!bars || bars.length < minBars || !latestBar || !previous) {
    return holdDecision("Oil strategy is warming up.");
  }

  const atr = averageTrueRange(bars.slice(-20));
  const atrPct = latestBar.close > 0 ? atr / latestBar.close : 0;
  if (atrPct < minAtrPct) {
    return holdDecision(`Oil ATR ${atrPct.toFixed(5)} is too quiet for breakout scalping.`);
  }
  if (atrPct > maxAtrPct) {
    return holdDecision(`Oil ATR ${atrPct.toFixed(5)} is too wild for controlled entries.`);
  }

  const spreadPct = latestBar.bid && latestBar.ask && latestBar.close
    ? Math.abs(latestBar.ask - latestBar.bid) / latestBar.close
    : 0;
  if (spreadPct > maxSpreadPct) {
    return holdDecision(`Oil spread ${spreadPct.toFixed(5)} is too wide.`);
  }

  const previousBars = bars.slice(0, -1);
  const lookbackBars = previousBars.slice(-breakoutLookback);
  const breakoutHigh = Math.max(...lookbackBars.map((bar) => bar.high));
  const breakoutLow = Math.min(...lookbackBars.map((bar) => bar.low));
  const volumeAverage = average(lookbackBars.map((bar) => Number(bar.volume || 0)));
  const volumeExpansion = volumeAverage > 0
    ? Number(latestBar.volume || 0) / volumeAverage
    : 1;
  if (volumeExpansion < minVolumeExpansion) {
    return holdDecision(`Oil volume expansion ${volumeExpansion.toFixed(2)}x is too weak.`);
  }

  const trend = trendConfidence(bars);
  const bullishBreakout = trend.bullish && latestBar.close > breakoutHigh && latestBar.close > previous.close;
  const bearishBreakout = trend.bearish && latestBar.close < breakoutLow && latestBar.close < previous.close;
  const bullishRetest = trend.bullish && previous.low <= trend.fast && latestBar.close > previous.high && latestBar.close > trend.fast;
  const bearishRetest = trend.bearish && previous.high >= trend.fast && latestBar.close < previous.low && latestBar.close < trend.fast;
  const direction = bullishBreakout || bullishRetest
    ? "BUY"
    : bearishBreakout || bearishRetest
      ? "SELL"
      : null;

  if (!direction) {
    return holdDecision("No Oil breakout/retest setup with aligned EMA trend.");
  }

  const setupType = bullishBreakout || bearishBreakout
    ? "oil-breakout"
    : "oil-retest";
  const confidence = clamp(
    0.55
      + Math.min(0.2, Math.abs(trend.fast / trend.slow - 1) * 12)
      + Math.min(0.15, atrPct * 35)
      + Math.min(0.1, Math.max(0, volumeExpansion - 1) * 0.08),
    0.1,
    0.92
  );

  return {
    action: "OPEN",
    setupType,
    direction,
    latestBarTime: latestBar.time,
    dedupeKey: `${setupType}:${latestBar.time}:${direction}`,
    confidence,
    reason: `${setupType} ${direction.toLowerCase()} on Crude Oil: ATR ${atrPct.toFixed(5)}, volume ${volumeExpansion.toFixed(2)}x, spread ${spreadPct.toFixed(5)}`
  };
}

export function buildOilProfitTargetAdjustments({
  bars,
  openOilPositions = [],
  dailyGuard = activeGuard(),
  minProfitToExtendDollars = defaultConfig.oilDemo.minProfitToExtendDollars,
  profitTargetExtensionAtrMultiple = defaultConfig.oilDemo.profitTargetExtensionAtrMultiple,
  minProfitTargetMoveDistance = defaultConfig.oilDemo.minProfitTargetMoveDistance,
  moveStopOnTargetExtension = defaultConfig.oilDemo.moveStopOnTargetExtension,
  breakevenBufferDistance = defaultConfig.oilDemo.breakevenBufferDistance
} = {}) {
  if (!bars?.length || dailyGuard.blocksEntries || dailyGuard.closeOpenPositions) {
    return [];
  }

  const latestBar = bars.at(-1);
  const atr = averageTrueRange(bars.slice(-20));
  const trend = trendConfidence(bars);
  if (!latestBar || !Number.isFinite(atr) || atr <= 0) {
    return [];
  }

  const minProfit = Number(minProfitToExtendDollars || 0);
  const extension = Math.max(atr * Number(profitTargetExtensionAtrMultiple || 1.25), latestBar.close * 0.001);
  const minMove = Number(minProfitTargetMoveDistance || 0);
  const adjustments = [];

  for (const position of openOilPositions) {
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
      reason: `extended Oil TP${stopLevel ? " and protected SL" : ""} while ${direction.toLowerCase()} is profitable (${money(upl)}) and trend remains aligned`
    });
  }

  return adjustments;
}

export function buildInventoryBlackoutGuard({
  now = new Date(),
  enabled = defaultConfig.oilDemo.inventoryBlackoutEnabled,
  timeZone = defaultConfig.oilDemo.inventoryBlackoutTimeZone,
  weekday = defaultConfig.oilDemo.inventoryBlackoutWeekday,
  startMinute = defaultConfig.oilDemo.inventoryBlackoutStartMinute,
  endMinute = defaultConfig.oilDemo.inventoryBlackoutEndMinute
} = {}) {
  if (!enabled) {
    return inactiveInventoryGuard();
  }

  const parts = getTimeZoneParts(now, timeZone);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const active = parts.weekday === weekday && minutes >= startMinute && minutes <= endMinute;
  return {
    status: active ? "INVENTORY_BLACKOUT" : "ACTIVE",
    blocksEntries: active,
    reason: active
      ? "Oil inventory-report blackout is active; managing open trades only."
      : "Oil inventory-report blackout is inactive.",
    timeZone,
    localWeekday: parts.weekday,
    localTime: `${pad2(parts.hour)}:${pad2(parts.minute)}`
  };
}

export function formatCapitalOilDemoLoop(result) {
  const lines = [];
  const timeframeResults = result.timeframeResults || [];
  const entryDecisions = result.entryDecisions || [];
  const decisionAction = entryDecisions.length > 1
    ? "OPEN_MULTIPLE"
    : entryDecisions[0]?.action || result.decision.action;
  const decisionReason = entryDecisions.length > 1
    ? `${entryDecisions.length} Oil setup(s) across ${entryDecisions.map((decision) => decision.resolution).join(", ")}.`
    : entryDecisions[0]?.reason || result.decision.reason;

  lines.push("Capital.com Oil Demo Loop");
  lines.push("=========================");
  lines.push(`Created:       ${result.createdAt}`);
  lines.push(`Mode:          ${result.mode}`);
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
  lines.push(`Inventory:     ${result.inventoryGuard.status} ${result.inventoryGuard.localTime ? `(${result.inventoryGuard.localWeekday} ${result.inventoryGuard.localTime} ${result.inventoryGuard.timeZone})` : ""}`.trimEnd());
  lines.push(`Open demo pos: ${result.openOilPositions.length}/${result.maxOpenPositions}`);
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

  if (result.openOilPositions.length) {
    lines.push("");
    lines.push("Open Oil Positions");
    for (const position of result.openOilPositions) {
      lines.push(`  ${position.direction || "n/a"} size=${formatNumber(position.size)} level=${formatMaybeMoney(position.level)} tp=${formatMaybeMoney(position.profitLevel)} upl=${money(position.upl)} deal=${position.dealId || "n/a"}`);
    }
  }

  if ((result.profitTargetAdjustments || []).length) {
    lines.push("");
    lines.push("Oil Profit Target Adjustments");
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
    lines.push("Submitted Oil Demo Deals");
    for (const submission of result.submissions) {
      lines.push(formatCapitalDealResult(submission, {
        title: "Submitted Oil Demo Deal"
      }));
    }
  }

  if (result.confirms.length) {
    lines.push("");
    lines.push("Confirmed Oil Demo Deals");
    for (const confirm of result.confirms) {
      lines.push(formatCapitalDealResult(confirm, {
        title: "Confirmed Oil Demo Deal"
      }));
    }
  }

  return lines.join("\n");
}

async function loadOilTimeframeBars({
  client,
  bars,
  barsByResolution,
  epic,
  symbol,
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
    symbol,
    resolutions: normalizedResolutions,
    count
  });
}

async function fetchReducedCapitalTimeframes({
  client,
  epic,
  symbol,
  resolutions,
  count
}) {
  const byResolution = new Map();
  const standardResolutions = ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30"];
  const canBuildFromMinute = resolutions.every((item) => standardResolutions.includes(item));

  if (canBuildFromMinute) {
    const baseCount = Math.max(count, Number(defaultConfig.oilDemo.baseMinuteBars || 1000));
    const result = await fetchCapitalPricesWithMaxFallback({
      client,
      epic,
      resolution: "MINUTE",
      count: baseCount,
      symbol
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
        symbol
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
    currentEquity: defaultConfig.oilDemo.accountStartingCash,
    dayStartEquity: defaultConfig.oilDemo.accountStartingCash,
    dailyProfitTargetDollars: defaultConfig.oilDemo.dailyProfitTargetDollars,
    dailyMaxLossDollars: defaultConfig.oilDemo.dailyMaxLossDollars,
    closePositionsOnDailyGuard: defaultConfig.oilDemo.closePositionsOnDailyGuard
  });
}

function inactiveInventoryGuard() {
  return {
    status: "ACTIVE",
    blocksEntries: false,
    reason: "Oil inventory-report blackout is inactive."
  };
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

function calculateStopDistance({ bars, stopAtrMultiple }) {
  const atr = averageTrueRange(bars.slice(-20));
  const latestClose = bars.at(-1)?.close || 0;
  return Math.max(atr * stopAtrMultiple, latestClose * 0.0012);
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

function trendConfidence(bars) {
  const latestBar = bars.at(-1);
  const previous = bars.at(-2);
  if (bars.length < 50 || !latestBar || !previous) {
    return {
      bullish: false,
      bearish: false,
      fast: 0,
      slow: 0,
      trend: 0
    };
  }

  const closes = bars.map((bar) => bar.close);
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const trend = ema(closes, 50);

  return {
    bullish: fast > slow && slow > trend && latestBar.close > fast && latestBar.close >= previous.close,
    bearish: fast < slow && slow < trend && latestBar.close < fast && latestBar.close <= previous.close,
    fast,
    slow,
    trend
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

  return average(ranges);
}

function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    hour: Number(values.hour === "24" ? "0" : values.hour),
    minute: Number(values.minute)
  };
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

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function formatMaybeMoney(value) {
  if (value === undefined || value === null) {
    return "n/a";
  }
  return money(value);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
