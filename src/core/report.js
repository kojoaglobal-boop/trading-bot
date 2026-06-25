export function formatReport(report) {
  const { account, metrics, fills, rejections, positions } = report;
  const lines = [];

  lines.push("Cross-Market Trading Bot Report");
  lines.push("================================");
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Starting equity: ${money(account.startingCash)}`);
  lines.push(`Final equity:    ${money(account.finalEquity)}`);
  lines.push(`Net PnL:         ${money(account.netPnl)} (${pct(account.returnPct)})`);
  lines.push(`Max drawdown:    ${pct(metrics.maxDrawdownPct)}`);
  lines.push(`Bars processed:  ${metrics.bars}`);
  lines.push(`Decisions:       ${metrics.decisions}`);
  lines.push(`Fills:           ${metrics.fills}`);
  lines.push(`Closed trades:   ${metrics.closedTrades}`);
  lines.push(`Win rate:        ${pct(metrics.winRate)}`);
  lines.push(`Profit factor:   ${formatProfitFactor(metrics.profitFactor)}`);
  lines.push(`Rejected trades: ${metrics.rejections}`);

  if (report.sources?.length) {
    lines.push("");
    lines.push("Market Data Sources");
    for (const source of report.sources) {
      lines.push(
        `  ${source.provider.padEnd(16)} ${source.mode.padEnd(18)} ${source.bars} bars ${source.symbols.join(", ")}`
      );
    }
  }

  if (Object.keys(metrics.exposure).length) {
    lines.push("");
    lines.push("Exposure");
    for (const [assetClass, value] of Object.entries(metrics.exposure)) {
      lines.push(`  ${assetClass.padEnd(7)} ${money(value)}`);
    }
  }

  if (positions.length) {
    lines.push("");
    lines.push("Open Positions");
    for (const position of positions) {
      lines.push(
        `  ${position.symbol.padEnd(9)} qty=${formatNumber(position.quantity)} mark=${money(position.markPrice)} value=${money(position.marketValue)}`
      );
    }
  }

  if (fills.length) {
    lines.push("");
    lines.push("Recent Fills");
    for (const fill of fills.slice(-8)) {
      lines.push(
        `  ${fill.time} ${fill.side.padEnd(4)} ${fill.symbol.padEnd(9)} qty=${formatNumber(fill.quantity)} price=${money(fill.price)} reason=${fill.reason}`
      );
    }
  }

  if (rejections.length) {
    lines.push("");
    lines.push("Recent Rejections");
    for (const rejection of rejections.slice(-8)) {
      lines.push(
        `  ${rejection.time} ${rejection.action.padEnd(4)} ${rejection.symbol.padEnd(9)} ${rejection.reason}`
      );
    }
  }

  return lines.join("\n");
}

function money(value) {
  return `$${Number(value).toLocaleString("en-US", {
    maximumFractionDigits: value < 10 ? 5 : 2,
    minimumFractionDigits: value < 10 ? 2 : 2
  })}`;
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value) {
  if (Math.abs(value) >= 100) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(8);
}

function formatProfitFactor(value) {
  if (value === Infinity) return "Infinity";
  return Number(value).toFixed(2);
}
