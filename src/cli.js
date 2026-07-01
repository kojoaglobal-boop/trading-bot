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
import { getPaperTrainingProfile } from "./core/paper-training-profile.js";
import { fetchCapitalPrices, formatCapitalMarketData } from "./core/capital-market-data.js";
import { formatCapitalGoldDemoLoop, runCapitalGoldDemoLoop } from "./core/capital-gold-demo-loop.js";
import { formatCapitalOilDemoLoop, runCapitalOilDemoLoop } from "./core/capital-oil-demo-loop.js";
import { fetchCryptoBars, formatCryptoBars } from "./core/crypto-market-data.js";
import { formatGoldPaperCycle, runGoldPaperCycle } from "./core/gold-paper-cycle.js";
import { formatGoldPullbackSweep, runGoldPullbackSweep } from "./core/gold-pullback-sweep.js";
import { formatGoldTrendlineSweep, runGoldTrendlineSweep } from "./core/gold-trendline-sweep.js";
import { fetchOandaCandles, formatOandaMarketData } from "./core/oanda-market-data.js";
import { loadMarketBars, upsertMarketBars } from "./core/database-market-data.js";
import { formatNewsSourcePlan, getNewsSourcePlan } from "./core/news-source-plan.js";
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
  formatAlpacaClock,
  formatLatestBars,
  formatOrder,
  formatOrders,
  formatPositions,
  formatSmokeOrderResult
} from "./integrations/alpaca-client.js";
import {
  CapitalClient,
  formatCapitalAccounts,
  formatCapitalDealResult,
  formatCapitalMarkets,
  formatCapitalPositions
} from "./integrations/capital-client.js";
import {
  formatOandaAccountSummary,
  formatOandaInstruments,
  OandaClient
} from "./integrations/oanda-client.js";
import {
  FinnhubClient,
  formatFinnhubCompanyNews
} from "./integrations/finnhub-client.js";
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
  } else if (command === "gold") {
    await runGoldCommand(args);
  } else if (command === "oil") {
    await runOilCommand(args);
  } else if (command === "capital") {
    await runCapitalCommand(args);
  } else if (command === "oanda") {
    await runOandaCommand(args);
  } else if (command === "finnhub") {
    await runFinnhubCommand(args);
  } else if (command === "news") {
    await runNewsCommand(args);
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

  if (subcommand === "clock") {
    const clock = await client.getClock();
    console.log(formatAlpacaClock(clock));
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

  if (subcommand === "close-position") {
    assertPaperConfirmation(args);
    const symbol = String(args.symbol || "").trim().toUpperCase();
    if (!symbol) {
      throw new Error("Add --symbol to close a paper position.");
    }

    const positions = await client.getPositions();
    const position = positions.find((item) => String(item.symbol || "").toUpperCase() === symbol);
    if (!position) {
      console.log(`No open Alpaca paper position found for ${symbol}.`);
      return;
    }

    const order = {
      symbol,
      qty: String(position.qty),
      side: "sell",
      type: "market",
      time_in_force: "day",
      client_order_id: `tb-close-${Date.now()}`
    };
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
      profile: String(args.profile || defaultConfig.paperTraining.defaultProfile || "standard"),
      timeframe: args.timeframe ? String(args.timeframe) : undefined,
      bars: optionalNumber(args.bars),
      feed: String(args.feed || "iex"),
      lookbackDays: optionalNumber(args.lookbackDays || args["lookback-days"]),
      submitOrders,
      maxBuyNotional: optionalNumber(args.maxNotional || args["max-notional"]),
      targetRewardRiskRatio: optionalNumber(args.targetRR || args["target-rr"])
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
  node src/cli.js alpaca clock
  node src/cli.js alpaca bars --feed iex
  node src/cli.js alpaca orders
  node src/cli.js alpaca positions
  node src/cli.js alpaca fills
  node src/cli.js alpaca sync
  node src/cli.js alpaca smoke-order --confirm-paper
  node src/cli.js alpaca market-order --symbol AAPL --notional 1 --confirm-paper
  node src/cli.js alpaca close-position --symbol TSLA --confirm-paper
  node src/cli.js alpaca paper-loop --db
  node src/cli.js alpaca paper-loop --db --confirm-paper --max-notional 100 --target-rr 2.5
  node src/cli.js alpaca paper-loop --profile scalp --db --confirm-paper
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

async function runGoldCommand(args) {
  const subcommand = args._[1] || "paper-cycle";

  if (subcommand === "paper-cycle") {
    const provider = args.provider ? String(args.provider).toLowerCase() : undefined;
    const defaultInstrument = provider === "capital" ? "GOLD" : "XAU_USD";
    const cycle = await runGoldPaperCycle({
      sample: Boolean(args.sample),
      instrument: String(args.instrument || args.epic || defaultInstrument),
      epic: args.epic ? String(args.epic) : undefined,
      provider,
      granularity: String(args.granularity || "M5"),
      resolution: args.resolution ? String(args.resolution) : undefined,
      strategy: args.strategy ? String(args.strategy) : undefined,
      count: Number(args.count || args.limit || 300),
      seed: Number(args.seed || 42),
      writeDatabase: !args["no-db"],
      targetRR: optionalNumber(args.targetRR || args["target-rr"]),
      stopLossPct: optionalNumber(args.stopLossPct || args["stop-loss-pct"]),
      touchAtrMultiple: optionalNumber(args.touchAtrMultiple || args["touch-atr-multiple"]),
      stopAtrMultiple: optionalNumber(args.stopAtrMultiple || args["stop-atr-multiple"]),
      maxHoldBars: optionalNumber(args.maxHoldBars || args["max-hold-bars"]),
      minAtrPct: optionalNumber(args.minAtrPct || args["min-atr-pct"]),
      maxAtrPct: optionalNumber(args.maxAtrPct || args["max-atr-pct"]),
      maxSpreadBps: optionalNumber(args.maxSpreadBps || args["max-spread-bps"]),
      minVolume: optionalNumber(args.minVolume || args["min-volume"]),
      maxNotionalPerTradePct: optionalNumber(args.maxNotionalPerTradePct || args["max-notional-pct"]),
      maxGoldExposurePct: optionalNumber(args.maxGoldExposurePct || args["max-gold-exposure-pct"]),
      maxGrossLeverage: optionalNumber(args.maxGrossLeverage || args["max-gross-leverage"]),
      targetRiskDollars: optionalNumber(args.targetRiskDollars || args["target-risk-dollars"]),
      commissionBps: optionalNumber(args.commissionBps || args["commission-bps"]),
      minCommission: optionalNumber(args.minCommission || args["min-commission"]),
      slippageBps: optionalNumber(args.slippageBps || args["slippage-bps"])
    });
    console.log(formatGoldPaperCycle(cycle));
    return;
  }

  if (subcommand === "trendline-sweep") {
    const sweep = await runGoldTrendlineSweep({
      source: String(args.source || args.dbSource || args["db-source"] || "capital").toLowerCase(),
      mode: String(args.mode || args.dbMode || args["db-mode"] || "demo-market-data"),
      symbol: String(args.symbol || "XAU/USD").toUpperCase(),
      limit: Number(args.limit || 300),
      maxResults: Number(args.maxResults || args["max-results"] || 12)
    });
    console.log(formatGoldTrendlineSweep(sweep));
    return;
  }

  if (subcommand === "pullback-sweep") {
    const sweep = await runGoldPullbackSweep({
      source: String(args.source || args.dbSource || args["db-source"] || "capital").toLowerCase(),
      mode: String(args.mode || args.dbMode || args["db-mode"] || "demo-market-data"),
      symbol: String(args.symbol || "XAU/USD").toUpperCase(),
      limit: Number(args.limit || 1000),
      maxResults: Number(args.maxResults || args["max-results"] || 12)
    });
    console.log(formatGoldPullbackSweep(sweep));
    return;
  }

  if (subcommand === "capital-demo-loop") {
    const intervalSeconds = Number(args.intervalSeconds || args["interval-seconds"] || defaultConfig.goldDemo.intervalSeconds);
    const jitterSeconds = Number(args.jitterSeconds || args["jitter-seconds"] || defaultConfig.goldDemo.loopJitterSeconds || 0);
    const cycles = Number(args.cycles || 0);
    const runOnce = async () => {
      const loop = await runCapitalGoldDemoLoop(createGoldCapitalDemoLoopOptions(args));
      console.log(formatCapitalGoldDemoLoop(loop));

      if (!args["confirm-capital-demo"]) {
        console.log("\nDecision-only mode. Add --confirm-capital-demo and --size to allow Capital.com demo orders from approved Gold setups.");
      }
      return loop;
    };

    if (!args.loop) {
      await runOnce();
      return;
    }

    let completed = 0;
    while (!cycles || completed < cycles) {
      completed += 1;
      let lastError = null;
      try {
        await runOnce();
      } catch (error) {
        lastError = error;
        console.error(`\nGold Capital demo loop error: ${error.message}`);
      }

      if (cycles && completed >= cycles) {
        break;
      }

      const cooldownSeconds = lastError && /429|too-many/i.test(lastError.message)
        ? Math.max(intervalSeconds, 300)
        : intervalSeconds;
      const waitMs = (Math.max(10, cooldownSeconds) + randomJitterSeconds(jitterSeconds)) * 1000;
      const nextRunAt = new Date(Date.now() + waitMs).toISOString();
      console.log(`\nNext Gold Capital demo loop: ${nextRunAt}`);
      await sleep(waitMs);
    }
    return;
  }

  console.log(`Gold Commands
=============
  node src/cli.js gold paper-cycle --sample --no-db
  node src/cli.js gold paper-cycle --sample
  node src/cli.js gold paper-cycle --instrument XAU_USD --granularity M5
  node src/cli.js gold paper-cycle --provider capital --epic GOLD --granularity M5
  node src/cli.js gold paper-cycle --strategy trendline --provider capital --epic GOLD --granularity M5
  node src/cli.js gold paper-cycle --strategy pullback --provider capital --epic GOLD --granularity M5
  node src/cli.js gold trendline-sweep
  node src/cli.js gold pullback-sweep
  node src/cli.js gold capital-demo-loop
  node src/cli.js gold capital-demo-loop --timeframes MINUTE,MINUTE_5,MINUTE_15,MINUTE_30
  node src/cli.js gold capital-demo-loop --loop --interval-seconds 60
  node src/cli.js gold capital-demo-loop --size 0.3 --confirm-capital-demo
  node src/cli.js gold capital-demo-loop --loop --timeframes MINUTE,MINUTE_5,MINUTE_15,MINUTE_30 --size 0.3 --min-position-size 0.3 --confirm-capital-demo
`);
}

function createGoldCapitalDemoLoopOptions(args) {
  const configuredTimeframes = args.timeframes
    || args.resolutions
    || args.resolution
    || args.granularity
    || defaultConfig.goldDemo.timeframes.join(",");
  const resolutions = parseList(configuredTimeframes);

  return {
    client: new CapitalClient(),
    epic: String(args.epic || "GOLD").trim().toUpperCase(),
    resolution: resolutions[0] || String(args.resolution || args.granularity || "MINUTE_5"),
    resolutions,
    count: Number(args.count || args.limit || 300),
    size: optionalNumber(args.size) ?? defaultConfig.goldDemo.defaultSize,
    minPositionSize: optionalNumber(args.minPositionSize || args["min-position-size"]) ?? defaultConfig.goldDemo.minPositionSize,
    submitOrders: Boolean(args["confirm-capital-demo"]),
    accountStartingCash: optionalNumber(args.accountStartingCash || args["account-starting-cash"]) ?? defaultConfig.goldDemo.accountStartingCash,
    dailyProfitTargetDollars: optionalNumber(args.dailyProfitTargetDollars || args["daily-profit-target"]) ?? defaultConfig.goldDemo.dailyProfitTargetDollars,
    dailyMaxLossDollars: optionalNumber(args.dailyMaxLossDollars || args["daily-max-loss"]) ?? defaultConfig.goldDemo.dailyMaxLossDollars,
    maxOpenPositions: optionalNumber(args.maxOpenPositions || args["max-open-positions"]) ?? defaultConfig.goldDemo.maxOpenPositions,
    closePositionsOnDailyGuard: !args["no-close-on-daily-guard"],
    maxSignalAgeBars: optionalNumber(args.maxSignalAgeBars || args["max-signal-age-bars"]) ?? defaultConfig.goldDemo.maxSignalAgeBars,
    maxEntryDriftBps: optionalNumber(args.maxEntryDriftBps || args["max-entry-drift-bps"]) ?? defaultConfig.goldDemo.maxEntryDriftBps,
    allowTrendProbe: !args["no-trend-probe"],
    trendProbeMinBars: optionalNumber(args.trendProbeMinBars || args["trend-probe-min-bars"]) ?? defaultConfig.goldDemo.trendProbeMinBars,
    minMinutesBetweenEntries: optionalNumber(args.minMinutesBetweenEntries || args["min-minutes-between-entries"]) ?? defaultConfig.goldDemo.minMinutesBetweenEntries,
    maxEntriesPerHour: optionalNumber(args.maxEntriesPerHour || args["max-entries-per-hour"]) ?? defaultConfig.goldDemo.maxEntriesPerHour,
    maxDailyEntries: optionalNumber(args.maxDailyEntries || args["max-daily-entries"]) ?? defaultConfig.goldDemo.maxDailyEntries,
    stateFile: args.stateFile || args["state-file"] || undefined,
    strategyOptions: {
      targetRR: optionalNumber(args.targetRR || args["target-rr"]) ?? 2,
      touchAtrMultiple: optionalNumber(args.touchAtrMultiple || args["touch-atr-multiple"]) ?? 0.75,
      stopAtrMultiple: optionalNumber(args.stopAtrMultiple || args["stop-atr-multiple"]) ?? 2,
      maxHoldBars: optionalNumber(args.maxHoldBars || args["max-hold-bars"]) ?? 12,
      minAtrPct: optionalNumber(args.minAtrPct || args["min-atr-pct"]) ?? 0.00015
    }
  };
}

async function runOilCommand(args) {
  const subcommand = args._[1] || "help";

  if (subcommand === "capital-demo-loop") {
    const intervalSeconds = Number(args.intervalSeconds || args["interval-seconds"] || defaultConfig.oilDemo.intervalSeconds);
    const jitterSeconds = Number(args.jitterSeconds || args["jitter-seconds"] || defaultConfig.oilDemo.loopJitterSeconds || 0);
    const cycles = Number(args.cycles || 0);
    const runOnce = async () => {
      const loop = await runCapitalOilDemoLoop(createOilCapitalDemoLoopOptions(args));
      console.log(formatCapitalOilDemoLoop(loop));

      if (!args["confirm-capital-demo"]) {
        console.log("\nDecision-only mode. Add --confirm-capital-demo and --size to allow Capital.com demo orders from approved Oil setups.");
      }
      return loop;
    };

    if (!args.loop) {
      await runOnce();
      return;
    }

    let completed = 0;
    while (!cycles || completed < cycles) {
      completed += 1;
      let lastError = null;
      try {
        await runOnce();
      } catch (error) {
        lastError = error;
        console.error(`\nOil Capital demo loop error: ${error.message}`);
      }

      if (cycles && completed >= cycles) {
        break;
      }

      const cooldownSeconds = lastError && /429|too-many/i.test(lastError.message)
        ? Math.max(intervalSeconds, 300)
        : intervalSeconds;
      const waitMs = (Math.max(10, cooldownSeconds) + randomJitterSeconds(jitterSeconds)) * 1000;
      const nextRunAt = new Date(Date.now() + waitMs).toISOString();
      console.log(`\nNext Oil Capital demo loop: ${nextRunAt}`);
      await sleep(waitMs);
    }
    return;
  }

  console.log(`Oil Commands
============
  node src/cli.js oil capital-demo-loop
  node src/cli.js oil capital-demo-loop --timeframes MINUTE,MINUTE_5,MINUTE_15,MINUTE_30
  node src/cli.js oil capital-demo-loop --loop --interval-seconds 180
  node src/cli.js oil capital-demo-loop --size 10 --confirm-capital-demo
  node src/cli.js oil capital-demo-loop --loop --timeframes MINUTE,MINUTE_5,MINUTE_15,MINUTE_30 --size 10 --min-position-size 10 --confirm-capital-demo
`);
}

function createOilCapitalDemoLoopOptions(args) {
  const configuredTimeframes = args.timeframes
    || args.resolutions
    || args.resolution
    || args.granularity
    || defaultConfig.oilDemo.timeframes.join(",");
  const resolutions = parseList(configuredTimeframes);

  return {
    client: new CapitalClient(),
    epic: String(args.epic || defaultConfig.oilDemo.epic).trim().toUpperCase(),
    symbol: String(args.symbol || defaultConfig.oilDemo.symbol).trim().toUpperCase(),
    resolution: resolutions[0] || String(args.resolution || args.granularity || "MINUTE_5"),
    resolutions,
    count: Number(args.count || args.limit || 300),
    size: optionalNumber(args.size) ?? defaultConfig.oilDemo.defaultSize,
    minPositionSize: optionalNumber(args.minPositionSize || args["min-position-size"]) ?? defaultConfig.oilDemo.minPositionSize,
    submitOrders: Boolean(args["confirm-capital-demo"]),
    accountStartingCash: optionalNumber(args.accountStartingCash || args["account-starting-cash"]) ?? defaultConfig.oilDemo.accountStartingCash,
    dailyProfitTargetDollars: optionalNumber(args.dailyProfitTargetDollars || args["daily-profit-target"]) ?? defaultConfig.oilDemo.dailyProfitTargetDollars,
    dailyMaxLossDollars: optionalNumber(args.dailyMaxLossDollars || args["daily-max-loss"]) ?? defaultConfig.oilDemo.dailyMaxLossDollars,
    maxOpenPositions: optionalNumber(args.maxOpenPositions || args["max-open-positions"]) ?? defaultConfig.oilDemo.maxOpenPositions,
    closePositionsOnDailyGuard: !args["no-close-on-daily-guard"],
    inventoryBlackoutEnabled: !args["no-inventory-blackout"],
    minMinutesBetweenEntries: optionalNumber(args.minMinutesBetweenEntries || args["min-minutes-between-entries"]) ?? defaultConfig.oilDemo.minMinutesBetweenEntries,
    maxEntriesPerHour: optionalNumber(args.maxEntriesPerHour || args["max-entries-per-hour"]) ?? defaultConfig.oilDemo.maxEntriesPerHour,
    maxDailyEntries: optionalNumber(args.maxDailyEntries || args["max-daily-entries"]) ?? defaultConfig.oilDemo.maxDailyEntries,
    stateFile: args.stateFile || args["state-file"] || undefined,
    strategyOptions: {
      breakoutLookback: optionalNumber(args.breakoutLookback || args["breakout-lookback"]) ?? defaultConfig.oilDemo.breakoutLookback,
      minAtrPct: optionalNumber(args.minAtrPct || args["min-atr-pct"]) ?? defaultConfig.oilDemo.minAtrPct,
      maxAtrPct: optionalNumber(args.maxAtrPct || args["max-atr-pct"]) ?? defaultConfig.oilDemo.maxAtrPct,
      maxSpreadPct: optionalNumber(args.maxSpreadPct || args["max-spread-pct"]) ?? defaultConfig.oilDemo.maxSpreadPct,
      minVolumeExpansion: optionalNumber(args.minVolumeExpansion || args["min-volume-expansion"]) ?? defaultConfig.oilDemo.minVolumeExpansion,
      stopAtrMultiple: optionalNumber(args.stopAtrMultiple || args["stop-atr-multiple"]) ?? defaultConfig.oilDemo.stopAtrMultiple,
      targetRR: optionalNumber(args.targetRR || args["target-rr"]) ?? defaultConfig.oilDemo.targetRR
    }
  };
}

async function runCapitalCommand(args) {
  const subcommand = args._[1] || "help";
  const client = new CapitalClient();

  if (subcommand === "account" || subcommand === "accounts") {
    const accounts = await client.getAccounts();
    console.log(formatCapitalAccounts(accounts));
    return;
  }

  if (subcommand === "markets") {
    const markets = await client.getMarkets({
      searchTerm: String(args.search || args.searchTerm || args["search-term"] || "gold")
    });
    console.log(formatCapitalMarkets(markets, {
      limit: Number(args.limit || 30)
    }));
    return;
  }

  if (subcommand === "positions") {
    const positions = await client.getPositions();
    console.log(formatCapitalPositions(positions, {
      limit: Number(args.limit || 20)
    }));
    return;
  }

  if (subcommand === "confirm") {
    const dealReference = String(args.dealReference || args["deal-reference"] || "").trim();
    const confirm = await client.getConfirm(dealReference);
    console.log(formatCapitalDealResult(confirm, {
      title: "Capital.com Deal Confirm"
    }));
    return;
  }

  if (subcommand === "open-position") {
    assertCapitalDemoConfirmation(args, client);
    const created = await client.createPosition({
      epic: String(args.epic || "GOLD").trim().toUpperCase(),
      direction: String(args.direction || args.side || "BUY").trim().toUpperCase(),
      size: optionalNumber(args.size),
      guaranteedStop: Boolean(args.guaranteedStop || args["guaranteed-stop"]),
      trailingStop: Boolean(args.trailingStop || args["trailing-stop"]),
      stopLevel: optionalNumber(args.stopLevel || args["stop-level"]),
      stopDistance: optionalNumber(args.stopDistance || args["stop-distance"]),
      stopAmount: optionalNumber(args.stopAmount || args["stop-amount"]),
      profitLevel: optionalNumber(args.profitLevel || args["profit-level"]),
      profitDistance: optionalNumber(args.profitDistance || args["profit-distance"]),
      profitAmount: optionalNumber(args.profitAmount || args["profit-amount"])
    });
    console.log(formatCapitalDealResult(created, {
      title: "Capital.com Demo Position Submitted"
    }));

    if (created.dealReference) {
      const confirm = await client.getConfirm(created.dealReference);
      console.log("");
      console.log(formatCapitalDealResult(confirm, {
        title: "Capital.com Deal Confirm"
      }));
    }
    return;
  }

  if (subcommand === "close-position") {
    assertCapitalDemoConfirmation(args, client);
    const dealId = String(args.dealId || args["deal-id"] || "").trim();
    const closed = await client.closePosition(dealId);
    console.log(formatCapitalDealResult(closed, {
      title: "Capital.com Demo Position Close Submitted"
    }));

    if (closed.dealReference) {
      const confirm = await client.getConfirm(closed.dealReference);
      console.log("");
      console.log(formatCapitalDealResult(confirm, {
        title: "Capital.com Deal Confirm"
      }));
    }
    return;
  }

  if (subcommand === "prices") {
    const result = await fetchCapitalPrices({
      client,
      epic: String(args.epic || "GOLD"),
      resolution: String(args.resolution || args.granularity || "MINUTE_5"),
      count: Number(args.count || args.limit || 120),
      from: args.from,
      to: args.to,
      symbol: args.symbol ? String(args.symbol).toUpperCase() : undefined
    });

    console.log(formatCapitalMarketData(result));

    if (args.db) {
      const stored = await upsertMarketBars(result.bars);
      console.log(`Database market bars: ${stored.bars} bars (${stored.symbols.join(", ")}) from ${stored.sources.join(", ")}`);
    }
    return;
  }

  console.log(`Capital.com Commands
====================
  node src/cli.js capital account
  node src/cli.js capital markets --search gold
  node src/cli.js capital markets --search xau
  node src/cli.js capital positions
  node src/cli.js capital confirm --deal-reference REF
  node src/cli.js capital prices --epic GOLD --resolution MINUTE_5
  node src/cli.js capital prices --epic GOLD --resolution MINUTE_5 --db
  node src/cli.js capital open-position --epic GOLD --direction BUY --size 0.3 --stop-distance 10 --profit-distance 20 --confirm-capital-demo
  node src/cli.js capital close-position --deal-id DEAL_ID --confirm-capital-demo
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

async function runFinnhubCommand(args) {
  const subcommand = args._[1] || "help";
  const client = new FinnhubClient();

  if (subcommand === "news") {
    const symbol = String(args.symbol || "TSLA").toUpperCase();
    const days = Number(args.days || 3);
    const to = args.to || formatDate(new Date());
    const from = args.from || formatDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const news = await client.getCompanyNews({ symbol, from, to });
    console.log(formatFinnhubCompanyNews(news, {
      symbol,
      limit: Number(args.limit || 8)
    }));
    return;
  }

  console.log(`Finnhub Commands
================
  node src/cli.js finnhub news --symbol TSLA
  node src/cli.js finnhub news --symbol NVDA --days 7 --limit 5
`);
}

async function runNewsCommand(args) {
  const subcommand = args._[1] || "plan";

  if (subcommand === "plan" || subcommand === "sources") {
    console.log(formatNewsSourcePlan(getNewsSourcePlan()));
    return;
  }

  console.log(`News Commands
=============
  node src/cli.js news plan
  node src/cli.js news sources
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
    const intervalMinutes = Number(
      args.intervalMinutes ||
      args["interval-minutes"] ||
      getDefaultSchedulerIntervalMinutes(args.profile)
    );
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
  node src/cli.js scheduler run-once
  node src/cli.js scheduler run-once --confirm-paper
  node src/cli.js scheduler run-once --profile scalp --confirm-paper
  node src/cli.js scheduler loop --confirm-paper --interval-minutes 60
  node src/cli.js scheduler loop --profile scalp --confirm-paper
  node src/cli.js scheduler run-once --profile scalp --max-selected 12 --max-catalysts 8
`);
}

function createStockPaperCycleOptions(args) {
  return {
    symbols: parseList(args.symbols || DEFAULT_STOCK_SYMBOLS),
    profile: String(args.profile || defaultConfig.paperTraining.defaultProfile || "standard"),
    timeframe: args.timeframe ? String(args.timeframe) : undefined,
    bars: optionalNumber(args.bars),
    feed: String(args.feed || "iex"),
    lookbackDays: optionalNumber(args.lookbackDays || args["lookback-days"]),
    submitOrders: Boolean(args["confirm-paper"]),
    maxBuyNotional: optionalNumber(args.maxNotional || args["max-notional"]),
    targetRewardRiskRatio: optionalNumber(args.targetRR || args["target-rr"]),
    selection: createStockSelectionOptions(args),
    exportOutDir: String(args.out || "reports/paper-ledger"),
    exportLimit: Number(args.limit || 500),
    writeDatabase: !args["no-db"],
    exportLedger: !args["no-export"]
  };
}

function createStockSelectionOptions(args) {
  const selection = {};

  if (args["no-selection"]) {
    selection.enabled = false;
  }
  if (args.maxSelected || args["max-selected"]) {
    selection.maxSelectedSymbols = Number(args.maxSelected || args["max-selected"]);
  }
  if (args.maxCatalysts || args["max-catalysts"]) {
    selection.maxCatalystSymbols = Number(args.maxCatalysts || args["max-catalysts"]);
  }
  if (args.noCatalysts || args["no-catalysts"]) {
    selection.useFinnhubCatalysts = false;
  }

  return selection;
}

function getDefaultSchedulerIntervalMinutes(profileName) {
  const profile = getPaperTrainingProfile(
    defaultConfig,
    profileName || defaultConfig.paperTraining.defaultProfile || "standard"
  );
  return Number(profile.config.intervalMinutes || 60);
}

function assertPaperConfirmation(args) {
  if (!args["confirm-paper"]) {
    throw new Error("Refusing to submit even a paper order without --confirm-paper.");
  }
}

function assertCapitalDemoConfirmation(args, client) {
  if (client.environment !== "demo") {
    throw new Error(`Refusing Capital.com order because CAPITAL_ENV is ${client.environment}; demo only is allowed here.`);
  }

  if (!args["confirm-capital-demo"]) {
    throw new Error("Refusing Capital.com demo order without --confirm-capital-demo.");
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

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
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
  node src/cli.js alpaca clock
  node src/cli.js alpaca bars
  node src/cli.js alpaca paper-loop --db
  node src/cli.js alpaca sync
  node src/cli.js scheduler run-once --confirm-paper
  node src/cli.js oanda candles --instrument XAU_USD --db
  node src/cli.js gold paper-cycle --sample
  node src/cli.js oil capital-demo-loop
  node src/cli.js finnhub news --symbol TSLA
  node src/cli.js news plan
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
  gold       Run Gold/USD paper-cycle research with sample or OANDA data
  oil        Run Crude Oil/WTI Capital.com demo strategy loop
  oanda      Pull OANDA practice candles for XAU/USD and forex pairs
  finnhub    Pull stock news and catalysts through Finnhub
  news       Show the per-section news/catalyst source plan
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

function randomJitterSeconds(maxSeconds) {
  const max = Number(maxSeconds || 0);
  if (!Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * max);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
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
