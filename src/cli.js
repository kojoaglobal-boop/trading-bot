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
import { formatDashboardSnapshot, loadDashboardSnapshot } from "./core/dashboard.js";
import { exportPaperLedger, formatPaperLedgerExport } from "./core/excel-export.js";
import { writeAlpacaPaperRunToDatabase } from "./core/database-live.js";
import { formatAlpacaPaperLoop, runAlpacaPaperLoop } from "./core/alpaca-paper-loop.js";
import { formatAlpacaSync, syncAlpacaPaperState, writeAlpacaSyncToDatabase } from "./core/alpaca-sync.js";
import { formatStockPaperCycle, runStockPaperCycle } from "./core/stock-paper-scheduler.js";
import { fetchCryptoBars, formatCryptoBars } from "./core/crypto-market-data.js";
import { fetchOandaCandles, formatOandaMarketData } from "./core/oanda-market-data.js";
import { loadMarketBars, upsertMarketBars } from "./core/database-market-data.js";
import {
  formatDataQualityCheck,
  requireStoredDataQualityPass,
  runStoredDataQualityCheck,
  writeDataQualityCheck
} from "./core/data-quality.js";
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
import {
  formatOandaAccountSummary,
  formatOandaInstruments,
  OandaClient
} from "./integrations/oanda-client.js";
import { MomentumBreakoutStrategy } from "./strategies/momentum-breakout.js";

const DEFAULT_STOCK_SYMBOLS = defaultConfig.stockPaper.symbols.join(",");
const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const envLoad = await loadDotEnv(args.env || ".env");

