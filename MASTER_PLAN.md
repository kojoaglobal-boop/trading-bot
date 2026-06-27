# Trading Bot Master Plan

This bot must be testable, source-transparent, and paper-first. No hidden feeds, no mystery signals, no live money until the system has a long paper-trading record.

The project standard is defined in `SYSTEM_STANDARD.md`. Every build step must serve the final system, not a temporary weak version.

## Current Working Stack

- Code editor: VS Code
- Runtime: Node.js and npm
- Research runtime: Python and pip
- Version control: Git
- Backup: GitHub
- Broker/data connected now: Alpaca paper account
- Alpaca paper account status: working
- Alpaca IEX market data: working
- Alpaca paper order smoke test: working
- Local database runtime: Docker Desktop with Postgres
- Default simulated capital: $500, matched to the current Alpaca paper account

## Current Information Sources

1. Alpaca paper account and paper order execution
   - Purpose: submit, cancel, and track simulated stock orders.
   - Docs: https://docs.alpaca.markets/us/docs/paper-trading
   - Order endpoint: https://docs.alpaca.markets/us/reference/postorder
   - Current paper loop: `node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db`
   - Current broker sync: `node src/cli.js alpaca sync`

2. Alpaca market data
   - Purpose: current stock bars using the free Basic IEX feed.
   - Docs: https://docs.alpaca.markets/us/docs/about-market-data-api
   - Note: Basic is enough for paper testing. Algo Trader Plus gives all-exchange real-time coverage, but we do not need it until the bot proves it needs it.

3. Generated sample data
   - Purpose: deterministic tests and backtests when offline.
   - Code: `src/core/market-data.js`

4. CSV data
   - Purpose: backtesting imported historical data from brokers or vendors.
   - Loader: `src/core/market-data.js`

5. Local Postgres database
   - Purpose: persistent storage for runs, bars, signals, risk decisions, orders, fills, and account snapshots.
   - Runtime: Docker Compose
   - Schema: `db/schema.sql`
   - Current app write path: `node src/cli.js paper --ticks 200 --audit --db`

## Next Information Sources To Add

1. Coinbase Advanced Trade API
   - Purpose: crypto and meme coin data/trading.
   - Docs: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/overview
   - Current public data command: `node src/cli.js crypto bars --provider coinbase --product BTC-USD --db`
   - Current quality gate: `node src/cli.js crypto quality --symbol BTC/USD --db`

2. OANDA demo API
   - Purpose: forex and XAU/USD style testing.
   - Docs: https://developer.oanda.com/rest-live-v20/introduction/

3. Databento
   - Purpose: high-quality historical and live data, especially futures and better market microstructure research.
   - Docs: https://databento.com/docs

4. Tradovate
   - Purpose: futures simulation and execution.
   - Docs: https://api.tradovate.com/

5. OpenAI API
   - Purpose: research assistant, news summarizer, trade journal reviewer, strategy explainer, and anomaly detector.
   - Important: AI should not bypass strategy code or risk checks.
   - Pricing: https://openai.com/api/pricing/

## Strategy Sources

The bot does not copy signals from a black-box service. It uses strategy modules that we can test and audit.

Current strategy:

- Momentum breakout
- Code: `src/strategies/momentum-breakout.js`
- Logic: buy strength only when trend, breakout, and volume conditions agree; exit on trend failure, stop loss, or giveback.

Strategy families to test:

1. Momentum / trend following
   - Research reference: Jegadeesh and Titman momentum paper, JSTOR link: https://www.jstor.org/stable/2328882
   - Use case: stocks, crypto, futures, forex.

2. Time-series momentum
   - Use case: markets that trend across time, especially futures and FX.

3. Mean reversion
   - Use case: liquid stocks, ETFs, spreads, and short-term overreaction.
   - Databento examples: https://databento.com/docs

4. Pairs / spread trading
   - Use case: correlated assets where the spread moves away from normal and then reverts.

5. Volatility breakout
   - Use case: meme coins, crypto, and futures when compression expands.

6. Sentiment/news-assisted filters
   - Use case: avoid trading into known event risk or add caution when news conflicts with price action.
   - Important: sentiment filters help risk decisions; they do not get direct order authority.

## Testing Ladder

1. Unit tests
   - Every strategy, risk rule, broker adapter, and parser gets tests.

2. Backtests
   - Use historical or generated bars.
   - Track return, drawdown, win rate, profit factor, trade count, and exposure.

3. Parameter sweeps
   - Test many strategy settings.
   - Avoid trusting one lucky configuration.

4. Walk-forward validation
   - Train on one period, test on unseen later data.
   - Current command: `node src/cli.js walk-forward --sample`

5. Paper trading
   - Use real broker paper API and real/current market data.
   - Current Alpaca smoke test: working.

6. Multi-source comparison
   - Compare Alpaca data against another provider before trusting any one feed.

7. Live shadow mode
   - Bot makes decisions and logs what it would trade, but does not place live orders.

8. Tiny live test
   - Only after long paper logs.
   - Small capital only.
   - Kill switch required.

## Apps To Install

Install now:

- Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/

Already installed:

- Git
- VS Code
- Node.js/npm
- Python/pip
- Docker Desktop

Do not install yet:

- PostgreSQL standalone. Use Docker later.
- DBeaver. Useful only after database is running.
- GitHub CLI. Optional because Git push already works.
- Postman. Optional because our CLI already tests APIs.

## Immediate Build Goals

1. Run repeated Alpaca paper-loop sessions and sync after each session.
2. Scheduler.
3. Dashboard.
4. OANDA demo adapter.
5. Strategy ensemble and scoring.
6. AI research/journal layer.

## Completed Final-System Blocks

- GitHub-backed repo, VS Code, Node.js, Python, WSL, Docker Desktop.
- Local Postgres database with durable tables for runs, bars, signals, decisions, orders, fills, account state, and data-quality checks.
- Alpaca paper account connection, guarded paper-order smoke test, paper loop, and broker sync.
- Alpaca paper-training sizing: `$100` max paper buy notional, `1:2.5` target R/R, actual risk/target logging.
- Coinbase and Kraken public crypto data ingestion into normalized market bars.
- Coinbase/Kraken stored-data quality gate.
- Stored crypto backtests require a fresh `PASS` quality gate before strategy execution.
- Real-data backtesting from Postgres bars.
- Expectancy, payoff ratio, average win/loss, profit factor, drawdown, and win-rate reporting.
