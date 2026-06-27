export function analyzeFills(fills) {
  const openLots = new Map();
  const closedTrades = [];

  for (const fill of fills) {
    if (fill.side === "BUY") {
      const lots = openLots.get(fill.symbol) || [];
      lots.push({
        symbol: fill.symbol,
        assetClass: fill.assetClass,
        quantity: fill.quantity,
        entryPrice: fill.price,
        entryTime: fill.time,
        entryCommission: fill.commission,
        reason: fill.reason
      });
      openLots.set(fill.symbol, lots);
      continue;
    }

    if (fill.side !== "SELL") {
      continue;
    }

    let remaining = fill.quantity;
    const lots = openLots.get(fill.symbol) || [];

    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const quantity = Math.min(remaining, lot.quantity);
      const entryCommission = lot.entryCommission * (quantity / lot.quantity);
      const exitCommission = fill.commission * (quantity / fill.quantity);
      const pnl = (fill.price - lot.entryPrice) * quantity - entryCommission - exitCommission;
      const returnPct = fill.price / lot.entryPrice - 1;

      closedTrades.push({
        symbol: fill.symbol,
        assetClass: fill.assetClass,
        quantity,
        entryTime: lot.entryTime,
        exitTime: fill.time,
        entryPrice: lot.entryPrice,
        exitPrice: fill.price,
        pnl,
        returnPct,
        entryReason: lot.reason,
        exitReason: fill.reason
      });

      lot.quantity -= quantity;
      remaining -= quantity;

      if (lot.quantity <= 0.00000001) {
        lots.shift();
      }
    }

    if (lots.length) {
      openLots.set(fill.symbol, lots);
    } else {
      openLots.delete(fill.symbol);
    }
  }

  const wins = closedTrades.filter((trade) => trade.pnl > 0);
  const losses = closedTrades.filter((trade) => trade.pnl < 0);
  const breakEvens = closedTrades.filter((trade) => trade.pnl === 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const netPnl = closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? -grossLoss / losses.length : 0;
  const lossRate = closedTrades.length ? losses.length / closedTrades.length : 0;
  const payoffRatio = averageLoss < 0
    ? averageWin / Math.abs(averageLoss)
    : averageWin > 0
      ? Infinity
      : 0;
  const expectancyPerTrade = closedTrades.length
    ? wins.length / closedTrades.length * averageWin - lossRate * Math.abs(averageLoss)
    : 0;
  const expectancyReturnPct = closedTrades.length
    ? closedTrades.reduce((sum, trade) => sum + trade.returnPct, 0) / closedTrades.length
    : 0;

  return {
    closedTrades,
    summary: {
      closedTrades: closedTrades.length,
      winners: wins.length,
      losers: losses.length,
      breakEvens: breakEvens.length,
      winRate: closedTrades.length ? wins.length / closedTrades.length : 0,
      lossRate,
      grossProfit,
      grossLoss,
      netPnl,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      averageTradePnl: closedTrades.length ? netPnl / closedTrades.length : 0,
      averageWin,
      averageLoss,
      payoffRatio,
      expectancyPerTrade,
      expectancyReturnPct,
      largestWin: wins.length ? Math.max(...wins.map((trade) => trade.pnl)) : 0,
      largestLoss: losses.length ? Math.min(...losses.map((trade) => trade.pnl)) : 0
    }
  };
}
