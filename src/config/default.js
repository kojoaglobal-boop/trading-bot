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
    },
    goldPullback: {
      fastPeriod: 9,
      pullbackPeriod: 21,
      trendPeriod: 50,
      atrPeriod: 14,
      trendSlopeBars: 6,
      touchAtrMultiple: 0.75,
      stopAtrMultiple: 2,
      takeProfitRR: 2,
      maxHoldBars: 24,
      minAtrPct: 0.0002,
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
  goldDemo: {
    accountStartingCash: 1000,
    dailyProfitTargetDollars: 250,
    dailyMaxLossDollars: 100,
    maxOpenPositions: 3,
    defaultSize: 0.3,
    minPositionSize: 0.3,
    intervalSeconds: 60,
    closePositionsOnDailyGuard: true,
    timeframes: ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30"],
    baseMinuteBars: 1000,
    maxSignalAgeBars: 6,
    maxEntryDriftBps: 30,
    allowTrendProbe: true,
    trendProbeMinBars: 30,
    manageProfitTargets: true,
    minProfitToExtendDollars: 1,
    profitTargetExtensionAtrMultiple: 1.5,
    minProfitTargetMoveDistance: 1,
    moveStopOnTargetExtension: true,
    breakevenBufferDistance: 0.5,
    minMinutesBetweenEntries: 5,
    maxEntriesPerHour: 4,
    maxDailyEntries: 20
  },
  oilDemo: {
    accountStartingCash: 1000,
    dailyProfitTargetDollars: 100,
    dailyMaxLossDollars: 50,
    maxOpenPositions: 2,
    defaultSize: 10,
    minPositionSize: 10,
    intervalSeconds: 120,
    closePositionsOnDailyGuard: true,
    epic: "OIL_CRUDE",
    symbol: "WTI/USD",
    timeframes: ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30"],
    baseMinuteBars: 1000,
    breakoutLookback: 18,
    minAtrPct: 0.00035,
    maxAtrPct: 0.02,
    maxSpreadPct: 0.0015,
    minVolumeExpansion: 0.65,
    stopAtrMultiple: 1.8,
    targetRR: 2.2,
    maxSignalAgeBars: 2,
    manageProfitTargets: true,
    minProfitToExtendDollars: 0.75,
    profitTargetExtensionAtrMultiple: 1.25,
    minProfitTargetMoveDistance: 0.05,
    moveStopOnTargetExtension: true,
    breakevenBufferDistance: 0.03,
    inventoryBlackoutEnabled: true,
    inventoryBlackoutTimeZone: "America/New_York",
    inventoryBlackoutWeekday: "Wed",
    inventoryBlackoutStartMinute: 10 * 60 + 20,
    inventoryBlackoutEndMinute: 10 * 60 + 55,
    minMinutesBetweenEntries: 6,
    maxEntriesPerHour: 3,
    maxDailyEntries: 16
  },
  news: {
    stock: {
      required: ["finnhub-company-news"],
      optional: ["finnhub-market-news"],
      purpose: "Company headlines, sector catalysts, and broad market risk."
    },
    gold: {
      required: ["finnhub-market-news"],
      optional: ["fred-macro"],
      purpose: "Macro risk, USD/rates pressure, geopolitics, and metals sentiment."
    },
    oil: {
      required: ["eia-petroleum", "finnhub-market-news"],
      optional: ["fred-macro"],
      purpose: "Inventory shocks, energy headlines, USD/rates pressure, and crude momentum catalysts."
    },
    meme: {
      required: [],
      optional: ["finnhub-market-news", "coinbase", "kraken"],
      purpose: "Crypto market sentiment, exchange data, and later social/on-chain signals."
    }
  },
  risk: {
    allowedAssetClasses: ["meme", "stock", "gold", "oil", "future", "forex"],
    maxOpenPositions: 6,
    maxRiskPerTradePct: 0.0075,
    maxNotionalPerTradePct: 0.12,
    maxAssetClassExposurePct: {
      meme: 0.14,
      stock: 0.35,
      gold: 0.25,
      oil: 0.25,
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
    maxGrossLeverage: {
      meme: 1,
      stock: 1,
      gold: 1,
      future: 1,
      forex: 1
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
    },
    goldCapitalPaper: {
      commissionBps: 0,
      slippageBps: {
        gold: 1
      },
      minCommission: 0
    }
  }
};
