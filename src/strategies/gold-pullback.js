export class GoldPullbackStrategy {
  constructor({
    fastPeriod = 9,
    pullbackPeriod = 21,
    trendPeriod = 50,
    atrPeriod = 14,
    trendSlopeBars = 6,
    touchAtrMultiple = 0.75,
    stopAtrMultiple = 2,
    takeProfitRR = 2,
    maxHoldBars = 24,
    minAtrPct = 0.0002,
    maxAtrPct = 0.008,
    sessionUtcStartHour = 6,
    sessionUtcEndHour = 20
  } = {}) {
    this.fastPeriod = fastPeriod;
    this.pullbackPeriod = pullbackPeriod;
    this.trendPeriod = trendPeriod;
    this.atrPeriod = atrPeriod;
    this.trendSlopeBars = trendSlopeBars;
    this.touchAtrMultiple = touchAtrMultiple;
    this.stopAtrMultiple = stopAtrMultiple;
    this.takeProfitRR = takeProfitRR;
    this.maxHoldBars = maxHoldBars;
    this.minAtrPct = minAtrPct;
    this.maxAtrPct = maxAtrPct;
    this.sessionUtcStartHour = sessionUtcStartHour;
    this.sessionUtcEndHour = sessionUtcEndHour;
    this.history = new Map();
    this.entries = new Map();
  }

  onBar({ bar, portfolio }) {
    const history = this.history.get(bar.symbol) || [];
    history.push(bar);
    this.history.set(bar.symbol, history);

    const minBars = Math.max(this.trendPeriod + this.trendSlopeBars + 5, this.atrPeriod + 2);
    if (history.length < minBars) {
      return hold("warming up gold pullback engine");
    }

    const position = portfolio.getPosition(bar.symbol);
    if (!position) {
      this.entries.delete(bar.symbol);
    }

    const closes = history.map((item) => item.close);
    const fastEma = ema(closes, this.fastPeriod);
    const pullbackEma = ema(closes, this.pullbackPeriod);
    const trendEma = ema(closes, this.trendPeriod);
    const priorTrendEma = ema(closes.slice(0, -this.trendSlopeBars), this.trendPeriod);
    const atr = averageTrueRange(history.slice(-(this.atrPeriod + 1)), this.atrPeriod);

    if (!Number.isFinite(atr) || atr <= 0) {
      return hold("no valid ATR");
    }

    if (position) {
      return this.managePosition({ bar, history, position, atr });
    }

    if (!this.isActiveSession(bar.time)) {
      return hold("outside gold trading session");
    }

    const atrPct = atr / bar.close;
    if (atrPct < this.minAtrPct) {
      return hold("gold volatility too quiet");
    }
    if (atrPct > this.maxAtrPct) {
      return hold("gold volatility too hot");
    }

    const previous = history.at(-2);
    const bullishTrend = pullbackEma > trendEma && trendEma > priorTrendEma;
    const bearishTrend = pullbackEma < trendEma && trendEma < priorTrendEma;
    const touchedLongZone = bar.low <= pullbackEma + atr * this.touchAtrMultiple;
    const touchedShortZone = bar.high >= pullbackEma - atr * this.touchAtrMultiple;
    const bullishTrigger = bar.close > fastEma && bar.close > bar.open && bar.close > previous.close;
    const bearishTrigger = bar.close < fastEma && bar.close < bar.open && bar.close < previous.close;

    if (bullishTrend && touchedLongZone && bullishTrigger) {
      return this.entrySignal({
        action: "BUY",
        bar,
        atr,
        reason: "gold EMA trend pullback long"
      });
    }

    if (bearishTrend && touchedShortZone && bearishTrigger) {
      return this.entrySignal({
        action: "SHORT",
        bar,
        atr,
        reason: "gold EMA trend pullback short"
      });
    }

    return hold("no gold pullback setup");
  }

  entrySignal({ action, bar, atr, reason }) {
    const stopDistance = Math.max(atr * this.stopAtrMultiple, bar.close * 0.001);
    this.entries.set(bar.symbol, {
      side: action === "SHORT" ? "short" : "long",
      entryIndex: this.history.get(bar.symbol).length - 1,
      atr,
      stopDistance
    });

    return {
      action,
      symbol: bar.symbol,
      assetClass: bar.assetClass,
      stopLossPct: stopDistance / bar.close,
      targetRewardRiskRatio: this.takeProfitRR,
      confidence: 0.72,
      reason
    };
  }

  managePosition({ bar, history, position, atr }) {
    const metadata = this.entries.get(bar.symbol) || this.createPositionMetadata({
      bar,
      history,
      position,
      atr
    });
    this.entries.set(bar.symbol, metadata);

    if (metadata.entryIndex === undefined) {
      metadata.entryIndex = history.length - 1;
    }

    const stopDistance = Math.max(metadata.stopDistance, position.avgPrice * 0.001);
    const heldBars = history.length - metadata.entryIndex;

    if (position.side === "short") {
      const stopPrice = position.avgPrice + stopDistance;
      const targetPrice = position.avgPrice - stopDistance * this.takeProfitRR;
      const stopHit = bar.high >= stopPrice;
      const targetHit = !stopHit && bar.low <= targetPrice;
      const timedExit = heldBars >= this.maxHoldBars;

      if (stopHit || targetHit || timedExit) {
        return {
          action: "COVER",
          symbol: bar.symbol,
          assetClass: bar.assetClass,
          confidence: 0.82,
          reason: stopHit
            ? `gold pullback short stop at ${round(stopPrice)}`
            : targetHit
              ? `gold pullback short target at ${round(targetPrice)} (${this.takeProfitRR.toFixed(2)}R)`
              : `gold pullback short time exit after ${heldBars} bars`
        };
      }

      return hold("gold pullback short still valid");
    }

    const stopPrice = position.avgPrice - stopDistance;
    const targetPrice = position.avgPrice + stopDistance * this.takeProfitRR;
    const stopHit = bar.low <= stopPrice;
    const targetHit = !stopHit && bar.high >= targetPrice;
    const timedExit = heldBars >= this.maxHoldBars;

    if (stopHit || targetHit || timedExit) {
      return {
        action: "SELL",
        symbol: bar.symbol,
        assetClass: bar.assetClass,
        confidence: 0.82,
        reason: stopHit
          ? `gold pullback long stop at ${round(stopPrice)}`
          : targetHit
            ? `gold pullback long target at ${round(targetPrice)} (${this.takeProfitRR.toFixed(2)}R)`
            : `gold pullback long time exit after ${heldBars} bars`
      };
    }

    return hold("gold pullback long still valid");
  }

  createPositionMetadata({ bar, history, position, atr }) {
    const stopDistance = Math.max(atr * this.stopAtrMultiple, position.avgPrice * 0.001);
    return {
      side: position.side,
      entryIndex: history.length - 1,
      atr,
      stopDistance
    };
  }

  isActiveSession(time) {
    const hour = new Date(time).getUTCHours();
    if (this.sessionUtcStartHour <= this.sessionUtcEndHour) {
      return hour >= this.sessionUtcStartHour && hour < this.sessionUtcEndHour;
    }
    return hour >= this.sessionUtcStartHour || hour < this.sessionUtcEndHour;
  }
}

function averageTrueRange(bars, period) {
  if (bars.length < period + 1) {
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

  return average(ranges.slice(-period));
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

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hold(reason) {
  return {
    action: "HOLD",
    reason
  };
}

function round(value) {
  if (value < 0.01) return value.toFixed(8);
  if (value < 10) return value.toFixed(5);
  return value.toFixed(2);
}
