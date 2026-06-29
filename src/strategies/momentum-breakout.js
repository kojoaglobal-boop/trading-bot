export class MomentumBreakoutStrategy {
  constructor({
    fastPeriod = 8,
    slowPeriod = 21,
    breakoutLookback = 18,
    minVolumeExpansion = 1.05,
    stopLossPct = 0.035,
    takeProfitRR = 2.5
  } = {}) {
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
    this.breakoutLookback = breakoutLookback;
    this.minVolumeExpansion = minVolumeExpansion;
    this.stopLossPct = stopLossPct;
    this.takeProfitRR = takeProfitRR;
    this.history = new Map();
  }

  onBar({ bar, portfolio }) {
    const history = this.history.get(bar.symbol) || [];
    history.push(bar);
    this.history.set(bar.symbol, history);

    const minBars = Math.max(this.slowPeriod, this.breakoutLookback) + 1;
    if (history.length < minBars) {
      return hold("warming up");
    }

    const currentPosition = portfolio.getPosition(bar.symbol);
    const previousBars = history.slice(0, -1);
    const fastSma = average(history.slice(-this.fastPeriod).map((item) => item.close));
    const slowSma = average(history.slice(-this.slowPeriod).map((item) => item.close));
    const breakoutHigh = Math.max(...previousBars.slice(-this.breakoutLookback).map((item) => item.high));
    const averageVolume = average(previousBars.slice(-this.slowPeriod).map((item) => item.volume));
    const hasTrend = fastSma > slowSma;
    const hasBreakout = bar.close > breakoutHigh;
    const hasVolume = bar.volume >= averageVolume * this.minVolumeExpansion;

    if (!currentPosition && hasTrend && hasBreakout && hasVolume) {
      return {
        action: "BUY",
        symbol: bar.symbol,
        assetClass: bar.assetClass,
        stopLossPct: this.stopLossPct,
        targetRewardRiskRatio: this.takeProfitRR,
        confidence: clamp((fastSma / slowSma - 1) * 15 + 0.55, 0.1, 0.95),
        reason: `momentum breakout above ${round(breakoutHigh)}`
      };
    }

    if (currentPosition) {
      const profitPct = bar.close / currentPosition.avgPrice - 1;
      const stopPrice = currentPosition.avgPrice * (1 - this.stopLossPct);
      const targetPrice = currentPosition.avgPrice * (1 + this.stopLossPct * this.takeProfitRR);
      const trendFailed = fastSma < slowSma;
      const stopFailed = profitPct <= -this.stopLossPct || Number(bar.low) <= stopPrice;
      const targetHit = !stopFailed && (
        profitPct >= this.stopLossPct * this.takeProfitRR ||
        Number(bar.high) >= targetPrice
      );
      const giveBack = profitPct > this.stopLossPct * 1.8 && bar.close < fastSma;

      if (trendFailed || stopFailed || targetHit || giveBack) {
        return {
          action: "SELL",
          symbol: bar.symbol,
          assetClass: bar.assetClass,
          stopPrice,
          targetPrice,
          confidence: 0.8,
          reason: stopFailed
            ? `stop loss at ${round(stopPrice)}`
            : targetHit
              ? `take profit at ${round(targetPrice)} (${this.takeProfitRR.toFixed(2)}R)`
              : "momentum exit"
        };
      }
    }

    return hold("no setup");
  }
}

function hold(reason) {
  return {
    action: "HOLD",
    reason
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  if (value < 0.01) return value.toFixed(8);
  if (value < 10) return value.toFixed(5);
  return value.toFixed(2);
}
