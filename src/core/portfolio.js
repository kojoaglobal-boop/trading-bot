export class Portfolio {
  constructor({ startingCash }) {
    this.startingCash = startingCash;
    this.cash = startingCash;
    this.positions = new Map();
    this.realizedPnl = 0;
  }

  applyFill(fill) {
    const position = this.positions.get(fill.symbol) || {
      symbol: fill.symbol,
      assetClass: fill.assetClass,
      quantity: 0,
      avgPrice: 0,
      realizedPnl: 0
    };

    if (fill.side === "BUY") {
      const grossCost = fill.quantity * fill.price;
      const newQuantity = position.quantity + fill.quantity;
      const weightedCost = position.avgPrice * position.quantity + grossCost;
      position.quantity = newQuantity;
      position.avgPrice = newQuantity > 0 ? weightedCost / newQuantity : 0;
      this.cash -= grossCost + fill.commission;
    } else if (fill.side === "SELL") {
      const sellQuantity = Math.min(fill.quantity, position.quantity);
      const proceeds = sellQuantity * fill.price;
      const pnl = (fill.price - position.avgPrice) * sellQuantity - fill.commission;
      position.quantity -= sellQuantity;
      position.realizedPnl += pnl;
      this.realizedPnl += pnl;
      this.cash += proceeds - fill.commission;
    } else {
      throw new Error(`Unknown fill side: ${fill.side}`);
    }

    if (position.quantity <= 0.00000001) {
      this.positions.delete(fill.symbol);
    } else {
      this.positions.set(fill.symbol, position);
    }
  }

  getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  openPositionCount() {
    return this.positions.size;
  }

  snapshot(markPrices = new Map()) {
    const positions = [];
    let positionValue = 0;
    const exposureByAssetClass = {};

    for (const position of this.positions.values()) {
      const markPrice = markPrices.get(position.symbol) || position.avgPrice;
      const marketValue = position.quantity * markPrice;
      const unrealizedPnl = (markPrice - position.avgPrice) * position.quantity;
      positionValue += marketValue;
      exposureByAssetClass[position.assetClass] = (exposureByAssetClass[position.assetClass] || 0) + marketValue;

      positions.push({
        ...position,
        markPrice,
        marketValue,
        unrealizedPnl
      });
    }

    const equity = this.cash + positionValue;

    return {
      cash: this.cash,
      equity,
      realizedPnl: this.realizedPnl,
      positions,
      exposure: exposureByAssetClass
    };
  }
}
