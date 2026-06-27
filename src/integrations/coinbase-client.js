const DEFAULT_COINBASE_BASE_URL = "https://api.coinbase.com/api/v3/brokerage";

export class CoinbaseClient {
  constructor({ baseUrl = DEFAULT_COINBASE_BASE_URL, fetchFn = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetchFn = fetchFn;
  }

  async getPublicProductCandles({
    productId,
    start,
    end,
    granularity = "ONE_HOUR",
    limit = 300
  }) {
    if (!productId) {
      throw new Error("Coinbase productId is required.");
    }

    const url = new URL(`${this.baseUrl}/market/products/${encodeURIComponent(productId)}/candles`);
    url.searchParams.set("start", String(start));
    url.searchParams.set("end", String(end));
    url.searchParams.set("granularity", granularity);
    url.searchParams.set("limit", String(limit));

    return this.requestJson(url);
  }

  async requestJson(input) {
    if (!this.fetchFn) {
      throw new Error("Fetch API is not available in this Node runtime.");
    }

    const response = await this.fetchFn(input, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "cache-control": "no-cache"
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      const message = payload.message || payload.error || response.statusText;
      throw new Error(`Coinbase request failed (${response.status}): ${message}`);
    }

    return payload;
  }
}

export function normalizeCoinbaseCandles(payload, {
  productId,
  granularity = "ONE_HOUR",
  assetClass = "meme"
} = {}) {
  const candles = payload.candles || [];
  const symbol = String(productId || "").replace("-", "/").toUpperCase();

  return candles.map((candle) => ({
    time: new Date(Number(candle.start) * 1000).toISOString(),
    symbol,
    assetClass,
    venue: "coinbase-spot",
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume || 0),
    bid: undefined,
    ask: undefined,
    source: {
      provider: "coinbase",
      mode: "public-market-data",
      productId,
      granularity
    }
  })).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function formatCoinbaseBars(bars, { limit = 8 } = {}) {
  const lines = [];
  lines.push("Coinbase Public Candle Bars");
  lines.push("===========================");

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
