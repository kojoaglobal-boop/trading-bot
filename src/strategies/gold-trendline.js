export class GoldTrendlineStrategy {
  constructor({
    fastBiasPeriod = 8,
    slowBiasPeriod = 21,
    pivotDepth = 2,
    trendlineLookback = 36,
    maxPivotCandidates = 8,
    minTrendlineTouches = 2,
    maxTrendlineViolations = 1,
    touchAtrMultiple = 0.35,
    entryAtrMultiple = 0.7,
    stopAtrMultiple = 0.9,
    takeProfitRR = 1.6,
    minAtrPct = 0.0008,
    maxAtrPct = 0.008,
    sessionUtcStartHour = 6,
    sessionUtcEndHour = 20
  } = {}) {
    this.fastBiasPeriod = fastBiasPeriod;
    this.slowBiasPeriod = slowBiasPeriod;
    this.pivotDepth = pivotDepth;
    this.trendlineLookback = trendlineLookback;
    this.maxPivotCandidates = maxPivotCandidates;
    this.minTrendlineTouches = minTrendlineTouches;
    this.maxTrendlineViolations = maxTrendlineViolations;
    this.touchAtrMultiple = touchAtrMultiple;
    this.entryAtrMultiple = entryAtrMultiple;
    this.stopAtrMultiple = stopAtrMultiple;
    this.takeProfitRR = takeProfitRR;
    this.minAtrPct = minAtrPct;
    this.maxAtrPct = maxAtrPct;
    this.sessionUtcStartHour = sessionUtcStartHour;
    this.sessionUtcEndHour = sessionUtcEndHour;
    this.history = new Map();
  }

  onBar({ bar, portfolio }) {
    const history = this.history.get(bar.symbol) || [];
    history.push(bar);
    this.history.set(bar.symbol, history);

    const minBars = Math.max(120, this.slowBiasPeriod * 6);
    if (history.length < minBars) {
      return hold("warming up gold trendline engine");
    }

    const position = portfolio.getPosition(bar.symbol);
    const atr = averageTrueRange(history.slice(-24), 14);
    if (!Number.isFinite(atr) || atr <= 0) {
      return hold("no valid ATR");
    }

    if (position) {
      return this.managePosition({ bar, position, atr });
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

    const bars15 = aggregateBars(history.slice(-Math.max(this.trendlineLookback * 3 + 12, 140)), 15);
    const bars30 = aggregateBars(history.slice(-Math.max(this.slowBiasPeriod * 6 + 24, 180)), 30);
    if (bars15.length < this.trendlineLookback || bars30.length < this.slowBiasPeriod + 2) {
      return hold("waiting for multi-timeframe structure");
    }

    const bias = detectBias(bars30, this.fastBiasPeriod, this.slowBiasPeriod);
    if (bias === "neutral") {
      return hold("30m bias neutral");
    }

    if (bias === "bullish") {
      return this.longSetup({ bar, history, bars15, atr });
    }

    return this.shortSetup({ bar, history, bars15, atr });
  }

  managePosition({ bar, position, atr }) {
    const stopDistance = Math.max(atr * this.stopAtrMultiple, position.avgPrice * 0.001);

    if (position.side === "short") {
      const stopPrice = position.avgPrice + stopDistance;
      const targetPrice = position.avgPrice - stopDistance * this.takeProfitRR;
      const stopHit = bar.high >= stopPrice;
      const targetHit = !stopHit && bar.low <= targetPrice;

      if (stopHit || targetHit) {
        return {
          action: "COVER",
          symbol: bar.symbol,
          assetClass: bar.assetClass,
          confidence: 0.82,
          reason: stopHit
            ? `trendline short stop at ${round(stopPrice)}`
            : `trendline short target at ${round(targetPrice)} (${this.takeProfitRR.toFixed(2)}R)`
        };
      }
      return hold("short still valid");
    }

    const stopPrice = position.avgPrice - stopDistance;
    const targetPrice = position.avgPrice + stopDistance * this.takeProfitRR;
    const stopHit = bar.low <= stopPrice;
    const targetHit = !stopHit && bar.high >= targetPrice;

    if (stopHit || targetHit) {
      return {
        action: "SELL",
        symbol: bar.symbol,
        assetClass: bar.assetClass,
        confidence: 0.82,
        reason: stopHit
          ? `trendline long stop at ${round(stopPrice)}`
          : `trendline long target at ${round(targetPrice)} (${this.takeProfitRR.toFixed(2)}R)`
      };
    }

    return hold("long still valid");
  }

  longSetup({ bar, history, bars15, atr }) {
    const support = findBestTrendline({
      bars: bars15.slice(-this.trendlineLookback),
      pivotType: "low",
      expectedSlope: "up",
      pivotDepth: this.pivotDepth,
      maxPivotCandidates: this.maxPivotCandidates,
      touchTolerance: atr * this.touchAtrMultiple,
      maxViolations: this.maxTrendlineViolations
    });

    if (!support || support.touches < this.minTrendlineTouches) {
      return hold("no clean 15m support trendline");
    }

    const lineNow = projectLineToTime(support, bar.time);
    const previous = history.at(-2);
    const touched = bar.low <= lineNow + atr * this.touchAtrMultiple;
    const reclaimed = bar.close > lineNow && bar.close > bar.open;
    const momentum = previous && bar.close > previous.high;
    const notChasing = Math.abs(bar.close - lineNow) <= atr * this.entryAtrMultiple;

    if (touched && reclaimed && momentum && notChasing) {
      const stopDistance = Math.max(atr * this.stopAtrMultiple, bar.close - lineNow + atr * 0.2);
      return {
        action: "BUY",
        symbol: bar.symbol,
        assetClass: bar.assetClass,
        stopLossPct: stopDistance / bar.close,
        targetRewardRiskRatio: this.takeProfitRR,
        confidence: confidenceFromLine(support, "bullish"),
        reason: `5m bounce from 15m support trendline (${support.touches} touches)`
      };
    }

    return hold("waiting for 5m support bounce confirmation");
  }

  shortSetup({ bar, history, bars15, atr }) {
    const resistance = findBestTrendline({
      bars: bars15.slice(-this.trendlineLookback),
      pivotType: "high",
      expectedSlope: "down",
      pivotDepth: this.pivotDepth,
      maxPivotCandidates: this.maxPivotCandidates,
      touchTolerance: atr * this.touchAtrMultiple,
      maxViolations: this.maxTrendlineViolations
    });

    if (!resistance || resistance.touches < this.minTrendlineTouches) {
      return hold("no clean 15m resistance trendline");
    }

    const lineNow = projectLineToTime(resistance, bar.time);
    const previous = history.at(-2);
    const touched = bar.high >= lineNow - atr * this.touchAtrMultiple;
    const rejected = bar.close < lineNow && bar.close < bar.open;
    const momentum = previous && bar.close < previous.low;
    const notChasing = Math.abs(bar.close - lineNow) <= atr * this.entryAtrMultiple;

    if (touched && rejected && momentum && notChasing) {
      const stopDistance = Math.max(atr * this.stopAtrMultiple, lineNow - bar.close + atr * 0.2);
      return {
        action: "SHORT",
        symbol: bar.symbol,
        assetClass: bar.assetClass,
        stopLossPct: stopDistance / bar.close,
        targetRewardRiskRatio: this.takeProfitRR,
        confidence: confidenceFromLine(resistance, "bearish"),
        reason: `5m rejection from 15m resistance trendline (${resistance.touches} touches)`
      };
    }

    return hold("waiting for 5m resistance rejection confirmation");
  }

  isActiveSession(time) {
    const hour = new Date(time).getUTCHours();
    if (this.sessionUtcStartHour <= this.sessionUtcEndHour) {
      return hour >= this.sessionUtcStartHour && hour < this.sessionUtcEndHour;
    }
    return hour >= this.sessionUtcStartHour || hour < this.sessionUtcEndHour;
  }
}

export function aggregateBars(bars, minutes) {
  const buckets = new Map();

  for (const bar of bars) {
    const date = new Date(bar.time);
    const bucketMinute = Math.floor(date.getUTCMinutes() / minutes) * minutes;
    const bucketTime = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      bucketMinute
    );
    const key = new Date(bucketTime).toISOString();
    const current = buckets.get(key);

    if (!current) {
      buckets.set(key, {
        time: key,
        symbol: bar.symbol,
        assetClass: bar.assetClass,
        venue: bar.venue,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0,
        bid: bar.bid,
        ask: bar.ask,
        source: bar.source
      });
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume || 0;
    current.bid = bar.bid;
    current.ask = bar.ask;
  }

  return [...buckets.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function findBestTrendline({
  bars,
  pivotType,
  expectedSlope,
  pivotDepth = 2,
  maxPivotCandidates = 8,
  touchTolerance = 1,
  maxViolations = 1
}) {
  const pivots = findPivots(bars, pivotType, pivotDepth).slice(-maxPivotCandidates);
  let best = null;

  for (let left = 0; left < pivots.length - 1; left += 1) {
    for (let right = left + 1; right < pivots.length; right += 1) {
      const first = pivots[left];
      const second = pivots[right];
      const span = second.index - first.index;
      if (span <= 0) continue;

      const slope = (second.price - first.price) / span;
      if (expectedSlope === "up" && slope <= 0) continue;
      if (expectedSlope === "down" && slope >= 0) continue;

      const line = {
        pivotType,
        first,
        second,
        slope,
        intercept: first.price - slope * first.index,
        touches: 0,
        violations: 0,
        score: 0,
        baseTimeMs: Date.parse(bars[0].time),
        barMs: estimateBarMs(bars)
      };

      for (let index = first.index; index < bars.length; index += 1) {
        const projected = priceAtIndex(line, index);
        const candidate = pivotType === "low" ? bars[index].low : bars[index].high;
        const close = bars[index].close;
        const distance = Math.abs(candidate - projected);
        if (distance <= touchTolerance) {
          line.touches += 1;
        }

        if (pivotType === "low" && close < projected - touchTolerance) {
          line.violations += 1;
        }
        if (pivotType === "high" && close > projected + touchTolerance) {
          line.violations += 1;
        }
      }

      if (line.violations > maxViolations) {
        continue;
      }

      const age = bars.length - first.index;
      line.score = line.touches * 3 + age * 0.08 - line.violations * 4;
      if (!best || line.score > best.score) {
        best = line;
      }
    }
  }

  return best;
}

function findPivots(bars, type, depth) {
  const pivots = [];
  for (let index = depth; index < bars.length - depth; index += 1) {
    const window = bars.slice(index - depth, index + depth + 1);
    const value = type === "low" ? bars[index].low : bars[index].high;
    const extreme = type === "low"
      ? Math.min(...window.map((bar) => bar.low))
      : Math.max(...window.map((bar) => bar.high));
    const isUnique = window.filter((bar) => (type === "low" ? bar.low : bar.high) === value).length === 1;

    if (value === extreme && isUnique) {
      pivots.push({
        index,
        time: bars[index].time,
        price: value
      });
    }
  }
  return pivots;
}

function detectBias(bars, fastPeriod, slowPeriod) {
  const fast = ema(bars.map((bar) => bar.close), fastPeriod);
  const slow = ema(bars.map((bar) => bar.close), slowPeriod);
  const close = bars.at(-1).close;
  const previousSlow = ema(bars.slice(0, -1).map((bar) => bar.close), slowPeriod);
  const slowSlope = slow - previousSlow;
  const atr = averageTrueRange(bars.slice(-24), 14);

  if (fast > slow && close > slow && slowSlope > -atr * 0.03) {
    return "bullish";
  }
  if (fast < slow && close < slow && slowSlope < atr * 0.03) {
    return "bearish";
  }
  return "neutral";
}

function projectLineToTime(line, time) {
  const index = (Date.parse(time) - line.baseTimeMs) / line.barMs;
  return priceAtIndex(line, index);
}

function priceAtIndex(line, index) {
  return line.slope * index + line.intercept;
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

function estimateBarMs(bars) {
  if (bars.length < 2) {
    return 15 * 60 * 1000;
  }
  return Date.parse(bars.at(-1).time) - Date.parse(bars.at(-2).time);
}

function confidenceFromLine(line, bias) {
  const base = bias === "bullish" ? 0.55 : 0.53;
  return clamp(base + line.touches * 0.06 - line.violations * 0.08, 0.2, 0.92);
}

function hold(reason) {
  return {
    action: "HOLD",
    reason
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  if (value < 0.01) return value.toFixed(8);
  if (value < 10) return value.toFixed(5);
  return value.toFixed(2);
}
