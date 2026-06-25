export class PaperBroker {
  constructor({ commissionBps = 0, slippageBps = {}, minCommission = 0 } = {}) {
    this.commissionBps = commissionBps;
    this.slippageBps = slippageBps;
    this.minCommission = minCommission;
  }

  executeOrder(order, bar) {
    const sideMultiplier = order.side === "BUY" ? 1 : -1;
    const quotedPrice = order.side === "BUY"
      ? bar.ask || bar.close
      : bar.bid || bar.close;
    const slippage = (this.slippageBps[bar.assetClass] || 0) / 10000;
    const fillPrice = quotedPrice * (1 + sideMultiplier * slippage);
    const notional = Math.abs(order.quantity * fillPrice);
    const commission = Math.max(this.minCommission, notional * (this.commissionBps / 10000));

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: bar.time,
      symbol: order.symbol,
      assetClass: order.assetClass,
      side: order.side,
      quantity: order.quantity,
      price: fillPrice,
      notional,
      commission,
      source: bar.source || null,
      reason: order.reason
    };
  }
}
