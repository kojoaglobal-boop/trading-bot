const DEFAULT_KRAKEN_BASE_URL = "https://api.kraken.com/0";

export class KrakenClient {
  constructor({ baseUrl = DEFAULT_KRAKEN_BASE_URL, fetchFn = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetchFn = fetchFn;
  }

  async getOhlc({
    pair,
    interval = 60,
    since,
    assetVersion = 1
  }) {
    if (!pair) {
      throw new Error("Kraken OHLC pair is required.");
    }

    const url = new URL(`${this.baseUrl}/public/OHLC`);
    url.searchParams.set("pair", String(pair).trim().toUpperCase());
    url.searchParams.set("interval", String(interval));
    url.searchParams.set("assetVersion", String(assetVersion));
    if (since !== undefined && since !== null && since !== "") {
      url.searchParams.set("since", String(since));
    }

    return this.requestJson(url);
  }

  async requestJson(input) {
    if (!this.fetchFn) {
      throw new Error("Fetch API is not available in this Node runtime.");
    }

    const response = await this.fetchFn(input, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(`Kraken request failed (${response.status}): ${response.statusText}`);
    }

    if (Array.isArray(payload.error) && payload.error.length) {
      throw new Error(`Kraken API error: ${payload.error.join(", ")}`);
    }

    return payload;
  }
}

export function normalizeKrakenOhlc(payload, {
  requestedPair,
  interval = 60,
  assetClass = "meme"
} = {}) {
  const result = payload.result || {};
  const pairKey = Object.keys(result).find((key) => key !== "last");
  const rows = pairKey ? result[pairKey] : [];
  const symbol = normalizePairSymbol(pairKey || requestedPair);

  return rows.map((row) => {
    const [
      time,
      open,
      high,
      low,
      close,
      vwap,
      volume,
      tradeCount
    ] = row;

    return {
      time: new Date(Number(time) * 1000).toISOString(),
      symbol,
      assetClass,
      venue: "kraken-spot",
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      bid: undefined,
      ask: undefined,
      source: {
        provider: "kraken",
        mode: "public-market-data",
        intervalMinutes: Number(interval),
        pairKey,
        requestedPair,
        vwap: Number(vwap),
        tradeCount: Number(tradeCount)
      }
    };
  });
}

export function formatKrakenBars(bars, { limit = 8 } = {}) {
  const lines = [];
  lines.push("Kraken Public OHLC Bars");
  lines.push("=======================");

  if (!bars.length) {
    lines.push("No bars returned.");
    return lines.join("\n");
  }

  for (const bar of bars.slice(-limit)) {
    lines.push(
      `${bar.time} ${bar.symbol.padEnd(10)} close=${money(bar.close)} high=${money(bar.high)} low=${money(bar.low)} volume=${formatNumber(bar.volume)}`
    );
  }

  return lines.join("\n");
}

function normalizePairSymbol(pair) {
  const normalized = String(pair || "").toUpperCase();

  if (normalized === "XXBTZUSD" || normalized === "XBTUSD" || normalized === "BTCUSD") {
    return "BTC/USD";
  }

  if (normalized.endsWith("ZUSD")) {
    return `${normalized.slice(0, -4).replace(/^X/, "").replace("XBT", "BTC")}/USD`;
  }

  return normalized
    .replace("XBT", "BTC")
    .replace(/([A-Z0-9]+)(USD|EUR|GBP|USDT|USDC)$/i, "$1/$2")
    .toUpperCase();
}

function money(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString("en-US", {
    maximumFractionDigits: number < 1 ? 8 : 2,
    minimumFractionDigits: number < 1 ? 2 : 2
  })}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}
