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
    },
    goldTrendline: {
      fastBiasPeriod: 8,
      slowBiasPeriod: 21,
      pivotDepth: 2,
      trendlineLookback: 36,
      maxPivotCandidates: 8,
      minTrendlineTouches: 2,
      maxTrendlineViolations: 1,
      touchAtrMultiple: 0.35,
      entryAtrMultiple: 0.7,
      stopAtrMultiple: 0.9,
      takeProfitRR: 1.6,
      minAtrPct: 0.0008,
      maxAtrPct: 0.008,
      sessionUtcStartHour: 6,
      sessionUtcEndHour: 20
    }
  },
  stockPaper: {
    symbols: [
      "AAPL",
      "MSFT",
      "NVDA",
      "TSLA",
      "AMZN",
      "META",
      "GOOGL",
      "AMD",
      "NFLX",
      "AVGO",
      "SMCI",
      "PLTR",
      "COIN",
      "MSTR",
      "SOFI",
      "HOOD",
      "RIVN",
      "LCID",
      "INTC",
      "MU",
      "BABA",
      "NIO",
      "UBER",
      "SHOP",
      "SQ",
      "PYPL",
      "MARA",
      "RIOT",
      "GME",
      "AMC",
      "F",
      "GM",
      "BA",
      "JPM",
      "BAC",
      "WFC",
      "XOM",
      "CVX",
      "UNH",
      "LLY",
      "MRK",
      "PFE",
      "DIS",
      "WMT",
      "TGT",
      "COST",
      "CRM",
      "ORCL",
      "ADBE",
      "NOW",
      "SNOW",
      "PANW",
      "CRWD",
      "ARM",
      "TSM",
      "QCOM",
      "TXN",
      "AMAT",
      "LRCX",
      "CLSK",
      "DKNG"
    ],
    selection: {
      enabled: true,
      maxSelectedSymbols: 8,
      minBars: 25,
      momentumLookbackBars: 6,
      trendLookbackBars: 24,
      volumeLookbackBars: 20,
      useFinnhubCatalysts: true,
      maxCatalystSymbols: 8,
      catalystLookbackDays: 3,
      catalystScoreWeight: 1
    }
  },
  paperTraining: {
    defaultProfile: "standard",
    maxBuyNotional: 100,
    targetRiskPerTradeDollars: 30,
    targetRewardRiskRatio: 2.5,
    dailyGuard: {
      profitTargetDollars: 50,
      profitStretchDollars: 100,
      maxLossDollars: 50
    },
    profiles: {
      scalp: {
        timeframe: "5Min",
        bars: 120,
        lookbackDays: 5,
        intervalMinutes: 5,
        maxBuyNotional: 100,
        targetRiskPerTradeDollars: 20,
        targetRewardRiskRatio: 1.3,
        dailyGuard: {
          profitTargetDollars: 50,
          profitStretchDollars: 100,
          maxLossDollars: 50
        },
        strategy: {
          fastPeriod: 3,
          slowPeriod: 8,
          breakoutLookback: 6,
          minVolumeExpansion: 0.9,
          stopLossPct: 0.012,
          takeProfitRR: 1.3
        },
        risk: {
          maxOpenPositions: 3,
          maxRiskPerTradePct: 0.04,
          maxNotionalPerTradePct: 0.25,
          maxAssetClassExposurePct: {
            stock: 0.7
          },
          maxSpreadBps: {
            stock: 20
          },
          minVolume: {
            stock: 50000
          }
        }
      }
    },
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
    allowShorts: {
      meme: false,
      stock: false,
      gold: false,
      future: false,
      forex: false
    },
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
