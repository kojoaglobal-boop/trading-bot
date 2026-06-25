#!/usr/bin/env node
import { defaultConfig } from "./config/default.js";
import { writeAuditLog } from "./core/audit-log.js";
import { loadDotEnv } from "./core/env-loader.js";
import { runBacktest } from "./core/backtester.js";
import { loadCsvBars, createSampleBars } from "./core/market-data.js";
import { PaperBroker } from "./core/paper-broker.js";
import { Portfolio } from "./core/portfolio.js";
import { RiskEngine } from "./core/risk-engine.js";
import { formatReport } from "./core/report.js";
import { assertLiveTradingAllowed } from "./core/live-gateway.js";
import { formatJournal, loadAuditJournal } from "./core/journal.js";
import {
  formatSweepResult,
  formatWalkForwardResult,
  runParameterSweep,
  runWalkForwardValidation
} from "./core/optimizer.js";
import { formatSourceStatuses, getSourceStatuses } from "./core/source-registry.js";
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
    const logs = await loadAuditJournal(args.logs || "logs");
    console.log(formatJournal(logs, { limit: Number(args.limit || 12) }));
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
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
  if (!args.audit) {
    return;
  }

  const filePath = await writeAuditLog(report, {
    directory: typeof args.audit === "string" ? args.audit : "logs"
  });
  console.log(`\nAudit log: ${filePath}`);
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
  node src/cli.js paper --ticks 200 --audit
  node src/cli.js journal
  node src/cli.js doctor
  node src/cli.js sources

Commands:
  backtest   Run the strategy over sample or CSV bar data
  optimize   Sweep strategy settings and rank candidates
  walk-forward
             Optimize on a train set, then test out-of-sample
  paper      Run a simulated paper session using generated market bars
  journal    Show saved audit-log summaries
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
