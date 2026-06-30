import { readFile } from "node:fs/promises";

const ASSET_PROFILES = {
  meme: {
    start: 0.08,
    volatility: 0.06,
    volume: 1200000,
    spreadBps: 45
  },
  stock: {
    start: 220,
    volatility: 0.02,
    volume: 450000,
    spreadBps: 7
  },
  gold: {
    start: 2400,
    volatility: 0.0065,
    volume: 9000,
    spreadBps: 8
  },
  future: {
    start: 5200,
    volatility: 0.011,
    volume: 12000,
    spreadBps: 5
  },
  forex: {
    start: 1.1,
    volatility: 0.004,
    volume: 9000,
    spreadBps: 3
  }
};

export async function loadCsvBars(filePath) {
  const text = await readFile(filePath, "utf8");
  const rows = parseCsv(text);

  return rows.map((row, index) => normalizeBar(row, index + 2, filePath));
}

export function createSampleBars({ symbols, barsPerSymbol = 260, seed = 42 }) {
  const random = mulberry32(seed);
  const bars = [];
  const startDate = new Date("2025-01-01T14:30:00.000Z");

  for (const instrument of symbols) {
    const profile = ASSET_PROFILES[instrument.assetClass] || ASSET_PROFILES.stock;
    let close = profile.start * (0.85 + random() * 0.3);

    for (let index = 0; index < barsPerSymbol; index += 1) {
      const time = new Date(startDate.getTime() + index * 60 * 60 * 1000).toISOString();
      const cycle = Math.sin(index / 19) * profile.volatility * 0.55;
      const trend = index > barsPerSymbol * 0.35 && index < barsPerSymbol * 0.72
        ? profile.volatility * 0.18
        : -profile.volatility * 0.04;
      const shock = gaussian(random) * profile.volatility;
      const open = close;
      close = Math.max(0.000001, open * Math.exp(trend + cycle + shock));
      const high = Math.max(open, close) * (1 + random() * profile.volatility * 0.7);
      const low = Math.min(open, close) * (1 - random() * profile.volatility * 0.7);
      const volume = Math.round(profile.volume * (0.65 + random() * 0.9 + Math.abs(cycle) * 9));
      const spread = close * (profile.spreadBps / 10000);

      bars.push({
        time,
        symbol: instrument.symbol,
        assetClass: instrument.assetClass,
        venue: instrument.venue,
        open: round(open),
        high: round(high),
        low: round(low),
        close: round(close),
        volume,
        bid: round(close - spread / 2),
        ask: round(close + spread / 2),
        source: {
          provider: "sample-generator",
          mode: "simulation",
          generatedAt: new Date().toISOString(),
          seed
        }
      });
    }
  }

  return bars;
}

function normalizeBar(row, lineNumber, filePath) {
  const required = ["time", "symbol", "assetClass", "open", "high", "low", "close", "volume"];

  for (const field of required) {
    if (row[field] === undefined || row[field] === "") {
      throw new Error(`CSV line ${lineNumber} is missing ${field}.`);
    }
  }

  return {
    time: new Date(row.time).toISOString(),
    symbol: row.symbol,
    assetClass: row.assetClass,
    venue: row.venue || `${row.assetClass}-csv`,
    open: numberField(row.open, "open", lineNumber),
    high: numberField(row.high, "high", lineNumber),
    low: numberField(row.low, "low", lineNumber),
    close: numberField(row.close, "close", lineNumber),
    volume: numberField(row.volume, "volume", lineNumber),
    bid: row.bid ? numberField(row.bid, "bid", lineNumber) : undefined,
    ask: row.ask ? numberField(row.ask, "ask", lineNumber) : undefined,
    source: {
      provider: "csv-file",
      mode: "historical-import",
      filePath
    }
  };
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV needs a header and at least one data row.");
  }

  const headers = lines[0].split(",").map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function numberField(value, field, lineNumber) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`CSV line ${lineNumber} has invalid ${field}: ${value}`);
  }
  return parsed;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const u = 1 - random();
  const v = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function round(value) {
  if (value < 0.01) return Number(value.toFixed(8));
  if (value < 10) return Number(value.toFixed(5));
  return Number(value.toFixed(2));
}
