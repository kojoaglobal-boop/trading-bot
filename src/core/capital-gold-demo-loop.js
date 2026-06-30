import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultConfig } from "../config/default.js";
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
const DEFAULT_STATE_FILE = "logs/capital-gold-demo-state.json";

export async function runCapitalGoldDemoLoop({
  client = new CapitalClient(),
  bars,
  epic = "GOLD",
  resolution = "MINUTE_5",
  count = 300,
  size = defaultConfig.goldDemo.defaultSize,
  submitOrders = false,
  strategyOptions = DEFAULT_PULLBACK_OPTIONS,
  now = new Date(),
  accountStartingCash = defaultConfig.goldDemo.accountStartingCash,
  dailyProfitTargetDollars = defaultConfig.goldDemo.dailyProfitTargetDollars,
  dailyMaxLossDollars = defaultConfig.goldDemo.dailyMaxLossDollars,
  maxOpenPositions = defaultConfig.goldDemo.maxOpenPositions,
  closePositionsOnDailyGuard = defaultConfig.goldDemo.closePositionsOnDailyGuard,
  stateFile = DEFAULT_STATE_FILE,
  state,
  writeState = stateFile !== false
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
  const cycle = await runGoldPaperCycle({
    bars: priceBars,
    provider: "capital",
    strategy: "pullback",
    writeDatabase: false,
    ...DEFAULT_PULLBACK_OPTIONS,
    ...strategyOptions
  });
  const mergedStrategyOptions = {
    ...DEFAULT_PULLBACK_OPTIONS,
    ...strategyOptions
  };
  const decision = buildCapitalGoldDemoDecision({
    bars: priceBars,
    cycle,
    epic,
    openGoldPositions,
    size,
    strategyOptions: mergedStrategyOptions,
    dailyGuard,
    dailyState,
    maxOpenPositions
  });

  const submissions = [];
  const confirms = [];
  if (submitOrders) {
    if (decision.action === "OPEN") {
      const created = await client.createPosition(decision.order);
      submissions.push(created);
      if (created.dealReference) {
        confirms.push(await client.getConfirm(created.dealReference));
      }
      dailyState.submittedEntryBarTimes = unique([
        ...(dailyState.submittedEntryBarTimes || []),
        decision.latestBarTime
      ]).slice(-200);
      dailyState.lastSubmittedEntryBarTime = decision.latestBarTime;
    } else if (decision.action === "CLOSE_ALL") {
      for (const position of openGoldPositions) {
        if (!position.dealId) {
          continue;
        }
        const closed = await client.closePosition(position.dealId);
        submissions.push(closed);
        if (closed.dealReference) {
          confirms.push(await client.getConfirm(closed.dealReference));
        }
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
    resolution,
    bars: priceBars,
    account,
    dailyGuard,
    dailyState,
    maxOpenPositions,
    openGoldPositions,
    cycle,
    decision,
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
  dailyState = {},
  maxOpenPositions = defaultConfig.goldDemo.maxOpenPositions
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

  if (openGoldPositions.length >= maxOpenPositions) {
    return holdDecision(`Capital.com already has ${openGoldPositions.length}/${maxOpenPositions} open ${epic} demo position(s).`);
  }

  const latestFill = cycle.report.fills.at(-1);
  if (!latestFill || !["LONG_ENTRY", "SHORT_ENTRY"].includes(latestFill.intent)) {
    return holdDecision("No fresh Gold pullback entry on the latest bar.");
  }

  if (latestFill.time !== latestBar.time) {
    return holdDecision(`Last pullback entry was ${latestFill.time}; latest bar is ${latestBar.time}.`);
  }

  if ((dailyState.submittedEntryBarTimes || []).includes(latestFill.time)) {
    return holdDecision(`Gold entry for candle ${latestFill.time} was already submitted.`);
  }

  const orderSize = Number(size);
  if (!Number.isFinite(orderSize) || orderSize <= 0) {
    return holdDecision("No valid Capital.com demo size was configured.");
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
    openPositionsAfterFill: openGoldPositions.length + 1,
    maxOpenPositions,
    order: {
      epic,
      direction,
      size: orderSize,
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
  lines.push(`Equity:        ${money(result.account.equity)} (${result.account.currency})`);
  lines.push(`Day start:     ${money(result.dailyState.dayStartEquity)}`);
  lines.push(`Daily P/L:     ${money(result.dailyGuard.dailyPnl)} / target ${money(result.dailyGuard.dailyProfitTargetDollars)} / max loss ${money(-result.dailyGuard.dailyMaxLossDollars)}`);
  lines.push(`Daily guard:   ${result.dailyGuard.status}`);
  lines.push(`Open demo pos: ${result.openGoldPositions.length}/${result.maxOpenPositions}`);
  lines.push(`Paper P/L:     ${money(result.cycle.report.account.netPnl)} (${pct(result.cycle.report.account.returnPct)})`);
  lines.push(`Paper trades:  ${result.cycle.report.metrics.closedTrades}`);
  lines.push(`Paper PF:      ${formatRatio(result.cycle.report.metrics.profitFactor)}`);
  lines.push(`Decision:      ${result.decision.action}`);
  lines.push(`Reason:        ${result.decision.reason}`);

  if (result.openGoldPositions.length) {
    lines.push("");
    lines.push("Open Gold Positions");
    for (const position of result.openGoldPositions) {
      lines.push(`  ${position.direction || "n/a"} size=${formatNumber(position.size)} level=${formatMaybeMoney(position.level)} upl=${money(position.upl)} deal=${position.dealId || "n/a"}`);
    }
  }

  if (result.decision.order) {
    lines.push("");
    lines.push("Planned Demo Order");
    lines.push(`  ${result.decision.order.direction} ${result.decision.order.epic} size=${result.decision.order.size}`);
    lines.push(`  stopDistance=${result.decision.order.stopDistance} profitDistance=${result.decision.order.profitDistance}`);
    lines.push(`  would become position ${result.decision.openPositionsAfterFill}/${result.decision.maxOpenPositions}`);
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
      submittedEntryBarTimes: []
    };
  }

  return {
    ...loaded,
    dayStartEquity: firstFinite(loaded.dayStartEquity, currentEquity, fallbackEquity),
    submittedEntryBarTimes: Array.isArray(loaded.submittedEntryBarTimes)
      ? loaded.submittedEntryBarTimes
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
    dailyMaxLossDollars
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
