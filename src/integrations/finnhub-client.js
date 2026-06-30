export class FinnhubClient {
  constructor({
    apiKey = process.env.FINNHUB_API_KEY,
    baseUrl = process.env.FINNHUB_BASE_URL || "https://finnhub.io/api/v1",
    fetchImpl = globalThis.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async getCompanyNews({
    symbol,
    from,
    to
  }) {
    this.assertReady();
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    if (!normalizedSymbol) {
      throw new Error("Finnhub company news requires a symbol.");
    }

    const url = new URL(`${this.baseUrl}/company-news`);
    url.searchParams.set("symbol", normalizedSymbol);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("token", this.apiKey);

    const response = await this.fetch(url);
    if (!response.ok) {
      throw new Error(`Finnhub company news request failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    return normalizeCompanyNews(payload, { symbol: normalizedSymbol });
  }

  assertReady() {
    if (!this.apiKey) {
      throw new Error("Missing FINNHUB_API_KEY. Add it to .env before using Finnhub.");
    }

    if (typeof this.fetch !== "function") {
      throw new Error("No fetch implementation available for FinnhubClient.");
    }
  }
}

export function normalizeCompanyNews(payload, { symbol } = {}) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: String(item.id ?? ""),
    symbol,
    headline: String(item.headline || ""),
    summary: String(item.summary || ""),
    source: String(item.source || ""),
    url: String(item.url || ""),
    image: String(item.image || ""),
    category: String(item.category || ""),
    related: String(item.related || ""),
    datetime: item.datetime ? new Date(Number(item.datetime) * 1000).toISOString() : null
  }));
}

export function formatFinnhubCompanyNews(news, {
  symbol,
  limit = 8
} = {}) {
  const lines = [];
  lines.push(`Finnhub Company News${symbol ? `: ${symbol}` : ""}`);
  lines.push("====================");

  if (!news.length) {
    lines.push("No news returned.");
    return lines.join("\n");
  }

  for (const item of news.slice(0, limit)) {
    lines.push(`- ${item.datetime || "unknown time"} ${item.source || "unknown"}`);
    lines.push(`  ${item.headline || "(no headline)"}`);
    if (item.summary) {
      lines.push(`  ${truncate(item.summary, 180)}`);
    }
  }

  return lines.join("\n");
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
