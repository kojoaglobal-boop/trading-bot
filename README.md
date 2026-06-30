# Cross-Market Trading Bot

This is a paper-first trading bot scaffold for experimenting across five market tracks:

- stocks
- gold / metals
- forex
- futures
- meme coins / crypto

The first version does **not** place real trades. That is intentional. A bot that can trade of its own accord needs a strong test harness, a risk engine, clear live-trading gates, and enough paper results to prove it is not just getting lucky in one market regime.

The engineering standard is documented in `SYSTEM_STANDARD.md`. The short version: no mystery data, no unchecked source, no strategy without proof, no live trading by default.

Market rollout order: stocks first, Gold/USD second, forex pairs third, futures fourth, meme coins last. Alpaca is the current stock paper broker; it is not the broker for every market.

## Quick Start

From this folder:

```powershell
node src/cli.js backtest --sample
node src/cli.js optimize --sample
node src/cli.js walk-forward --sample
node src/cli.js paper --ticks 200 --audit --db
node src/cli.js journal
node src/cli.js journal --db
node src/cli.js dashboard
node src/cli.js sources
node src/cli.js db
node src/cli.js alpaca account
node src/cli.js alpaca clock
node src/cli.js alpaca bars --symbols AAPL,TSLA,NVDA
node src/cli.js alpaca paper-loop --symbols AAPL,TSLA,NVDA --db
node src/cli.js alpaca sync
node src/cli.js scheduler run-once --symbols AAPL,TSLA,NVDA --confirm-paper
node src/cli.js oanda candles --instrument XAU_USD --db
node src/cli.js crypto bars --provider coinbase --product BTC-USD --db
node src/cli.js crypto bars --provider kraken --pair BTC/USD --db
node src/cli.js crypto quality --symbol BTC/USD --db
node src/cli.js backtest --db-source coinbase --db-symbols BTC/USD --db-limit 120 --db
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
npm run dashboard
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
npm run scheduler:once
npm run oanda:xau
npm run crypto:coinbase
npm run crypto:kraken
npm run crypto:quality
npm run excel:export
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
- `src/core/database-market-data.js` stores normalized bars and reloads them for real-data backtests.
- `src/core/excel-export.js` exports paper-trading records into CSV files that open in Excel.
- `compose.yaml` runs the local Postgres database in Docker.
- `db/schema.sql` defines the first persistent storage tables.
- `src/core/optimizer.js` runs parameter sweeps and walk-forward validation.
- `src/core/analytics.js` calculates closed trades, win rate, profit factor, payoff ratio, and expectancy.
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
node src/cli.js alpaca clock
node src/cli.js alpaca bars --symbols AAPL,TSLA,NVDA
```

For Finnhub stock news and catalyst checks, fill:

```text
FINNHUB_API_KEY=
```

Then verify the stock news connection:

```powershell
node src/cli.js finnhub news --symbol TSLA --limit 5
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
node src/cli.js alpaca paper-loop --symbols AAPL,TSLA,NVDA --db
```

To let that loop submit paper orders, add the explicit paper confirmation. The paper-training loop is capped at `$100` max buy notional by default and logs the estimated stop-risk and target profit for each order:

```powershell
node src/cli.js alpaca paper-loop --symbols AAPL,TSLA,NVDA --db --confirm-paper --max-notional 100 --target-rr 2.5
```

The paper loop also adds any existing open Alpaca paper positions to the monitored symbol list. That keeps exit checks active even if a symbol is accidentally left out of the requested basket.

Open stock positions are protected by the strategy using intrabar stop and target checks. If the same bar touches both levels, the bot treats the stop as hit first so paper results stay conservative.

When paper submission is enabled, the loop checks Alpaca's market clock first. If the stock market is closed, it logs the signals and approved plan but skips order submission.

Sync the Alpaca paper broker state into Postgres:

```powershell
node src/cli.js alpaca sync
```

That stores the latest account snapshot, open positions, recent orders, and recent fill activities.

Run the complete stock paper cycle in one command:

```powershell
node src/cli.js scheduler run-once --symbols AAPL,TSLA,NVDA --confirm-paper
```

