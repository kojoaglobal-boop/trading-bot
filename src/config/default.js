export const defaultConfig = {
  account: {
    baseCurrency: "USD",
    startingCash: 500
  },
  universe: [
    {
      symbol: "DOGE-USD",
      assetClass: "meme",
      venue: "crypto-paper"
    },
    {
      symbol: "PEPE-USD",
      assetClass: "meme",
      venue: "crypto-paper"
    },
    {
      symbol: "AAPL",
      assetClass: "stock",
      venue: "equity-paper"
    },
    {
      symbol: "TSLA",
      assetClass: "stock",
      venue: "equity-paper"
    },
    {
      symbol: "NVDA",
      assetClass: "stock",
      venue: "equity-paper"
    },
    {
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "oanda-practice"
    },
    {
      symbol: "MES",
      assetClass: "future",
      venue: "futures-paper"
    },
    {
      symbol: "EUR-USD",
      assetClass: "forex",
      venue: "fx-paper"
    }
  ],
  strategy: {
    momentumBreakout: {
      fastPeriod: 8,
      slowPeriod: 21,
      breakoutLookback: 18,
      minVolumeExpansion: 1.05,
      stopLossPct: 0.035,
      takeProfitRR: 2.5
    }
  },
  stockPaper: {
    symbols: ["AAPL", "TSLA", "NVDA"]
  },
  paperTraining: {
    maxBuyNotional: 100,
    targetRiskPerTradeDollars: 30,
    targetRewardRiskRatio: 2.5,
    risk: {
      maxRiskPerTradePct: 0.06,
      maxNotionalPerTradePct: 0.25,
      maxAssetClassExposurePct: {
        stock: 0.5
      }
    }
  },
  risk: {
    allowedAssetClasses: ["meme", "stock", "gold", "future", "forex"],
    maxOpenPositions: 6,
    maxRiskPerTradePct: 0.0075,
    maxNotionalPerTradePct: 0.12,
    maxAssetClassExposurePct: {
      meme: 0.14,
      stock: 0.35,
      gold: 0.25,
      future: 0.25,
      forex: 0.25
    },
    maxDrawdownPct: 0.12,
    maxSpreadBps: {
      meme: 90,
      stock: 25,
      gold: 25,
      future: 20,
      forex: 12
    },
    minVolume: {
      meme: 500000,
      stock: 100000,
      gold: 1,
      future: 2500,
      forex: 1000
    }
  },
  execution: {
    paper: {
      commissionBps: 1,
      slippageBps: {
        meme: 35,
        stock: 4,
        gold: 5,
        future: 5,
        forex: 2
      },
      minCommission: 0.25
    }
  }
};
