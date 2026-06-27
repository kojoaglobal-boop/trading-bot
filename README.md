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
node src/cli.js optimize --sample
node src/cli.js walk-forward --sample
node src/cli.js paper --ticks 200 --audit --db
node src/cli.js journal
node src/cli.js journal --db
node src/cli.js sources
node src/cli.js db
node src/cli.js alpaca account
node src/cli.js alpaca bars --symbols TSLA,AAPL
node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db
node src/cli.js alpaca sync
node src/cli.js crypto bars --provider coinbase --product BTC-USD --db
node src/cli.js alpaca smoke-order --confirm-paper
node --test
```

If `npm` works on your machine, these are equivalent:

```powershell
npm run backtest
npm run optimize
npm run walk-forward
npm run paper
npm run journal
npm run journal:db
npm run sources
npm run db
npm run alpaca:account
npm run alpaca:bars
npm run alpaca:orders
npm run alpaca:positions
npm run alpaca:fills
npm run alpaca:sync
npm run alpaca:smoke-order
npm run alpaca:paper-loop
npm run crypto:coinbase
npm run crypto:kraken
npm run crypto:quality
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
- `src/core/database-journal.js` writes audited runs, fills, and risk rejections to Postgres when `--db` is used.
- `compose.yaml` runs the local Postgres database in Docker.
- `db/schema.sql` defines the first persistent storage tables.
- `src/core/optimizer.js` runs parameter sweeps and walk-forward validation.
- `src/core/analytics.js` calculates closed trades, win rate, and profit factor.
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

To prepare local keys later:

```powershell
Copy-Item .env.example .env
```

Then fill in only the provider keys we decide to use. `.env` is ignored by Git.

For Alpaca paper trading, fill these values:

```text
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets
```

Then verify the connection:

```powershell
node src/cli.js alpaca account
node src/cli.js alpaca bars --symbols TSLA,AAPL
```

To prove order submission without intending to fill, run a guarded smoke test. It submits a deliberately low paper limit order and immediately cancels it:

```powershell
node src/cli.js alpaca smoke-order --confirm-paper
```

To place a tiny simulated market order later:

```powershell
node src/cli.js alpaca market-order --symbol AAPL --notional 1 --confirm-paper
```

Run one live-paper strategy cycle using Alpaca historical/current bars, risk checks, and Postgres logging:

```powershell
node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db
```

To let that loop submit paper orders, add the explicit paper confirmation. Buy orders are capped to a small notional by default:

```powershell
node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db --confirm-paper
```

Sync the Alpaca paper broker state into Postgres:

```powershell
node src/cli.js alpaca sync
```

That stores the latest account snapshot, open positions, recent orders, and recent fill activities.

Pull crypto/meme coin bars through our own normalized data layer:

```powershell
node src/cli.js crypto bars --provider coinbase --product BTC-USD --db
node src/cli.js crypto bars --provider kraken --pair BTC/USD --db
node src/cli.js crypto quality --symbol BTC/USD --db
```

Coinbase is the primary crypto source. Kraken is the independent fallback/check.
The quality command compares the latest stored bars and flags stale data, timestamp mismatch, or abnormal price disagreement.

For audit output:

```powershell
node src/cli.js backtest --sample --audit
node src/cli.js paper --ticks 200 --audit
```

Review saved audit logs:

```powershell
node src/cli.js journal
```

Write the same run to Postgres and read it back:

```powershell
node src/cli.js paper --ticks 200 --audit --db
node src/cli.js journal --db
```

## Local Database

Docker runs the local Postgres database. This is where the bot will store durable trade history, signals, risk decisions, orders, fills, account snapshots, and backtest runs.

Start the database:

```powershell
npm run db:up
```

Check it:

```powershell
npm run db:status
node src/cli.js db
```

Stop it:

```powershell
npm run db:down
```

The database schema lives in `db/schema.sql`. Docker applies it automatically the first time the database volume is created. Re-apply it manually with:

```powershell
npm run db:schema
```

## Current Strategy

The included starter strategy is a long-only momentum breakout system:

- buy when fast trend is above slow trend
- require price to break above a recent high
- require volume confirmation
- sell when trend rolls over

This is not a prediction machine or a promise of profit. It is a testable baseline that gives us a working loop: data in, signal out, risk check, paper fill, portfolio update, report.

## Strategy Research

Run a parameter sweep:

```powershell
node src/cli.js optimize --sample
```

Run walk-forward validation:

```powershell
node src/cli.js walk-forward --sample
```

Walk-forward testing optimizes on the first section of data and then tests the best candidates on unseen later data. That is more honest than choosing settings from one full-period backtest.

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
2. Use quality-approved Coinbase/Kraken crypto bars in the strategy engine.
3. Run repeated Alpaca paper-loop sessions and sync after each session.
4. Add a dashboard for current equity, open positions, blocked trades, and recent decisions.
