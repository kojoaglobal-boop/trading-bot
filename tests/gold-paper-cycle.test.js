import test from "node:test";
import assert from "node:assert/strict";
import { formatGoldPaperCycle, runGoldPaperCycle } from "../src/core/gold-paper-cycle.js";
import { createSampleBars } from "../src/core/market-data.js";

test("runGoldPaperCycle backtests XAU/USD bars without real orders", async () => {
  const cycle = await runGoldPaperCycle({
    bars: createBreakoutGoldBars(),
    writeDatabase: false,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(cycle.mode, "gold-paper-oanda");
  assert.equal(cycle.report.metrics.bars, 30);
  assert.ok(cycle.report.metrics.decisions >= 1);
  assert.equal(cycle.storedBars, null);
  assert.match(formatGoldPaperCycle(cycle), /Gold\/USD Paper Cycle/);
});

test("runGoldPaperCycle can use OANDA candle data when a client is configured", async () => {
  const cycle = await runGoldPaperCycle({
    instrument: "XAU_USD",
    granularity: "M5",
    count: 30,
    writeDatabase: false,
    client: {
      environment: "practice",
      async getInstrumentCandles(params) {
        assert.equal(params.instrument, "XAU_USD");
        assert.equal(params.granularity, "M5");
        assert.equal(params.count, 30);
        assert.equal(params.price, "BA");
        return {
          instrument: "XAU_USD",
          granularity: "M5",
          candles: createOandaGoldCandles()
        };
      }
    },
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(cycle.bars[0].symbol, "XAU/USD");
  assert.equal(cycle.bars[0].assetClass, "gold");
  assert.equal(cycle.report.sources[0].provider, "oanda");
});

test("runGoldPaperCycle can use Capital.com GOLD price data", async () => {
  const cycle = await runGoldPaperCycle({
    provider: "capital",
    epic: "GOLD",
    granularity: "M5",
    count: 30,
    writeDatabase: false,
    client: {
      environment: "demo",
      async getPrices(params) {
        assert.equal(params.epic, "GOLD");
        assert.equal(params.resolution, "MINUTE_5");
        assert.equal(params.max, 30);
        return {
          prices: createCapitalGoldPrices()
        };
      }
    },
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(cycle.mode, "gold-paper-capital");
  assert.equal(cycle.bars[0].symbol, "XAU/USD");
  assert.equal(cycle.bars[0].assetClass, "gold");
  assert.equal(cycle.report.sources[0].provider, "capital");
});

test("runGoldPaperCycle can run the Gold trendline strategy", async () => {
  const cycle = await runGoldPaperCycle({
    strategy: "trendline",
    sample: true,
    count: 160,
    writeDatabase: false,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(cycle.strategy, "trendline");
  assert.equal(cycle.mode, "gold-paper-sample");
  assert.equal(cycle.report.metrics.bars, 160);
});

test("gold sample bars use gold-scale prices", () => {
  const bars = createSampleBars({
    symbols: [{
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "gold-paper-sim"
    }],
    barsPerSymbol: 5,
    seed: 1
  });

  assert.equal(bars[0].symbol, "XAU/USD");
  assert.equal(bars[0].assetClass, "gold");
  assert.ok(bars[0].close > 1000);
});

function createBreakoutGoldBars() {
  let close = 2400;
  return Array.from({ length: 30 }, (_value, index) => {
    close = index === 29 ? 2450 : close + 0.75;
    return {
      time: new Date(Date.UTC(2026, 0, 1, 10, index * 5)).toISOString(),
      symbol: "XAU/USD",
      assetClass: "gold",
      venue: "gold-test",
      open: close - 0.5,
      high: index === 29 ? 2452 : close + 1,
      low: close - 1,
      close,
      volume: index === 29 ? 1000 : 500,
      bid: close - 0.2,
      ask: close + 0.2,
      source: {
        provider: "test",
        mode: "gold"
      }
    };
  });
}

function createOandaGoldCandles() {
  return createBreakoutGoldBars().map((bar) => ({
    complete: true,
    time: bar.time,
    volume: bar.volume,
    bid: {
      o: String(bar.open - 0.2),
      h: String(bar.high - 0.2),
      l: String(bar.low - 0.2),
      c: String(bar.close - 0.2)
    },
    ask: {
      o: String(bar.open + 0.2),
      h: String(bar.high + 0.2),
      l: String(bar.low + 0.2),
      c: String(bar.close + 0.2)
    }
  }));
}

function createCapitalGoldPrices() {
  return createBreakoutGoldBars().map((bar) => ({
    snapshotTimeUTC: bar.time.replace(".000Z", ""),
    openPrice: {
      bid: String(bar.open - 0.2),
      ask: String(bar.open + 0.2)
    },
    highPrice: {
      bid: String(bar.high - 0.2),
      ask: String(bar.high + 0.2)
    },
    lowPrice: {
      bid: String(bar.low - 0.2),
      ask: String(bar.low + 0.2)
    },
    closePrice: {
      bid: String(bar.close - 0.2),
      ask: String(bar.close + 0.2)
    },
    lastTradedVolume: bar.volume
  }));
}