That checks the database, runs the Alpaca stock paper loop, writes the run, syncs account/orders/fills, and exports the Excel ledger.

Run the faster stock scalp profile:

```powershell
node src/cli.js scheduler run-once --profile scalp --symbols AAPL,TSLA,NVDA --confirm-paper
```

The scalp profile uses 5-minute candles, tighter stops, a 1.3R target, and the same paper-only Alpaca guardrails. It is built to attempt more trades without opening real-money risk.

Daily paper guardrails are active for stock training:

- Stop opening fresh trades after daily P/L reaches **+$50**.
- Let existing positions keep being managed, so a good winner can still push toward **+$100**.
- Stop opening fresh trades after daily P/L reaches **-$50**.
- SELL exits stay allowed because reducing risk is still safer than freezing a position.

To keep it running every hour:

```powershell
node src/cli.js scheduler loop --symbols AAPL,TSLA,NVDA --confirm-paper --interval-minutes 60
```

To run the scalp profile repeatedly, it defaults to a 5-minute interval:

```powershell
node src/cli.js scheduler loop --profile scalp --symbols AAPL,TSLA,NVDA --confirm-paper
```

Pull Gold/USD candles through OANDA practice:

```powershell
node src/cli.js oanda candles --instrument XAU_USD --db
```

OANDA credentials needed in `.env`:

```text
OANDA_ACCOUNT_ID=
OANDA_API_TOKEN=
OANDA_ENV=practice
```

Check the practice account and confirm XAU/USD is tradable:

```powershell
node src/cli.js oanda account
node src/cli.js oanda instruments
```

Pull crypto/meme coin bars through our own normalized data layer:

```powershell
node src/cli.js crypto bars --provider coinbase --product BTC-USD --db
node src/cli.js crypto bars --provider kraken --pair BTC/USD --db
node src/cli.js crypto quality --symbol BTC/USD --db
```

Coinbase is the primary crypto source. Kraken is the independent fallback/check.
The quality command compares the latest stored bars and flags stale data, timestamp mismatch, or abnormal price disagreement.

Backtest directly from stored real-market bars:

```powershell
node src/cli.js backtest --db-source coinbase --db-symbols BTC/USD --db-limit 120 --db
```

For Coinbase/Kraken stored crypto bars, this command requires a fresh `PASS` data-quality check before the strategy runs.

For audit output:

```powershell
node src/cli.js backtest --sample --audit
node src/cli.js paper --ticks 200 --audit
```

Review saved audit logs:

```powershell
node src/cli.js journal
```

Show the current bot health dashboard:

```powershell
node src/cli.js dashboard
```

Write the same run to Postgres and read it back:

```powershell
node src/cli.js paper --ticks 200 --audit --db
node src/cli.js journal --db
```

## Excel Tracking

Postgres is the official record. Excel is for review and calculations.

Export the paper ledger:

```powershell
node src/cli.js export paper-ledger
```

That writes CSV files into `reports/paper-ledger/`:

- `paper_runs.csv`
- `paper_signals.csv`
- `paper_risk_decisions.csv`
- `paper_orders.csv`
- `paper_fills.csv`
- `paper_account_snapshots.csv`

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

## Paper Training Sizing

The current Alpaca paper-training profile is intentionally bigger than the original smoke-test size:

- max buy notional: `$100`
- target risk/reward: `1:2.5`
- target paper risk budget: `$30`, capped by available cash, exposure, and max notional
- manual one-off market smoke orders still cap at `$5`

On a `$100` stock position with a `3.5%` stop, actual stop-risk is about `$3.50`. To truly risk `$20-$30` per trade on a `$500` account, the bot would need a larger position, margin, or a much wider stop. For now, the paper loop logs the actual risk on the order it sends, so the numbers stay honest.

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
- `gold`
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

## Next Required Build Blocks

1. Run repeated Alpaca stock scheduler cycles and review the Excel ledger.
2. Add the dashboard for equity, open positions, blocked trades, source health, and recent decisions.
3. Add OANDA demo XAU/USD data and execution.
4. Add broader forex pairs after the XAU/USD track is clean.
5. Add strategy ensemble scoring across momentum, breakout, and mean-reversion candidates.
