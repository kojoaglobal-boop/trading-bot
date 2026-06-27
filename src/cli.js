#!/usr/bin/env node
import { defaultConfig } from "./config/default.js";
import { createAuditRecord, writeAuditRecord } from "./core/audit-log.js";
import { loadDotEnv } from "./core/env-loader.js";
import { runBacktest } from "./core/backtester.js";
import { loadCsvBars, createSampleBars } from "./core/market-data.js";
import { PaperBroker } from "./core/paper-broker.js";
import { Portfolio } from "./core/portfolio.js";
import { RiskEngine } from "./core/risk-engine.js";
import { formatReport } from "./core/report.js";
import { assertLiveTradingAllowed } from "./core/live-gateway.js";
import { formatJournal, loadAuditJournal } from "./core/journal.js";
import { formatDatabaseConfig, getDatabaseConfig } from "./core/database-config.js";
import { loadDatabaseJournal, writeAuditToDatabase } from "./core/database-journal.js";
import { writeAlpacaPaperRunToDatabase } from "./core/database-live.js";
import { formatAlpacaPaperLoop, runAlpacaPaperLoop } from "./core/alpaca-paper-loop.js";
import { formatAlpacaSync, syncAlpacaPaperState, writeAlpacaSyncToDatabase } from "./core/alpaca-sync.js";
import {
  formatSweepResult,
  formatWalkForwardResult,
  runParameterSweep,
  runWalkForwardValidation
} from "./core/optimizer.js";
import { formatSourceStatuses, getSourceStatuses } from "./core/source-registry.js";
import {
  AlpacaClient,
  createLimitCancelSmokeOrder,
  createTinyMarketOrder,
  formatAlpacaAccount,
  formatActivities,
  formatLatestBars,
  formatOrder,
  formatOrders,
  formatPositions,
  formatSmokeOrderResult
} from "./integrations/alpaca-client.js";
import { MomentumBreakoutStrategy } from "./strategies/momentum-breakout.js";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const envLoad = await loadDotEnv(args.env || ".env");

