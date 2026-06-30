export class Portfolio {
  constructor({ startingCash, cash = startingCash, positions = [] }) {
    this.startingCash = startingCash;
    this.cash = cash;
    this.positions = new Map();
    this.realizedPnl = 0;

    for (const position of positions) {
      this.loadPosition(position);
    }
  }

  loadPosition({ symbol, assetClass, quantity, avgPrice, side = "long", realizedPnl = 0 }) {
    const parsedQuantity = Number(quantity);
    const parsedAvgPrice = Number(avgPrice);

    if (!symbol || !Number.isFinite(parsedQuantity) || parsedQuantity === 0) {
      return;
    }

    this.positions.set(symbol, {
      symbol,
      assetClass,
      side: normalizeSide(side, parsedQuantity),
      quantity: Math.abs(parsedQuantity),
      avgPrice: Number.isFinite(parsedAvgPrice) ? parsedAvgPrice : 0,
      realizedPnl: Number(realizedPnl) || 0
    });
  }

  applyFill(fill) {
    const existingPosition = this.positions.get(fill.symbol);
    const position = existingPosition || {
      symbol: fill.symbol,
      assetClass: fill.assetClass,
      side: fill.side === "SELL" ? "short" : "long",
      quantity: 0,
      avgPrice: 0,
      realizedPnl: 0
    };

    if (fill.side === "BUY") {
      if (position.side === "short") {
        this.closeShort(position, fill);
      } else {
        this.addLong(position, fill);
      }
    } else if (fill.side === "SELL") {
      if (existingPosition && position.side === "long") {
        this.closeLong(position, fill);
      } else {
        this.addShort(position, fill);
      }
    } else {
      throw new Error(`Unknown fill side: ${fill.side}`);
    }

    if (position.quantity <= 0.00000001) {
      this.positions.delete(fill.symbol);
    } else {
      this.positions.set(fill.symbol, position);
    }
  }

  addLong(position, fill) {
    const grossCost = fill.quantity * fill.price;
    const newQuantity = position.quantity + fill.quantity;
    const weightedCost = position.avgPrice * position.quantity + grossCost;
    position.side = "long";
    position.quantity = newQuantity;
    position.avgPrice = newQuantity > 0 ? weightedCost / newQuantity : 0;
    this.cash -= grossCost + fill.commission;
  }

  closeLong(position, fill) {
    const sellQuantity = Math.min(fill.quantity, position.quantity);
    const proceeds = sellQuantity * fill.price;
    const pnl = (fill.price - position.avgPrice) * sellQuantity - fill.commission;
    position.quantity -= sellQuantity;
    position.realizedPnl += pnl;
    this.realizedPnl += pnl;
    this.cash += proceeds - fill.commission;
  }

  addShort(position, fill) {
    const proceeds = fill.quantity * fill.price;
    const newQuantity = position.quantity + fill.quantity;
    const weightedProceeds = position.avgPrice * position.quantity + proceeds;
    position.side = "short";
    position.quantity = newQuantity;
    position.avgPrice = newQuantity > 0 ? weightedProceeds / newQuantity : 0;
    this.cash += proceeds - fill.commission;
  }

  closeShort(position, fill) {
    const coverQuantity = Math.min(fill.quantity, position.quantity);
    const coverCost = coverQuantity * fill.price;
    const pnl = (position.avgPrice - fill.price) * coverQuantity - fill.commission;
    position.quantity -= coverQuantity;
    position.realizedPnl += pnl;
    this.realizedPnl += pnl;
    this.cash -= coverCost + fill.commission;
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
      const signedQuantity = position.side === "short" ? -position.quantity : position.quantity;
      const marketValue = signedQuantity * markPrice;
      const unrealizedPnl = position.side === "short"
        ? (position.avgPrice - markPrice) * position.quantity
        : (markPrice - position.avgPrice) * position.quantity;
      positionValue += marketValue;
      exposureByAssetClass[position.assetClass] = (exposureByAssetClass[position.assetClass] || 0) + Math.abs(marketValue);

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

function normalizeSide(side, quantity) {
  if (String(side || "").toLowerCase() === "short" || Number(quantity) < 0) {
    return "short";
  }
  return "long";
}
