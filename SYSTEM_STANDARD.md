# Trading Bot System Standard

This project is not a toy bot and not a signal dashboard. Every component must be built as part of the final trading system, even while we are still using paper trading.

## Non-Negotiables

1. No mystery data.
   Every bar, signal, order, fill, rejection, and account snapshot must have a recorded source.

2. No single-source trust.
   Critical market data must be cross-checked where a second source is available.

3. No strategy without proof.
   A strategy must survive real-data backtests, parameter sweeps, walk-forward validation, and paper logs before it gets live authority.

4. No live trading by default.
   Live trading stays blocked until code gates, environment gates, paper results, and a kill switch all agree.

5. No win-rate worship.
   The scorecard is expectancy, profit factor, average win, average loss, drawdown, trade count, fees, slippage, and regime stability.

6. No fake risk numbers.
   Paper orders must log actual notional, estimated stop-risk, and target profit after any caps are applied.

7. No silent failures.
   Missing data, stale data, broken API calls, rejected trades, and abnormal source disagreement must be logged.

8. No untracked decisions.
   If the bot decides to trade or not trade, the reason must be stored.

9. No weak secrets handling.
   Real API keys stay in local `.env`, never Git, never chat, never logs.

10. No untested core logic.
   Every adapter, parser, risk rule, data-quality check, and strategy scoring module gets tests.

11. No app-before-engine.
    A dashboard comes after the backend produces real, audited state.

## Required System Blocks

1. Data ingestion
   Pull bars from trusted sources and normalize them into one internal format.

2. Data quality gate
   Compare sources, detect stale/missing/abnormal prices, and block bad data.

3. Historical store
   Store bars, runs, signals, orders, fills, account snapshots, and quality checks in Postgres.

4. Backtest engine
   Run strategies on real stored data and generated test data.

5. Expectancy analytics
   Measure whether the system has positive expectancy after fees, slippage, losses, and drawdown.

6. Strategy engine
   Run multiple strategy families under one common signal format.

7. Risk engine
   Enforce position sizing, drawdown, spread, liquidity, and exposure controls before orders.

8. Paper execution
   Submit only paper orders until the system proves itself.

9. Broker reconciliation
   Sync account state, positions, orders, and fills after execution.

10. Scheduler
    Run data pulls, quality checks, strategy loops, and sync on a controlled schedule.

11. Monitoring/dashboard
    Display current state, logs, and failures from the database.

12. Live gate
    Require explicit config, kill switch off, paper proof, and manual approval before live money.

## Strategy Acceptance Gate

A strategy is not accepted because it has a high win rate. It must show:

1. Positive expectancy per trade after fees and slippage.
2. Profit factor above 1 on meaningful trade count.
3. Controlled max drawdown under configured risk limits.
4. Stable behavior across parameter sweeps.
5. Out-of-sample survival through walk-forward validation.
6. Paper-trading logs that match backtest assumptions.
7. No dependency on one unchecked data source.
