export function createDailyTradingGuard({
  account,
  config = {},
  dailyStartEquity,
  tradingDay,
  now = new Date()
}) {
  const equity = Number(account?.portfolioValue ?? account?.portfolio_value ?? 0);
  const startEquity = Number.isFinite(Number(dailyStartEquity))
    ? Number(dailyStartEquity)
    : equity;
  const dailyPnl = equity - startEquity;
  const profitTargetDollars = Number(config.profitTargetDollars ?? 50);
  const profitStretchDollars = Number(config.profitStretchDollars ?? 100);
  const maxLossDollars = Number(config.maxLossDollars ?? 50);
  const status = getDailyGuardStatus({
    dailyPnl,
    profitTargetDollars,
    profitStretchDollars,
    maxLossDollars
  });

  return {
    tradingDay: tradingDay || formatTradingDay(now),
    startEquity,
    currentEquity: equity,
    dailyPnl,
    profitTargetDollars,
    profitStretchDollars,
    maxLossDollars,
    status,
    blockNewEntries: status !== "active"
  };
}

export function checkDailyEntryGuard(guard) {
  if (!guard?.blockNewEntries) {
    return null;
  }

  if (guard.status === "loss-limit-reached") {
    return `daily loss limit reached (${money(guard.dailyPnl)} <= -${money(guard.maxLossDollars)})`;
  }

  if (guard.status === "profit-stretch-reached") {
    return `daily profit stretch reached (${money(guard.dailyPnl)} >= ${money(guard.profitStretchDollars)})`;
  }

  if (guard.status === "profit-target-reached") {
    return `daily profit target reached (${money(guard.dailyPnl)} >= ${money(guard.profitTargetDollars)}); no fresh entries`;
  }

  return "daily trading guard blocked new entries";
}

function getDailyGuardStatus({
  dailyPnl,
  profitTargetDollars,
  profitStretchDollars,
  maxLossDollars
}) {
  if (dailyPnl <= -Math.abs(maxLossDollars)) {
    return "loss-limit-reached";
  }

  if (dailyPnl >= profitStretchDollars) {
    return "profit-stretch-reached";
  }

  if (dailyPnl >= profitTargetDollars) {
    return "profit-target-reached";
  }

  return "active";
}

function formatTradingDay(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}
