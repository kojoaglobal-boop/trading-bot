export class RiskEngine {
  constructor(config) {
    this.config = config;
    this.peakEquity = 0;
    this.currentEquity = 0;
  }

  updateEquity(equity) {
    this.currentEquity = equity;
    this.peakEquity = Math.max(this.peakEquity, equity);
  }

  createOrder({ bar, markPrices, portfolio, signal }) {
    const snapshot = portfolio.snapshot(markPrices);
    this.updateEquity(snapshot.equity);

    const assetRejection = this.checkAssetAllowed(bar);
    if (assetRejection) {
      return reject(assetRejection);
    }

    if (signal.action === "BUY") {
      const entryRejection = this.checkEntryLimits({ bar, snapshot });
      if (entryRejection) {
        return reject(entryRejection);
      }

      return this.createBuyOrder({ bar, portfolio, signal, snapshot });
    }

    if (signal.action === "SELL") {
      return this.createSellOrder({ bar, portfolio, signal });
    }

    return reject(`unsupported action ${signal.action}`);
  }

  checkAssetAllowed(bar) {
    if (!this.config.allowedAssetClasses.includes(bar.assetClass)) {
      return `asset class ${bar.assetClass} is not allowed`;
    }

    return null;
  }

  checkEntryLimits({ bar, snapshot }) {
    if (this.peakEquity > 0) {
      const drawdown = (this.peakEquity - snapshot.equity) / this.peakEquity;
      if (drawdown >= this.config.maxDrawdownPct) {
        return `max drawdown reached (${(drawdown * 100).toFixed(2)}%)`;
      }
    }

    const spreadBps = calculateSpreadBps(bar);
    const maxSpreadBps = this.config.maxSpreadBps[bar.assetClass] ?? Infinity;
    if (spreadBps > maxSpreadBps) {
      return `spread too wide (${spreadBps.toFixed(1)} bps > ${maxSpreadBps} bps)`;
    }

    const minVolume = this.config.minVolume[bar.assetClass] ?? 0;
    if (bar.volume < minVolume) {
      return `volume too low (${bar.volume} < ${minVolume})`;
    }

    return null;
  }

  createBuyOrder({ bar, portfolio, signal, snapshot }) {
    if (portfolio.getPosition(bar.symbol)) {
      return reject("position already open");
    }

    if (portfolio.openPositionCount() >= this.config.maxOpenPositions) {
      return reject("max open positions reached");
    }

    const stopLossPct = Math.max(signal.stopLossPct || 0.02, 0.005);
    const riskBudget = this.calculateRiskBudget(snapshot);
    const riskBasedNotional = riskBudget / stopLossPct;
    const maxNotional = snapshot.equity * this.config.maxNotionalPerTradePct;
    const currentClassExposure = snapshot.exposure[bar.assetClass] || 0;
    const maxClassExposure = snapshot.equity * (this.config.maxAssetClassExposurePct[bar.assetClass] ?? 0.2);
    const availableClassExposure = Math.max(0, maxClassExposure - currentClassExposure);
    const availableCash = Math.max(0, snapshot.cash * 0.98);
    const notional = Math.min(riskBasedNotional, maxNotional, availableClassExposure, availableCash);

    if (notional <= 0) {
      return reject("no capacity for this trade");
    }

    const entryPrice = bar.ask || bar.close;
    const quantity = notional / entryPrice;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return reject("invalid order quantity");
    }

    const estimatedRiskDollars = notional * stopLossPct;
    const targetRewardRiskRatio = Number(signal.targetRewardRiskRatio || this.config.targetRewardRiskRatio || 0);

    return approve({
      symbol: bar.symbol,
      assetClass: bar.assetClass,
      side: "BUY",
      quantity,
      notional,
      expectedPrice: entryPrice,
      stopLossPct,
      riskBudget,
      estimatedRiskDollars,
      targetRewardRiskRatio,
      targetProfitDollars: targetRewardRiskRatio > 0 ? estimatedRiskDollars * targetRewardRiskRatio : null,
      reason: signal.reason
    });
  }

  calculateRiskBudget(snapshot) {
    const pctBudget = snapshot.equity * this.config.maxRiskPerTradePct;
    const targetBudget = Number(this.config.targetRiskPerTradeDollars || 0);
    return targetBudget > 0 ? targetBudget : pctBudget;
  }

  createSellOrder({ bar, portfolio, signal }) {
    const position = portfolio.getPosition(bar.symbol);
    if (!position) {
      return reject("no open position to sell");
    }

    return approve({
      symbol: bar.symbol,
      assetClass: bar.assetClass,
      side: "SELL",
      quantity: position.quantity,
      expectedPrice: bar.bid || bar.close,
      reason: signal.reason
    });
  }
}

function approve(order) {
  return {
    approved: true,
    order
  };
}

function reject(reason) {
  return {
    approved: false,
    reason
  };
}

function calculateSpreadBps(bar) {
  if (!bar.bid || !bar.ask || bar.close <= 0) {
    return 0;
  }
  return ((bar.ask - bar.bid) / bar.close) * 10000;
}