try {
  if (command === "backtest") {
    const bars = args.csv
      ? await loadCsvBars(args.csv)
      : createSampleBars({
          symbols: defaultConfig.universe,
          barsPerSymbol: Number(args.bars || 260),
          seed: Number(args.seed || 42)
        });

    const report = runSimulation(bars, "backtest");
    console.log(formatReport(report));
    await maybeWriteAudit(report, args);
  } else if (command === "optimize") {
    const bars = await loadBarsFromArgs(args, {
      defaultBars: Number(args.bars || 260),
      seed: Number(args.seed || 42)
    });
    const sweep = runParameterSweep({
      bars,
      createReport: (candidateBars, strategyOverrides) => runSimulation(
        candidateBars,
        "optimize",
        strategyOverrides
      ),
      limit: Number(args.limit || 10)
    });
    console.log(formatSweepResult(sweep));
  } else if (command === "walk-forward") {
    const bars = await loadBarsFromArgs(args, {
      defaultBars: Number(args.bars || 320),
      seed: Number(args.seed || 42)
    });
    const result = runWalkForwardValidation({
      bars,
      createReport: (candidateBars, strategyOverrides) => runSimulation(
        candidateBars,
        "walk-forward",
        strategyOverrides
      ),
      limit: Number(args.limit || 10),
      trainPct: Number(args.trainPct || 0.65)
    });
    console.log(formatWalkForwardResult(result));
  } else if (command === "paper") {
    const ticks = Number(args.ticks || 200);
    const bars = createSampleBars({
      symbols: defaultConfig.universe,
      barsPerSymbol: ticks,
      seed: Number(args.seed || Date.now() % 100000)
    });

    const report = runSimulation(bars, "paper");
    console.log(formatReport(report));
    console.log("\nMode: paper only. No real orders were placed.");
    await maybeWriteAudit(report, args);
  } else if (command === "doctor") {
    printDoctor(envLoad);
  } else if (command === "sources") {
    console.log(formatSourceStatuses(getSourceStatuses()));
  } else if (command === "journal") {
    const logs = args.db
      ? await loadDatabaseJournal({ limit: Number(args.limit || 12) })
      : await loadAuditJournal(args.logs || "logs");
    console.log(formatJournal(logs, { limit: Number(args.limit || 12) }));
  } else if (command === "db") {
    console.log(formatDatabaseConfig(getDatabaseConfig()));
  } else if (command === "alpaca") {
    await runAlpacaCommand(args);
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
}

async function runAlpacaCommand(args) {
  const subcommand = args._[1] || "help";
  const client = new AlpacaClient();

  if (subcommand === "account") {
    const account = await client.getAccount();
    console.log(formatAlpacaAccount(account));
    return;
  }

  if (subcommand === "bars") {
    const symbols = String(args.symbols || "TSLA,AAPL")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);
    const bars = await client.getLatestStockBars({
      symbols,
      feed: String(args.feed || "iex")
    });
    console.log(formatLatestBars(bars));
    return;
  }

  if (subcommand === "orders") {
    const orders = await client.listOrders({
      status: String(args.status || "open"),
      limit: Number(args.limit || 20),
      direction: String(args.direction || "desc")
    });
    console.log(formatOrders(orders));
    return;
  }

  if (subcommand === "positions") {
    const positions = await client.getPositions();
    console.log(formatPositions(positions));
    return;
  }

  if (subcommand === "fills") {
    const now = new Date();
    const activityDays = Number(args.days || args.activityDays || args["activity-days"] || 7);
    const fills = await client.getAccountActivities({
      activityType: "FILL",
      after: new Date(now.getTime() - activityDays * 24 * 60 * 60 * 1000).toISOString(),
      until: now.toISOString(),
      direction: String(args.direction || "desc"),
      pageSize: Number(args.limit || 50)
    });
    console.log(formatActivities(fills, { title: "Alpaca Fill Activities" }));
    return;
  }

  if (subcommand === "smoke-order") {
    assertPaperConfirmation(args);
    const order = createLimitCancelSmokeOrder({
      symbol: String(args.symbol || "AAPL"),
      side: String(args.side || "buy"),
      qty: String(args.qty || "1"),
      limitPrice: String(args.limitPrice || args.limit_price || "1.00")
    });
    const submitted = await client.submitOrder(order);
    let cancelStatus = "not attempted";
    let afterCancel = null;
    try {
      await client.cancelOrder(submitted.id);
      cancelStatus = "requested";
      afterCancel = await client.getOrder(submitted.id);
    } catch (error) {
      cancelStatus = `failed: ${error.message}`;
    }
    console.log(formatSmokeOrderResult({ submitted, cancelStatus, afterCancel }));
    return;
  }

  if (subcommand === "market-order") {
    assertPaperConfirmation(args);
    const order = createTinyMarketOrder({
      symbol: String(args.symbol || "AAPL"),
      side: String(args.side || "buy"),
      notional: String(args.notional || "1.00")
    });
    const submitted = await client.submitOrder(order);
    console.log(formatOrder(submitted));
    return;
  }

  if (subcommand === "paper-loop") {
    const submitOrders = Boolean(args["confirm-paper"]);
    const symbols = String(args.symbols || "TSLA,AAPL")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);
    const run = await runAlpacaPaperLoop({
      client,
      symbols,
      timeframe: String(args.timeframe || "1Hour"),
      bars: Number(args.bars || 80),
      feed: String(args.feed || "iex"),
      lookbackDays: Number(args.lookbackDays || args["lookback-days"] || 30),
      submitOrders,
      maxBuyNotional: Number(args.maxNotional || args["max-notional"] || 5)
    });

    console.log(formatAlpacaPaperLoop(run));

    if (args.db) {
      const result = await writeAlpacaPaperRunToDatabase(run);
      console.log(`Database live-paper run: ${result.runId} (${result.signals} signals, ${result.riskDecisions} risk decisions, ${result.orders} orders)`);
    }

    if (!submitOrders) {
      console.log("\nNo paper orders were submitted. Add --confirm-paper to allow Alpaca paper orders.");
    }
    return;
  }

  if (subcommand === "sync") {
    const sync = await syncAlpacaPaperState({
      client,
      status: String(args.status || "all"),
      limit: Number(args.limit || 100),
      activityDays: Number(args.days || args.activityDays || args["activity-days"] || 7)
    });
    const result = await writeAlpacaSyncToDatabase(sync);
    console.log(formatAlpacaSync(sync));
    console.log(`Database sync: ${result.runId} (${result.positions} positions, ${result.orders} orders, ${result.fills} fills)`);
    return;
  }

  console.log(`Alpaca Commands
===============
  node src/cli.js alpaca account
  node src/cli.js alpaca bars --symbols TSLA,AAPL --feed iex
  node src/cli.js alpaca orders
  node src/cli.js alpaca positions
  node src/cli.js alpaca fills
  node src/cli.js alpaca sync
  node src/cli.js alpaca smoke-order --confirm-paper
  node src/cli.js alpaca market-order --symbol AAPL --notional 1 --confirm-paper
  node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db
  node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db --confirm-paper
`);
}

