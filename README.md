# Cross-Market Trading Bot

This is a paper-first trading bot scaffold for experimenting across four market families:

- meme coins / crypto
- stocks
- futures
- forex

The first version does **not** place real trades. That is intentional. A bot that can trade of its own accord needs a strong test harness, a risk engine, clear live-trading gates, and enough paper results to prove it is not just getting lucky in one market regime.

## Quick Start

From this folder:

```powershell
node src/cli.js backtest --sample
node src/cli.js paper --ticks 200 --audit
node src/cli.js sources
node --test
```

If `npm` works on your machine, these are equivalent:

```powershell
npm run backtest
npm run paper
npm run sources
npm test
```

## What Is Built

- `src/core/backtester.js` runs a strategy over historical bars.
- `src/core/paper-broker.js` simulates fills with slippage and commissions.
- `src/core/risk-engine.js` blocks trades that break risk limits.
- `src/core/portfolio.js` tracks cash, positions, equity, and realized PnL.
- `src/core/market-data.js` loads CSV bars or generates deterministic sample data.
- `src/core/source-registry.js` reports exactly which data, broker, and AI sources are configured.
- `src/core/audit-log.js` writes JSON run records when `--audit` is used.
- `src/strategies/momentum-breakout.js` contains the first strategy.
- `src/core/live-gateway.js` blocks live trading unless explicit gates are added later.

## Source Transparency

Run this to see which sources are available and which API keys are missing:

```powershell
node src/cli.js sources
```

Generated data and CSV imports are labeled in every report. Real integrations will need environment variables from `.env.example`. This matters because a serious bot should be able to answer:

- where did the price data come from?
- was the run simulated, historical, paper, sandbox, or live?
- which broker received the order?
- what risk rule approved or blocked the trade?
- where is the audit trail?

For audit output:

```powershell
node src/cli.js backtest --sample --audit
node src/cli.js paper --ticks 200 --audit
```

## Current Strategy

The included starter strategy is a long-only momentum breakout system:

- buy when fast trend is above slow trend
- require price to break above a recent high
- require volume confirmation
- sell when trend rolls over

This is not a prediction machine or a promise of profit. It is a testable baseline that gives us a working loop: data in, signal out, risk check, paper fill, portfolio update, report.

## CSV Format

Use this header for your own bars:

```csv
time,symbol,assetClass,open,high,low,close,volume,bid,ask
```

Accepted `assetClass` values:

- `meme`
- `stock`
- `future`
- `forex`

`bid` and `ask` are optional but strongly recommended for meme coins and forex because spread risk matters.

Example:

```powershell
node src/cli.js backtest --csv ./data/bars.csv
```

## Live Trading Gate

Live trading is deliberately blocked in this scaffold. Before we add broker adapters, the bot should have:

- repeatable backtests
- paper trading logs
- max drawdown controls
- max spread and liquidity checks
- per-asset exposure limits
- a kill switch
- broker-specific order validation
- small-size live shadow testing

The goal is not to make the bot fearless. The goal is to make it disciplined.

## Next Build Steps

1. Add real market data ingestion for one venue first.
2. Add persistent trade logs.
3. Add walk-forward testing and parameter sweeps.
4. Add a dashboard for current equity, open positions, blocked trades, and recent decisions.
5. Add broker adapters one at a time, starting with paper/sandbox endpoints.
