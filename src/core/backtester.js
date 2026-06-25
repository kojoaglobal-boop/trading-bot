import { analyzeFills } from "./analytics.js";
import { summarizeBarSources } from "./source-registry.js";

export function runBacktest({ bars, broker, config, mode, portfolio, riskEngine, strategy }) {
  if (!Array.isArray(bars) || bars.length === 0) {
    throw new Error("No market bars supplied.");
  }

  const sortedBars = [...bars].sort((a, b) => {
    const timeDiff = Date.parse(a.time) - Date.parse(b.time);
    return timeDiff || a.symbol.localeCompare(b.symbol);
  });

  const groupedBars = groupBarsByTime(sortedBars);
  const equityCurve = [];
  const fills = [];
  const rejections = [];
  const decisions = [];
  const markPrices = new Map();

  for (const [time, currentBars] of groupedBars) {
    for (const bar of currentBars) {
      markPrices.set(bar.symbol, bar.close);
      const signal = strategy.onBar({
        bar,
        mode,
        portfolio,
        config
      });

      if (!signal || signal.action === "HOLD") {
        continue;
      }

      decisions.push({ time, signal });

      const riskResult = riskEngine.createOrder({
        bar,
        markPrices,
        portfolio,
        signal
      });

      if (!riskResult.approved) {
        rejections.push({
          time,
          symbol: bar.symbol,
          action: signal.action,
          reason: riskResult.reason
        });
        continue;
      }

      const fill = broker.executeOrder(riskResult.order, bar);
      portfolio.applyFill(fill);
      fills.push(fill);
    }

    const snapshot = portfolio.snapshot(markPrices);
    riskEngine.updateEquity(snapshot.equity);
    equityCurve.push({
      time,
      cash: snapshot.cash,
      equity: snapshot.equity,
      exposure: snapshot.exposure
    });
  }

  const finalSnapshot = portfolio.snapshot(markPrices);
  const tradeAnalytics = analyzeFills(fills);

  return {
    mode,
    sources: summarizeBarSources(sortedBars),
    account: {
      startingCash: portfolio.startingCash,
      finalCash: finalSnapshot.cash,
      finalEquity: finalSnapshot.equity,
      netPnl: finalSnapshot.equity - portfolio.startingCash,
      returnPct: finalSnapshot.equity / portfolio.startingCash - 1
    },
    positions: finalSnapshot.positions,
    metrics: {
      bars: sortedBars.length,
      decisions: decisions.length,
      fills: fills.length,
      rejections: rejections.length,
      closedTrades: tradeAnalytics.summary.closedTrades,
      winRate: tradeAnalytics.summary.winRate,
      profitFactor: tradeAnalytics.summary.profitFactor,
      grossProfit: tradeAnalytics.summary.grossProfit,
      grossLoss: tradeAnalytics.summary.grossLoss,
      averageTradePnl: tradeAnalytics.summary.averageTradePnl,
      maxDrawdownPct: calculateMaxDrawdown(equityCurve),
      exposure: finalSnapshot.exposure
    },
    fills,
    closedTrades: tradeAnalytics.closedTrades,
    rejections,
    equityCurve
  };
}

function groupBarsByTime(bars) {
  const grouped = new Map();

  for (const bar of bars) {
    if (!grouped.has(bar.time)) {
      grouped.set(bar.time, []);
    }
    grouped.get(bar.time).push(bar);
  }

  return grouped;
}

function calculateMaxDrawdown(equityCurve) {
  let peak = 0;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
    }
  }

  return maxDrawdown;
}