function assertPaperConfirmation(args) {
  if (!args["confirm-paper"]) {
    throw new Error("Refusing to submit even a paper order without --confirm-paper.");
  }
}

async function loadBarsFromArgs(args, { defaultBars, seed }) {
  return args.csv
    ? loadCsvBars(args.csv)
    : createSampleBars({
        symbols: defaultConfig.universe,
        barsPerSymbol: defaultBars,
        seed
      });
}

function runSimulation(bars, mode, strategyOverrides = {}) {
  const portfolio = new Portfolio({
    startingCash: defaultConfig.account.startingCash
  });

  const riskEngine = new RiskEngine(defaultConfig.risk);
  const broker = new PaperBroker(defaultConfig.execution.paper);
  const strategy = new MomentumBreakoutStrategy({
    ...defaultConfig.strategy.momentumBreakout,
    ...strategyOverrides
  });

  return runBacktest({
    bars,
    broker,
    config: defaultConfig,
    mode,
    portfolio,
    riskEngine,
    strategy
  });
}

async function maybeWriteAudit(report, args) {
  if (!args.audit && !args.db) {
    return;
  }

  const audit = createAuditRecord(report);

  if (args.audit) {
    const filePath = await writeAuditRecord(audit, {
      directory: typeof args.audit === "string" ? args.audit : "logs"
    });
    console.log(`\nAudit log: ${filePath}`);
  }

  if (args.db) {
    const result = await writeAuditToDatabase(audit);
    console.log(`Database audit: ${result.runId} (${result.fills} fills, ${result.rejections} rejections)`);
  }
}

function printDoctor(envLoad) {
  console.log("Trading Bot Doctor");
  console.log("==================");
  console.log(`Node: ${process.version}`);
  console.log(`.env: ${envLoad.loaded ? `loaded ${envLoad.keys.length} keys from ${envLoad.filePath}` : "not found"}`);
  console.log(`Universe: ${defaultConfig.universe.map((item) => item.symbol).join(", ")}`);
  console.log(`Starting cash: $${defaultConfig.account.startingCash.toLocaleString("en-US")}`);
  console.log(`Max trade risk: ${(defaultConfig.risk.maxRiskPerTradePct * 100).toFixed(2)}%`);
  console.log(`Max drawdown: ${(defaultConfig.risk.maxDrawdownPct * 100).toFixed(2)}%`);
  const database = getDatabaseConfig();
  console.log(`Database: ${database.user}@${database.host}:${database.port}/${database.database}`);

  try {
    assertLiveTradingAllowed();
  } catch (error) {
    console.log(`Live trading: blocked (${error.message})`);
  }

  const configured = getSourceStatuses().filter((source) => source.configured);
  console.log(`Configured sources: ${configured.map((source) => source.id).join(", ")}`);
}

function printHelp() {
  console.log(`Cross-Market Trading Bot

Usage:
  node src/cli.js backtest --sample
  node src/cli.js backtest --csv ./data/bars.csv
  node src/cli.js optimize --sample
  node src/cli.js walk-forward --sample
  node src/cli.js paper --ticks 200 --audit --db
  node src/cli.js journal
  node src/cli.js journal --db
  node src/cli.js db
  node src/cli.js alpaca account
  node src/cli.js alpaca bars --symbols TSLA,AAPL
  node src/cli.js alpaca paper-loop --symbols TSLA,AAPL --db
  node src/cli.js alpaca sync
  node src/cli.js alpaca smoke-order --confirm-paper
  node src/cli.js doctor
  node src/cli.js sources

Commands:
  backtest   Run the strategy over sample or CSV bar data
  optimize   Sweep strategy settings and rank candidates
  walk-forward
             Optimize on a train set, then test out-of-sample
  paper      Run a simulated paper session using generated market bars
  journal    Show saved audit-log summaries. Add --db to read Postgres.
  db         Show local Postgres database settings and commands
  alpaca     Check Alpaca paper account, market data, and guarded paper orders
  doctor     Print environment and safety-gate status
  sources    Show market-data, broker, and AI source configuration

Options:
  --env FILE  Load environment variables from FILE instead of .env
`);
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }

  return parsed;
}
