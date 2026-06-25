export const sourceCatalog = [
  {
    id: "sample-generator",
    label: "Built-in Sample Generator",
    kind: "market-data",
    mode: "simulation",
    covers: ["meme", "stock", "future", "forex"],
    requiredEnv: [],
    cost: "free",
    purpose: "Deterministic fake bars for testing the bot loop."
  },
  {
    id: "csv-file",
    label: "Local CSV Import",
    kind: "market-data",
    mode: "historical",
    covers: ["meme", "stock", "future", "forex"],
    requiredEnv: [],
    cost: "free if you already have the data",
    purpose: "Backtesting with exported broker or vendor data."
  },
  {
    id: "alpaca",
    label: "Alpaca",
    kind: "broker-and-data",
    mode: "paper-or-live",
    covers: ["stock", "meme"],
    requiredEnv: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
    optionalEnv: ["ALPACA_BASE_URL", "ALPACA_DATA_BASE_URL"],
    cost: "free paper account; paid market-data upgrades may be useful",
    purpose: "Stocks, ETFs, crypto, paper trading, and later broker execution."
  },
  {
    id: "coinbase",
    label: "Coinbase Advanced Trade",
    kind: "broker-and-data",
    mode: "sandbox-or-live",
    covers: ["meme"],
    requiredEnv: ["COINBASE_API_KEY", "COINBASE_API_SECRET"],
    cost: "account required; trading fees apply",
    purpose: "Crypto and meme coin REST/WebSocket data plus order routing."
  },
  {
    id: "kraken",
    label: "Kraken",
    kind: "broker-and-data",
    mode: "live",
    covers: ["meme"],
    requiredEnv: ["KRAKEN_API_KEY", "KRAKEN_API_SECRET"],
    cost: "account required; trading fees apply",
    purpose: "Crypto spot, derivatives, and WebSocket data."
  },
  {
    id: "oanda",
    label: "OANDA",
    kind: "broker-and-data",
    mode: "practice-or-live",
    covers: ["forex"],
    requiredEnv: ["OANDA_ACCOUNT_ID", "OANDA_API_TOKEN"],
    optionalEnv: ["OANDA_ENV"],
    cost: "demo account available; spreads and financing apply live",
    purpose: "Forex pairs and CFD-style instruments such as XAU/USD where available."
  },
  {
    id: "tradovate",
    label: "Tradovate / NinjaTrader",
    kind: "broker-and-data",
    mode: "simulation-or-live",
    covers: ["future"],
    requiredEnv: [
      "TRADOVATE_USERNAME",
      "TRADOVATE_PASSWORD",
      "TRADOVATE_APP_ID",
      "TRADOVATE_APP_VERSION"
    ],
    cost: "sim available; commissions, exchange, clearing, and NFA fees apply live",
    purpose: "Futures simulation and later execution."
  },
  {
    id: "databento",
    label: "Databento",
    kind: "market-data",
    mode: "historical-or-live",
    covers: ["stock", "future"],
    requiredEnv: ["DATABENTO_API_KEY"],
    cost: "usage-based data vendor",
    purpose: "High-quality historical and streaming market data."
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "intelligence",
    mode: "analysis",
    covers: ["research", "journal", "risk-review"],
    requiredEnv: ["OPENAI_API_KEY"],
    cost: "usage-based API billing",
    purpose: "Optional research agent, news triage, trade journaling, and strategy review."
  }
];