try {
  if (command === "backtest") {
    const bars = await loadBarsFromArgs(args, {
      defaultBars: Number(args.bars || 260),
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
  } else if (command === "dashboard") {
    const snapshot = await loadDashboardSnapshot({ limit: Number(args.limit || 8) });
    console.log(formatDashboardSnapshot(snapshot));
  } else if (command === "alpaca") {
    await runAlpacaCommand(args);
  } else if (command === "crypto") {
    await runCryptoCommand(args);
  } else if (command === "oanda") {
    await runOandaCommand(args);
  } else if (command === "export") {
    await runExportCommand(args);
  } else if (command === "scheduler") {
    await runSchedulerCommand(args);
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
    const symbols = String(args.symbols || DEFAULT_STOCK_SYMBOLS)
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
    const symbols = String(args.symbols || DEFAULT_STOCK_SYMBOLS)
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
      maxBuyNotional: Number(args.maxNotional || args["max-notional"] || defaultConfig.paperTraining.maxBuyNotional),
      targetRewardRiskRatio: Number(args.targetRR || args["target-rr"] || defaultConfig.paperTraining.targetRewardRiskRatio)
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
  node src/cli.js alpaca bars --symbols AAPL,TSLA,NVDA --feed iex
  node src/cli.js alpaca orders
  node src/cli.js alpaca positions
  node src/cli.js alpaca fills
  node src/cli.js alpaca sync
  node src/cli.js alpaca smoke-order --confirm-paper
  node src/cli.js alpaca market-order --symbol AAPL --notional 1 --confirm-paper
  node src/cli.js alpaca paper-loop --symbols AAPL,TSLA,NVDA --db
  node src/cli.js alpaca paper-loop --symbols AAPL,TSLA,NVDA --db --confirm-paper --max-notional 100 --target-rr 2.5
`);
}

async function runCryptoCommand(args) {
  const subcommand = args._[1] || "help";

  if (subcommand === "bars") {
    const result = await fetchCryptoBars({
      provider: String(args.provider || "coinbase").toLowerCase(),
      product: String(args.product || "BTC-USD"),
      pair: String(args.pair || "BTC/USD"),
      granularity: String(args.granularity || "ONE_HOUR"),
      interval: Number(args.interval || 60),
      limit: Number(args.limit || 120),
      lookbackDays: Number(args.lookbackDays || args["lookback-days"] || 30)
    });

    console.log(formatCryptoBars(result));

    if (args.db) {
      const stored = await upsertMarketBars(result.bars);
      console.log(`Database market bars: ${stored.bars} bars (${stored.symbols.join(", ")}) from ${stored.sources.join(", ")}`);
    }
    return;
  }

  if (subcommand === "quality") {
    const check = await runStoredDataQualityCheck({
      symbol: String(args.symbol || "BTC/USD").toUpperCase(),
      primarySource: String(args.primary || "coinbase").toLowerCase(),
      secondarySource: String(args.secondary || "kraken").toLowerCase(),
      maxCloseDiffBps: Number(args.maxCloseDiffBps || args["max-close-diff-bps"] || 35),
      warnCloseDiffBps: Number(args.warnCloseDiffBps || args["warn-close-diff-bps"] || 15),
      maxTimeDiffSeconds: Number(args.maxTimeDiffSeconds || args["max-time-diff-seconds"] || 3900),
      maxStaleSeconds: Number(args.maxStaleSeconds || args["max-stale-seconds"] || 7200)
    });

    console.log(formatDataQualityCheck(check));

    if (args.db) {
      const stored = await writeDataQualityCheck(check);
      console.log(`Database data-quality check: ${stored.symbol} ${stored.status} (${stored.reasons} reasons)`);
    }
    return;
  }

  console.log(`Crypto Commands
===============
  node src/cli.js crypto bars --provider coinbase --product BTC-USD --db
  node src/cli.js crypto bars --provider coinbase --product PEPE-USD --db
  node src/cli.js crypto bars --provider kraken --pair BTC/USD --db
  node src/cli.js crypto quality --symbol BTC/USD --db
`);
}

async function runOandaCommand(args) {
  const subcommand = args._[1] || "help";
  const client = new OandaClient();

  if (subcommand === "account") {
    const summary = await client.getAccountSummary();
    console.log(formatOandaAccountSummary(summary));
    return;
  }

  if (subcommand === "instruments") {
    const instruments = await client.getAccountInstruments();
    console.log(formatOandaInstruments(instruments, {
      limit: Number(args.limit || 30),
      focus: String(args.focus || "XAU_USD").toUpperCase()
    }));
    return;
  }

  if (subcommand === "candles") {
    const result = await fetchOandaCandles({
      client,
      instrument: String(args.instrument || "XAU_USD"),
      granularity: String(args.granularity || "H1"),
      count: Number(args.count || args.limit || 120),
      price: String(args.price || "M"),
      from: args.from,
      to: args.to
    });

    console.log(formatOandaMarketData(result));

    if (args.db) {
      const stored = await upsertMarketBars(result.bars);
      console.log(`Database market bars: ${stored.bars} bars (${stored.symbols.join(", ")}) from ${stored.sources.join(", ")}`);
    }
    return;
  }

  console.log(`OANDA Commands
==============
  node src/cli.js oanda account
  node src/cli.js oanda instruments
  node src/cli.js oanda candles --instrument XAU_USD
  node src/cli.js oanda candles --instrument XAU_USD --db
`);
}

async function runExportCommand(args) {
  const subcommand = args._[1] || "paper-ledger";

  if (subcommand !== "paper-ledger") {
    throw new Error(`Unknown export command: ${subcommand}`);
  }

  const result = await exportPaperLedger({
    outDir: String(args.out || "reports/paper-ledger"),
    limit: Number(args.limit || 500)
  });
  console.log(formatPaperLedgerExport(result));
}

async function runSchedulerCommand(args) {
  const subcommand = args._[1] || "help";

  if (subcommand === "run-once") {
    const cycle = await runStockPaperCycle(createStockPaperCycleOptions(args));
    console.log(formatStockPaperCycle(cycle));

    if (!cycle.submitted) {
      console.log("\nNo paper orders were submitted. Add --confirm-paper to allow Alpaca paper orders.");
    }
    return;
  }

  if (subcommand === "loop") {
    const intervalMinutes = Number(args.intervalMinutes || args["interval-minutes"] || 60);
    const cycles = Number(args.cycles || 0);
    let completed = 0;

    while (!cycles || completed < cycles) {
      const cycle = await runStockPaperCycle(createStockPaperCycleOptions(args));
      completed += 1;
      console.log(formatStockPaperCycle(cycle));

      if (cycles && completed >= cycles) {
        break;
      }

      const waitMs = Math.max(1, intervalMinutes) * 60 * 1000;
      const nextRunAt = new Date(Date.now() + waitMs).toISOString();
      console.log(`\nNext stock paper cycle: ${nextRunAt}`);
      await sleep(waitMs);
    }
    return;
  }

  console.log(`Scheduler Commands
==================
  node src/cli.js scheduler run-once --symbols AAPL,TSLA,NVDA
  node src/cli.js scheduler run-once --symbols AAPL,TSLA,NVDA --confirm-paper
  node src/cli.js scheduler loop --symbols AAPL,TSLA,NVDA --confirm-paper --interval-minutes 60
`);
}

function createStockPaperCycleOptions(args) {
  return {
    symbols: parseList(args.symbols || DEFAULT_STOCK_SYMBOLS),
    timeframe: String(args.timeframe || "1Hour"),
    bars: Number(args.bars || 80),
    feed: String(args.feed || "iex"),
    lookbackDays: Number(args.lookbackDays || args["lookback-days"] || 30),
    submitOrders: Boolean(args["confirm-paper"]),
    maxBuyNotional: Number(args.maxNotional || args["max-notional"] || defaultConfig.paperTraining.maxBuyNotional),
    targetRewardRiskRatio: Number(args.targetRR || args["target-rr"] || defaultConfig.paperTraining.targetRewardRiskRatio),
    exportOutDir: String(args.out || "reports/paper-ledger"),
    exportLimit: Number(args.limit || 500),
    writeDatabase: !args["no-db"],
    exportLedger: !args["no-export"]
  };
}

function assertPaperConfirmation(args) {
  if (!args["confirm-paper"]) {
    throw new Error("Refusing to submit even a paper order without --confirm-paper.");
  }
}

async function loadBarsFromArgs(args, { defaultBars, seed }) {
  if (args.csv) {
    return loadCsvBars(args.csv);
  }

  const dbSource = args.dbSource || args["db-source"];
  if (dbSource) {
    const symbols = parseList(args.dbSymbols || args["db-symbols"]);
    const mode = String(args.dbMode || args["db-mode"] || "public-market-data");
    const source = String(dbSource).toLowerCase();
    const bars = await loadMarketBars({
      source,
      mode,
      symbols,
      limit: Number(args.dbLimit || args["db-limit"] || defaultBars)
    });

    if (!bars.length) {
      throw new Error(`No database bars found for source=${dbSource} mode=${mode}${symbols.length ? ` symbols=${symbols.join(",")}` : ""}.`);
    }

    await requireQualityForStoredBars({
      source,
      mode,
      symbols: symbols.length ? symbols : [...new Set(bars.map((bar) => bar.symbol))]
    });

    return bars;
  }

  return createSampleBars({
    symbols: defaultConfig.universe,
    barsPerSymbol: defaultBars,
    seed
  });
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

async function requireQualityForStoredBars({ source, mode, symbols }) {
  if (mode !== "public-market-data" || !["coinbase", "kraken"].includes(source)) {
    return [];
  }

  return Promise.all(symbols.map((symbol) => requireStoredDataQualityPass({
    symbol,
    primarySource: "coinbase",
    secondarySource: "kraken"
  })));
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
  node src/cli.js backtest --db-source coinbase --db-symbols BTC/USD --db-limit 120
  node src/cli.js crypto quality --symbol BTC/USD --db
  node src/cli.js optimize --sample
  node src/cli.js walk-forward --sample
  node src/cli.js paper --ticks 200 --audit --db
  node src/cli.js journal
  node src/cli.js journal --db
  node src/cli.js dashboard
  node src/cli.js db
  node src/cli.js alpaca account
  node src/cli.js alpaca bars --symbols AAPL,TSLA,NVDA
  node src/cli.js alpaca paper-loop --symbols AAPL,TSLA,NVDA --db
  node src/cli.js alpaca sync
  node src/cli.js scheduler run-once --symbols AAPL,TSLA,NVDA --confirm-paper
  node src/cli.js oanda candles --instrument XAU_USD --db
  node src/cli.js crypto bars --provider coinbase --product BTC-USD --db
  node src/cli.js crypto quality --symbol BTC/USD --db
  node src/cli.js export paper-ledger
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
  dashboard  Show account, run, signal, order, source, and market-data health
  db         Show local Postgres database settings and commands
  alpaca     Check Alpaca paper account, market data, and guarded paper orders
  crypto     Pull public crypto/meme coin bars through the normalized data layer
  oanda      Pull OANDA practice candles for XAU/USD and forex pairs
  export     Export database tracking files that open in Excel
  scheduler  Run the stock paper loop, broker sync, and Excel export together
  doctor     Print environment and safety-gate status
  sources    Show market-data, broker, and AI source configuration

Options:
  --env FILE  Load environment variables from FILE instead of .env
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
